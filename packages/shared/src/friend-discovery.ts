/**
 * Friend discovery — search users, suggest people to befriend, and look
 * up which friends are currently in a given room or actively watching.
 *
 * The functions here build on top of `friends.ts` and the persisted
 * presence fields on `User`. The shape returned for each user mirrors
 * `FriendUserView` (id, display name, avatar, isGuest, presence) so the
 * UI can render search results, suggestions, and the friends list with
 * the same row component.
 */

import { Types, type FilterQuery } from "mongoose";
import { Friendship, type FriendshipDoc } from "./models/Friendship";
import { Room } from "./models/Room";
import { User, type UserDoc } from "./models/User";
import { summarizePresence, type PresenceSummary, type PresenceThresholds } from "./presence";

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

/** Result row for any "find people" surface. */
export interface DiscoveredUser {
  id: string;
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  presence: PresenceSummary;
  /** Friendship status relative to the viewer. */
  friendship: {
    /** `null` means no row exists. */
    status: "pending" | "accepted" | "blocked" | null;
    /** When `status === "pending"`, who sent the request. */
    direction: "incoming" | "outgoing" | null;
  };
}

type UserPresenceFields = Pick<
  UserDoc,
  | "googleName"
  | "googleAvatar"
  | "googleEmail"
  | "telegramUsername"
  | "telegramFirstName"
  | "telegramPhotoUrl"
  | "guestName"
  | "isGuest"
  | "lastActiveAt"
  | "manualStatus"
  | "watching"
>;

type DiscoveryUserDoc = UserPresenceFields & { _id: Types.ObjectId };

const USER_PROJECTION = {
  googleName: 1,
  googleAvatar: 1,
  googleEmail: 1,
  telegramUsername: 1,
  telegramFirstName: 1,
  telegramPhotoUrl: 1,
  guestName: 1,
  isGuest: 1,
  lastActiveAt: 1,
  manualStatus: 1,
  watching: 1,
} as const;

function displayName(user: {
  googleName?: string | null;
  googleEmail?: string | null;
  telegramUsername?: string | null;
  telegramFirstName?: string | null;
  guestName?: string | null;
}): string {
  return (
    user.googleName ??
    user.telegramFirstName ??
    user.telegramUsername ??
    user.guestName ??
    user.googleEmail ??
    "Guest"
  );
}

function avatarUrl(user: {
  googleAvatar?: string | null;
  telegramPhotoUrl?: string | null;
}): string | null {
  return user.googleAvatar ?? user.telegramPhotoUrl ?? null;
}

/**
 * Build a `friendship` summary for every `otherId` from the viewer's
 * point of view. Returns a Map keyed by the other user's id-as-string.
 */
async function loadFriendshipIndex(
  viewer: Types.ObjectId,
  otherIds: ReadonlyArray<Types.ObjectId>,
): Promise<Map<string, DiscoveredUser["friendship"]>> {
  if (otherIds.length === 0) return new Map();
  const rows = await Friendship.find({
    $or: [
      { userA: viewer, userB: { $in: otherIds } },
      { userB: viewer, userA: { $in: otherIds } },
    ],
  })
    .select({ userA: 1, userB: 1, requestedBy: 1, status: 1 })
    .lean<
      Array<
        Pick<FriendshipDoc, "userA" | "userB" | "requestedBy" | "status"> & {
          _id: Types.ObjectId;
        }
      >
    >();
  const map = new Map<string, DiscoveredUser["friendship"]>();
  for (const row of rows) {
    const other = row.userA.toString() === viewer.toString() ? row.userB : row.userA;
    let direction: "incoming" | "outgoing" | null = null;
    if (row.status === "pending") {
      direction =
        row.requestedBy.toString() === viewer.toString() ? "outgoing" : "incoming";
    }
    map.set(other.toString(), { status: row.status, direction });
  }
  return map;
}

/**
 * Hydrate a list of users into the discovery row shape, with the
 * viewer-relative friendship status pre-resolved.
 */
async function hydrateDiscovered(
  viewer: Types.ObjectId,
  docs: ReadonlyArray<DiscoveryUserDoc>,
  options: { now?: Date; thresholds?: Partial<PresenceThresholds> } = {},
): Promise<DiscoveredUser[]> {
  if (docs.length === 0) return [];
  const ids = docs.map((doc) => doc._id);
  const friendshipIndex = await loadFriendshipIndex(viewer, ids);
  const presenceOptions = {
    now: options.now ?? new Date(),
    thresholds: options.thresholds,
  };
  return docs.map((doc) => {
    const friendship =
      friendshipIndex.get(doc._id.toString()) ?? { status: null, direction: null };
    return {
      id: doc._id.toString(),
      name: displayName(doc),
      avatarUrl: avatarUrl(doc),
      isGuest: Boolean(doc.isGuest),
      presence: summarizePresence(
        {
          lastActiveAt: doc.lastActiveAt,
          manualStatus: doc.manualStatus ?? null,
          watching: doc.watching ?? null,
        },
        presenceOptions,
      ),
      friendship,
    };
  });
}

export interface SearchUsersOptions {
  /** Maximum number of results to return. Defaults to 20. */
  limit?: number;
  /** Skip the viewer + blocked pairs. Defaults to true. */
  excludeBlocked?: boolean;
  /** Hide guests from search results. Defaults to true. */
  excludeGuests?: boolean;
  /** Inject `now` for testing. */
  now?: Date;
  thresholds?: Partial<PresenceThresholds>;
}

/**
 * Escape a string for safe insertion into a regex literal.
 *
 * Exported for tests; production callers should go through
 * `searchUsers()`.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Search users by display name, Telegram username, or Google email.
 *
 * `query` is treated as a case-insensitive substring. Queries shorter
 * than 2 characters return an empty list to avoid scanning the entire
 * users collection from autocomplete.
 */
export async function searchUsers(
  viewerId: string | Types.ObjectId,
  query: string,
  options: SearchUsersOptions = {},
): Promise<DiscoveredUser[]> {
  const viewer = asObjectId(viewerId);
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const regex = new RegExp(escapeRegex(trimmed), "i");

  const blockedIds: Types.ObjectId[] = [];
  if (options.excludeBlocked !== false) {
    const blockedRows = await Friendship.find({
      $or: [{ userA: viewer }, { userB: viewer }],
      status: "blocked",
    })
      .select({ userA: 1, userB: 1 })
      .lean<Array<{ userA: Types.ObjectId; userB: Types.ObjectId }>>();
    for (const row of blockedRows) {
      blockedIds.push(
        row.userA.toString() === viewer.toString() ? row.userB : row.userA,
      );
    }
  }

  const filter: FilterQuery<UserDoc> = {
    _id: { $ne: viewer, $nin: blockedIds },
    $or: [
      { googleName: regex },
      { googleEmail: regex },
      { telegramUsername: regex },
      { telegramFirstName: regex },
      { guestName: regex },
    ],
  };
  if (options.excludeGuests !== false) filter.isGuest = { $ne: true };

  const docs = await User.find(filter)
    .select(USER_PROJECTION)
    .sort({ lastActiveAt: -1, _id: 1 })
    .limit(limit)
    .lean<DiscoveryUserDoc[]>();
  return hydrateDiscovered(viewer, docs, options);
}

export interface SuggestFriendsOptions {
  limit?: number;
  now?: Date;
  thresholds?: Partial<PresenceThresholds>;
}

/**
 * Suggest people to befriend. Heuristic order:
 *
 *  1. **Mutual friends** — users who already share an accepted friend
 *     with the viewer. Scored by mutual count, then by recency of the
 *     mutual's last activity.
 *  2. **Same room** — users currently sitting in any room the viewer is
 *     also in. Useful for "you're watching together right now, add as a
 *     friend?" prompts.
 *
 * Already-friends, pending, and blocked rows are filtered out. Returns
 * at most `limit` rows (default 10).
 */
export async function suggestFriends(
  viewerId: string | Types.ObjectId,
  options: SuggestFriendsOptions = {},
): Promise<DiscoveredUser[]> {
  const viewer = asObjectId(viewerId);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);

  const myFriendships = await Friendship.find({
    $or: [{ userA: viewer }, { userB: viewer }],
  })
    .select({ userA: 1, userB: 1, status: 1 })
    .lean<Array<{ userA: Types.ObjectId; userB: Types.ObjectId; status: string }>>();
  const friendIds: Types.ObjectId[] = [];
  const excluded = new Set<string>([viewer.toString()]);
  for (const row of myFriendships) {
    const other = row.userA.toString() === viewer.toString() ? row.userB : row.userA;
    excluded.add(other.toString());
    if (row.status === "accepted") friendIds.push(other);
  }

  const score = new Map<string, number>();
  if (friendIds.length > 0) {
    const secondHopRows = await Friendship.find({
      $or: [
        { userA: { $in: friendIds }, status: "accepted" },
        { userB: { $in: friendIds }, status: "accepted" },
      ],
    })
      .select({ userA: 1, userB: 1 })
      .lean<Array<{ userA: Types.ObjectId; userB: Types.ObjectId }>>();
    const friendSet = new Set(friendIds.map((id) => id.toString()));
    for (const row of secondHopRows) {
      const aIsFriend = friendSet.has(row.userA.toString());
      const bIsFriend = friendSet.has(row.userB.toString());
      // Find the "friend of friend" side of this pair.
      const candidate = aIsFriend && !bIsFriend ? row.userB : !aIsFriend && bIsFriend ? row.userA : null;
      if (!candidate) continue;
      const key = candidate.toString();
      if (excluded.has(key)) continue;
      score.set(key, (score.get(key) ?? 0) + 1);
    }
  }

  const myRooms = await Room.find({
    "participants.userId": viewer,
    isClosed: { $ne: true },
  })
    .select({ participants: 1 })
    .lean<Array<{ participants: Array<{ userId: Types.ObjectId }> }>>();
  for (const room of myRooms) {
    for (const p of room.participants) {
      const key = p.userId.toString();
      if (excluded.has(key)) continue;
      // "Same room right now" is worth two mutual friends to surface
      // it ahead of cold mutual recommendations.
      score.set(key, (score.get(key) ?? 0) + 2);
    }
  }

  if (score.size === 0) return [];
  const ranked = Array.from(score.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => new Types.ObjectId(id));

  const docs = await User.find({ _id: { $in: ranked }, isGuest: { $ne: true } })
    .select(USER_PROJECTION)
    .lean<DiscoveryUserDoc[]>();
  const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));
  const ordered = ranked
    .map((id) => byId.get(id.toString()))
    .filter((doc): doc is DiscoveryUserDoc => Boolean(doc));
  return hydrateDiscovered(viewer, ordered, options);
}

export interface FriendsInRoomOptions {
  now?: Date;
  thresholds?: Partial<PresenceThresholds>;
}

/**
 * Return the viewer's friends who are currently participants of the
 * given room. The viewer themselves is excluded.
 */
export async function getFriendsInRoom(
  viewerId: string | Types.ObjectId,
  roomCode: string,
  options: FriendsInRoomOptions = {},
): Promise<DiscoveredUser[]> {
  const viewer = asObjectId(viewerId);
  const room = await Room.findOne({ code: roomCode })
    .select({ participants: 1 })
    .lean<{ participants: Array<{ userId: Types.ObjectId }> } | null>();
  if (!room) return [];
  const participantIds = room.participants
    .map((p) => p.userId)
    .filter((id) => id.toString() !== viewer.toString());
  if (participantIds.length === 0) return [];

  const friendshipRows = await Friendship.find({
    status: "accepted",
    $or: [
      { userA: viewer, userB: { $in: participantIds } },
      { userB: viewer, userA: { $in: participantIds } },
    ],
  })
    .select({ userA: 1, userB: 1 })
    .lean<Array<{ userA: Types.ObjectId; userB: Types.ObjectId }>>();
  const friendIds = friendshipRows.map((row) =>
    row.userA.toString() === viewer.toString() ? row.userB : row.userA,
  );
  if (friendIds.length === 0) return [];

  const docs = await User.find({ _id: { $in: friendIds } })
    .select(USER_PROJECTION)
    .lean<DiscoveryUserDoc[]>();
  return hydrateDiscovered(viewer, docs, options);
}

/**
 * Return all accepted friends who currently have a `watching` payload
 * (regardless of which room). Useful for "your friends are watching"
 * surfaces.
 */
export async function getFriendsCurrentlyWatching(
  viewerId: string | Types.ObjectId,
  options: FriendsInRoomOptions = {},
): Promise<DiscoveredUser[]> {
  const viewer = asObjectId(viewerId);
  const friendshipRows = await Friendship.find({
    status: "accepted",
    $or: [{ userA: viewer }, { userB: viewer }],
  })
    .select({ userA: 1, userB: 1 })
    .lean<Array<{ userA: Types.ObjectId; userB: Types.ObjectId }>>();
  const friendIds = friendshipRows.map((row) =>
    row.userA.toString() === viewer.toString() ? row.userB : row.userA,
  );
  if (friendIds.length === 0) return [];

  const docs = await User.find({
    _id: { $in: friendIds },
    "watching.roomCode": { $exists: true, $ne: null },
  })
    .select(USER_PROJECTION)
    .sort({ "watching.startedAt": -1 })
    .lean<DiscoveryUserDoc[]>();
  return hydrateDiscovered(viewer, docs, options);
}

export const __friendDiscoveryTest__ = {
  displayName,
  avatarUrl,
  loadFriendshipIndex,
};
