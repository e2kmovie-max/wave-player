import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Lightweight description of what a user is currently watching.
 *
 * Populated by `recordWatchingHeartbeat()` from the social `presence`
 * module. Embedded on the user so the friends list can render
 * "watching XYZ on YouTube" without joining onto the Room collection.
 *
 * `service` is the canonical short id we resolve from `videoUrl`
 * (`"youtube"`, `"twitch"`, `"vimeo"`, …). When the URL does not match a
 * known host we still store the host as `unknown` and keep the raw host
 * in `serviceHost` so UI code can fall back gracefully.
 */
const watchingSchema = new Schema(
  {
    roomCode: { type: String, required: true },
    videoUrl: { type: String },
    videoTitle: { type: String },
    videoThumbnail: { type: String },
    /** Canonical short service id — see `detectVideoService()`. */
    service: { type: String, required: true, default: "unknown" },
    /** Human service label (e.g. "YouTube"). Mirrors `service` for unknown hosts. */
    serviceLabel: { type: String, required: true, default: "Unknown" },
    /** Raw URL host so unknown services can still be displayed. */
    serviceHost: { type: String },
    /** Last time the user heart-beated that they're watching this. */
    startedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    googleId: { type: String, index: true, sparse: true, unique: true },
    googleEmail: { type: String, index: true },
    googleName: { type: String },
    googleAvatar: { type: String },

    guestName: { type: String },
    isGuest: { type: Boolean, default: false, index: true },

    telegramId: { type: Number, index: true, sparse: true, unique: true },
    telegramUsername: { type: String },
    telegramFirstName: { type: String },
    telegramLastName: { type: String },
    telegramPhotoUrl: { type: String },

    isAdmin: { type: Boolean, default: false },

    /** Last channel-subscription verification result for OP. */
    hasPassedOp: { type: Boolean, default: false },
    lastOpAt: { type: Date },

    /** When user starts the bot via t.me/<bot>?start=<payload>, store the most recent one. */
    lastStartPayload: { type: String },

    // -----------------------------------------------------------------
    // Presence / friends list status. See `presence.ts` for the helpers
    // that mutate these fields and `computePresence()` for the derived
    // status (`online | idle | sleeping | offline | watching`).
    // -----------------------------------------------------------------

    /** Last time the user pinged the server from any client. */
    lastActiveAt: { type: Date, index: true },

    /**
     * Optional manual status the user picked themselves.
     *  - `"sleeping"`  → explicit Do Not Disturb / I'm asleep.
     *  - `"online"`    → forced online even when activity is stale.
     *  - `"offline"`   → forced offline (appears invisible to friends).
     *  - `null`        → automatic (derived from `lastActiveAt`/`watching`).
     */
    manualStatus: {
      type: String,
      enum: ["online", "sleeping", "offline"],
      default: null,
    },

    /**
     * Embedded "what am I watching right now" record. Cleared on
     * explicit room-leave or after the heartbeat goes stale.
     */
    watching: { type: watchingSchema, default: null },
  },
  { timestamps: true },
);

userSchema.index(
  { googleId: 1, telegramId: 1 },
  { name: "user_identity" },
);

userSchema.index(
  { lastActiveAt: -1 },
  { name: "user_presence_activity" },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export type UserModel = Model<UserDoc>;

export const User: UserModel =
  (models.User as UserModel) ?? model<UserDoc>("User", userSchema);
