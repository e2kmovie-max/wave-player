/**
 * Friendship CRUD + friends-list query.
 *
 * The model lives in `models/Friendship.ts`. This module exposes the
 * high-level operations route handlers and the bot share:
 *
 *  - `sendFriendRequest()` — idempotently create / re-use a pending pair.
 *  - `acceptFriendRequest()` — flip a pending pair to accepted.
 *  - `declineFriendRequest()` — delete the pending row.
 *  - `removeFriend()` — delete an accepted pair (either side may call).
 *  - `blockFriend()` / `unblockFriend()` — direction-aware blocklist.
 *  - `listFriends()` — return the user's friends with their derived
 *    presence summary so the UI can render the list in one fetch.
 *
 * Pairs are canonicalised so (`u1`, `u2`) and (`u2`, `u1`) refer to the
 * same row. The unique `(userA, userB)` index on the model enforces this
 * at the storage layer; this module enforces it at the API layer.
 */

import { Types } from "mongoose";
import { Friendship, type FriendshipDoc } from "./models/Friendship";
import { User, type UserDoc } from "./models/User";
import { summarizePresence, type PresenceSummary, type PresenceThresholds } from "./presence";

export class FriendshipError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "FriendshipError";
  }
}

export type FriendshipStatus = "pending" | "accepted" | "blocked";

export interface FriendUserView {
  id: string;
  /** Best display name available — Google → Telegram → guest → email. */
  name: string;
  avatarUrl: string | null;
  isGuest: boolean;
  presence: PresenceSummary;
}

export interface FriendView {
  /** The friend (the *other* user, not the viewer). */
  user: FriendUserView;
  friendshipId: string;
  status: FriendshipStatus;
  /** `incoming` means the *other* side requested it. */
  direction: "incoming" | "outgoing" | "mutual";
  acceptedAt: string | null;
  createdAt: string;
}

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

/**
 * Always store the lower _id in `userA` so (a → b) and (b → a) collapse
 * onto the same document. Returns the canonical pair plus the original
 * sides so callers can answer "did I request this or did they?".
 */
function canonicalPair(
  a: Types.ObjectId,
  b: Types.ObjectId,
): { userA: Types.ObjectId; userB: Types.ObjectId } {
  if (a.toString() === b.toString()) {
    throw new FriendshipError("Cannot befriend yourself.", 400);
  }
  return a.toString() < b.toString() ? { userA: a, userB: b } : { userA: b, userB: a };
}

/**
 * Idempotently create a pending request from `fromId` → `toId`.
 *
 * Behaviour:
 *  - No existing row → create with `status="pending"`, `requestedBy=fromId`.
 *  - Existing pending in the reverse direction → flip to `accepted`
 *    (the second side accepting their incoming request is the natural
 *    "send" flow on a mobile keyboard, so we treat it as accept).
 *  - Existing accepted → no-op.
 *  - Existing blocked by either side → throw 403.
 */
export async function sendFriendRequest(
  fromId: string | Types.ObjectId,
  toId: string | Types.ObjectId,
): Promise<FriendshipDoc> {
  const from = asObjectId(fromId);
  const to = asObjectId(toId);
  const pair = canonicalPair(from, to);

  const target = await User.findById(to).select({ _id: 1 }).lean();
  if (!target) throw new FriendshipError("That user does not exist.", 404);

  const existing = await Friendship.findOne(pair);
  if (existing) {
    if (existing.status === "blocked") {
      throw new FriendshipError("This pair is blocked.", 403);
    }
    if (existing.status === "accepted") return existing;
    // status === "pending"
    if (existing.requestedBy.toString() === from.toString()) {
      // Re-sending the same direction is a no-op.
      return existing;
    }
    // Other side already requested — accept.
    existing.status = "accepted";
    existing.acceptedAt = new Date();
    await existing.save();
    return existing;
  }

  const created = await Friendship.create({
    userA: pair.userA,
    userB: pair.userB,
    requestedBy: from,
    status: "pending",
  });
  return created;
}

/**
 * Accept a pending request that targets `viewerId`. Returns the updated
 * doc. Throws 404 if no matching pending row, 400 if the viewer is the
 * requester (can't accept your own request), 403 if blocked.
 */
export async function acceptFriendRequest(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<FriendshipDoc> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const pair = canonicalPair(viewer, other);

  const doc = await Friendship.findOne(pair);
  if (!doc) throw new FriendshipError("No pending request from that user.", 404);
  if (doc.status === "blocked") throw new FriendshipError("This pair is blocked.", 403);
  if (doc.status === "accepted") return doc;
  if (doc.requestedBy.toString() === viewer.toString()) {
    throw new FriendshipError("You cannot accept your own request.", 400);
  }
  doc.status = "accepted";
  doc.acceptedAt = new Date();
  await doc.save();
  return doc;
}

/**
 * Decline (delete) a pending incoming request. Returns true when a row
 * was removed. Throws 400 if the row is accepted (callers should use
 * `removeFriend()` for that).
 */
export async function declineFriendRequest(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<boolean> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const pair = canonicalPair(viewer, other);

  const doc = await Friendship.findOne(pair);
  if (!doc) return false;
  if (doc.status === "accepted") {
    throw new FriendshipError("Already friends — use removeFriend() instead.", 409);
  }
  if (doc.status === "blocked") {
    throw new FriendshipError("This pair is blocked.", 403);
  }
  if (doc.requestedBy.toString() === viewer.toString()) {
    // Declining your own outgoing request is just "cancel".
  }
  await doc.deleteOne();
  return true;
}

/**
 * Cancel an outgoing pending request you sent. Equivalent to
 * `declineFriendRequest()` semantically, but exposed separately so
 * route handlers can name the operation correctly.
 */
export async function cancelFriendRequest(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<boolean> {
  return declineFriendRequest(viewerId, otherId);
}

/**
 * Remove an accepted friendship. Either side may call. Returns true
 * when a row was removed.
 */
export async function removeFriend(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<boolean> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const pair = canonicalPair(viewer, other);

  const res = await Friendship.deleteOne({ ...pair, status: "accepted" });
  return res.deletedCount > 0;
}

/**
 * Block another user. The block is intentionally directional — the
 * `blockedBy` field records the side that hit the button so admins can
 * inspect after the fact, but the pair is hidden from both list views.
 */
export async function blockFriend(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<FriendshipDoc> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const pair = canonicalPair(viewer, other);

  const now = new Date();
  const doc = await Friendship.findOneAndUpdate(
    pair,
    {
      $set: { status: "blocked", blockedAt: now, blockedBy: viewer },
      $setOnInsert: { requestedBy: viewer },
    },
    { upsert: true, new: true },
  );
  return doc;
}

/**
 * Reverse a block. Only the user who set the block may clear it; if
 * any other viewer calls this we throw 403.
 */
export async function unblockFriend(
  viewerId: string | Types.ObjectId,
  otherId: string | Types.ObjectId,
): Promise<boolean> {
  const viewer = asObjectId(viewerId);
  const other = asObjectId(otherId);
  const pair = canonicalPair(viewer, other);

  const doc = await Friendship.findOne(pair);
  if (!doc) return false;
  if (doc.status !== "blocked") return false;
  if (doc.blockedBy && doc.blockedBy.toString() !== viewer.toString()) {
    throw new FriendshipError("Only the blocker can unblock.", 403);
  }
  await doc.deleteOne();
  return true;
}

export interface ListFriendsOptions {
  /** Filter by friendship status. Defaults to `"accepted"`. */
  status?: FriendshipStatus | "all";
  /** Forwarded to `summarizePresence()`. */
  presenceThresholds?: Partial<PresenceThresholds>;
  /** Inject `now` for testing. */
  now?: Date;
}

interface FriendshipPairLite {
  _id: Types.ObjectId;
  userA: Types.ObjectId;
  userB: Types.ObjectId;
  requestedBy: Types.ObjectId;
  status: FriendshipStatus;
  acceptedAt?: Date | null;
  blockedBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
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

type FriendUserDoc = UserPresenceFields & { _id: Types.ObjectId };

/**
 * Return the viewer's friends list with full presence + watching info.
 *
 * Defaults to `status: "accepted"`. Pass `"pending"` to fetch incoming +
 * outgoing requests, `"blocked"` for blocked rows, or `"all"` to fetch
 * the full pairs list (used by admin tools).
 */
export async function listFriends(
  viewerId: string | Types.ObjectId,
  options: ListFriendsOptions = {},
): Promise<FriendView[]> {
  const viewer = asObjectId(viewerId);
  const filter: Record<string, unknown> = {
    $or: [{ userA: viewer }, { userB: viewer }],
  };
  if (options.status && options.status !== "all") {
    filter.status = options.status;
  } else if (!options.status) {
    filter.status = "accepted";
  }
  const rows = await Friendship.find(filter)
    .sort({ acceptedAt: -1, updatedAt: -1 })
    .lean<FriendshipPairLite[]>();

  const otherIds = rows.map((row) =>
    row.userA.toString() === viewer.toString() ? row.userB : row.userA,
  );
  if (otherIds.length === 0) return [];

  const users = await User.find({ _id: { $in: otherIds } })
    .select({
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
    })
    .lean<FriendUserDoc[]>();
  const byId = new Map<string, FriendUserDoc>();
  for (const user of users) byId.set(user._id.toString(), user);

  const presenceOptions = {
    now: options.now ?? new Date(),
    thresholds: options.presenceThresholds,
  };

  return rows
    .map((row) => {
      const otherId =
        row.userA.toString() === viewer.toString() ? row.userB : row.userA;
      const user = byId.get(otherId.toString());
      if (!user) return null;
      const direction = computeDirection(row, viewer);
      const friendView: FriendView = {
        user: {
          id: user._id.toString(),
          name: displayName(user),
          avatarUrl: avatarUrl(user),
          isGuest: Boolean(user.isGuest),
          presence: summarizePresence(
            {
              lastActiveAt: user.lastActiveAt,
              manualStatus: user.manualStatus ?? null,
              watching: user.watching ?? null,
            },
            presenceOptions,
          ),
        },
        friendshipId: row._id.toString(),
        status: row.status,
        direction,
        acceptedAt: row.acceptedAt ? new Date(row.acceptedAt).toISOString() : null,
        createdAt: (row.createdAt ?? new Date()).toISOString(),
      };
      return friendView;
    })
    .filter((value): value is FriendView => value !== null);
}

function computeDirection(
  row: FriendshipPairLite,
  viewer: Types.ObjectId,
): "incoming" | "outgoing" | "mutual" {
  if (row.status === "accepted") return "mutual";
  return row.requestedBy.toString() === viewer.toString() ? "outgoing" : "incoming";
}

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
 * Return the friendship row between two users, in canonical form.
 * Returns null when there is no row.
 */
export async function getFriendship(
  a: string | Types.ObjectId,
  b: string | Types.ObjectId,
): Promise<FriendshipDoc | null> {
  const pair = canonicalPair(asObjectId(a), asObjectId(b));
  return Friendship.findOne(pair);
}

export const __friendsTest__ = {
  canonicalPair,
  computeDirection,
  displayName,
  avatarUrl,
};
