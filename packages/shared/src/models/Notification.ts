import { Schema, model, models, type InferSchemaType, type Model, Types } from "mongoose";

/**
 * Persistent notification inbox.
 *
 * Used to back the "friends bell" surface — when a friend sends a
 * request, accepts your request, comes online, or starts watching, we
 * push a row in here so the UI can render an unread badge that
 * survives across sessions and devices.
 *
 * Each row has:
 *  - `userId`     — the recipient.
 *  - `type`       — one of the canonical event kinds (see `NOTIFICATION_TYPES`).
 *  - `actorId`    — the user who triggered the notification (optional —
 *                   for system events).
 *  - `payload`    — free-form structured data scoped to the event kind.
 *  - `readAt`     — `null` while unread, set when the user opens the inbox.
 *
 * The collection is intentionally cheap: a single `{ userId, readAt, createdAt }`
 * index covers both "unread for user" and "recent for user" reads, and we
 * mark rows as TTL-expired after 30 days so the inbox doesn't grow forever.
 */
export const NOTIFICATION_TYPES = [
  "friend.request",
  "friend.accepted",
  "friend.online",
  "friend.watching",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    /**
     * Loose payload — varies by `type`. Examples:
     *  - `friend.watching` → `{ roomCode, videoTitle?, service, serviceLabel, videoUrl? }`
     *  - `friend.online`   → `{ }` (no extra data)
     */
    payload: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 }, { name: "notif_inbox" });
// TTL: auto-drop notifications after 30 days. Mongo enforces this in the
// background; calling `clearReadNotifications()` deletes them sooner.
notificationSchema.index(
  { createdAt: 1 },
  { name: "notif_ttl", expireAfterSeconds: 30 * 24 * 60 * 60 },
);

export type NotificationDoc = InferSchemaType<typeof notificationSchema> & {
  _id: Types.ObjectId;
};
export type NotificationModel = Model<NotificationDoc>;

export const Notification: NotificationModel =
  (models.Notification as NotificationModel) ??
  model<NotificationDoc>("Notification", notificationSchema);
