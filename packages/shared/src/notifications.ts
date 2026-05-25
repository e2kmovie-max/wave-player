/**
 * Friend-event notification helpers.
 *
 * The `Notification` collection backs the friends-list inbox (bell
 * icon). This module exposes the small CRUD surface and four
 * convenience emitters that map domain events to inbox rows:
 *
 *  - `notifyFriendRequest()`     — someone sent you a request.
 *  - `notifyFriendAccepted()`    — your request was accepted.
 *  - `notifyFriendCameOnline()`  — a friend came online (rate-limited).
 *  - `notifyFriendWatching()`    — a friend started watching something.
 *
 * The "came online" event is debounced via `Friendship.lastOnlineNotifiedAt`
 * upstream — this module is happy to write a row on every call, but in
 * practice callers should only fire it once per online transition (the
 * caller decides what "online transition" means).
 */

import { Types } from "mongoose";
import { Notification, type NotificationDoc, type NotificationType } from "./models/Notification";
import type { PresenceWatching } from "./presence";

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  /** Recipient. */
  userId: string;
  /** Actor (the friend who caused it). Null for system events. */
  actorId: string | null;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

function toView(doc: NotificationDoc): NotificationView {
  return {
    id: doc._id.toString(),
    type: doc.type as NotificationType,
    userId: doc.userId.toString(),
    actorId: doc.actorId ? doc.actorId.toString() : null,
    payload: (doc.payload as Record<string, unknown>) ?? {},
    readAt: doc.readAt ? new Date(doc.readAt).toISOString() : null,
    createdAt: doc.createdAt
      ? new Date(doc.createdAt as Date).toISOString()
      : new Date().toISOString(),
  };
}

export interface ListNotificationsOptions {
  /** Only return unread rows. Defaults to false (returns both). */
  unreadOnly?: boolean;
  /** Page size. Defaults to 30, capped at 100. */
  limit?: number;
  /** Skip newer than this ISO timestamp (for cursor pagination). */
  before?: Date | string;
}

/**
 * Return the recipient's inbox, newest first.
 */
export async function listNotifications(
  userId: string | Types.ObjectId,
  options: ListNotificationsOptions = {},
): Promise<NotificationView[]> {
  const filter: Record<string, unknown> = { userId: asObjectId(userId) };
  if (options.unreadOnly) filter.readAt = null;
  if (options.before) {
    const cursor = options.before instanceof Date ? options.before : new Date(options.before);
    if (!Number.isNaN(cursor.getTime())) filter.createdAt = { $lt: cursor };
  }
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const rows = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<NotificationDoc[]>();
  return rows.map(toView);
}

/**
 * Count unread notifications for the bell badge.
 */
export async function countUnread(userId: string | Types.ObjectId): Promise<number> {
  return Notification.countDocuments({ userId: asObjectId(userId), readAt: null });
}

/**
 * Mark a batch of notifications as read. Pass an empty array (or
 * nothing) to mark all unread rows for the user.
 */
export async function markRead(
  userId: string | Types.ObjectId,
  notificationIds: ReadonlyArray<string | Types.ObjectId> = [],
): Promise<number> {
  const filter: Record<string, unknown> = {
    userId: asObjectId(userId),
    readAt: null,
  };
  if (notificationIds.length > 0) {
    filter._id = { $in: notificationIds.map(asObjectId) };
  }
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return result.modifiedCount ?? 0;
}

/**
 * Drop already-read notifications. Useful for an explicit "clear inbox"
 * button. TTL also cleans up after 30 days automatically.
 */
export async function clearReadNotifications(
  userId: string | Types.ObjectId,
): Promise<number> {
  const res = await Notification.deleteMany({
    userId: asObjectId(userId),
    readAt: { $ne: null },
  });
  return res.deletedCount ?? 0;
}

interface EmitOptions {
  /**
   * Skip the write when an existing unread notification of the same
   * `type` from the same `actorId` exists for this user. Prevents
   * "friend X came online" from spamming the inbox while a previous
   * online notification is still unread.
   */
  dedupe?: boolean;
  /** Only consider rows newer than this for dedupe (default 24h). */
  dedupeWithinMs?: number;
}

async function emit(
  recipient: Types.ObjectId,
  actor: Types.ObjectId | null,
  type: NotificationType,
  payload: Record<string, unknown>,
  options: EmitOptions = {},
): Promise<NotificationView | null> {
  if (recipient.toString() === actor?.toString()) {
    // Never notify yourself about your own actions.
    return null;
  }
  if (options.dedupe) {
    const since = new Date(Date.now() - (options.dedupeWithinMs ?? 24 * 60 * 60 * 1000));
    const filter: Record<string, unknown> = {
      userId: recipient,
      type,
      readAt: null,
      createdAt: { $gte: since },
    };
    if (actor) filter.actorId = actor;
    const existing = await Notification.findOne(filter)
      .sort({ createdAt: -1 })
      .lean<NotificationDoc | null>();
    if (existing) return toView(existing);
  }
  const doc = await Notification.create({
    userId: recipient,
    actorId: actor ?? undefined,
    type,
    payload,
  });
  return toView(doc);
}

/** Drop a `friend.request` notification on the recipient's inbox. */
export async function notifyFriendRequest(input: {
  recipientId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  actorName?: string;
}): Promise<NotificationView | null> {
  return emit(
    asObjectId(input.recipientId),
    asObjectId(input.actorId),
    "friend.request",
    input.actorName ? { actorName: input.actorName } : {},
    { dedupe: true },
  );
}

/** Drop a `friend.accepted` notification on the original requester. */
export async function notifyFriendAccepted(input: {
  recipientId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  actorName?: string;
}): Promise<NotificationView | null> {
  return emit(
    asObjectId(input.recipientId),
    asObjectId(input.actorId),
    "friend.accepted",
    input.actorName ? { actorName: input.actorName } : {},
    { dedupe: true, dedupeWithinMs: 12 * 60 * 60 * 1000 },
  );
}

/** Drop a (debounced) `friend.online` notification on the recipient's inbox. */
export async function notifyFriendCameOnline(input: {
  recipientId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  actorName?: string;
}): Promise<NotificationView | null> {
  return emit(
    asObjectId(input.recipientId),
    asObjectId(input.actorId),
    "friend.online",
    input.actorName ? { actorName: input.actorName } : {},
    { dedupe: true, dedupeWithinMs: 60 * 60 * 1000 },
  );
}

/**
 * Drop a `friend.watching` notification on the recipient's inbox.
 *
 * Carries enough payload for the UI to render "Alice is watching
 * <Title> on YouTube — join". `videoUrl` is intentionally optional
 * because the UI typically wants the room code (deep link), not the
 * raw stream URL.
 */
export async function notifyFriendWatching(input: {
  recipientId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  actorName?: string;
  watching: PresenceWatching;
}): Promise<NotificationView | null> {
  const { watching } = input;
  const payload: Record<string, unknown> = {
    roomCode: watching.roomCode,
    service: watching.service,
    serviceLabel: watching.serviceLabel,
  };
  if (input.actorName) payload.actorName = input.actorName;
  if (watching.videoTitle) payload.videoTitle = watching.videoTitle;
  if (watching.videoUrl) payload.videoUrl = watching.videoUrl;
  if (watching.videoThumbnail) payload.videoThumbnail = watching.videoThumbnail;
  return emit(
    asObjectId(input.recipientId),
    asObjectId(input.actorId),
    "friend.watching",
    payload,
    { dedupe: true, dedupeWithinMs: 30 * 60 * 1000 },
  );
}
