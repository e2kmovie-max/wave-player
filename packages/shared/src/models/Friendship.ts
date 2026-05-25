import { Schema, model, models, type InferSchemaType, type Model, Types } from "mongoose";

/**
 * A directional friendship request that becomes mutual once accepted.
 *
 * The document represents a single pair of users; we always store the
 * pair with the lower `_id` in `userA` and the higher one in `userB` so
 * (a → b) and (b → a) collapse onto the same row and the unique index
 * stays small. `requestedBy` is preserved so the UI can show "Foo sent
 * you a request" vs. "You requested Foo".
 *
 * Lifecycle:
 *  - `pending`  → `requestedBy` waiting on the other side.
 *  - `accepted` → both users are now friends.
 *  - `blocked`  → the pair is hidden from each other's friend list.
 *
 * `declined` requests are deleted outright so the requester can try
 * again later (subject to a future rate-limit pass).
 */
const friendshipSchema = new Schema(
  {
    /** Canonical lower-_id user in the pair. */
    userA: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Canonical higher-_id user in the pair. */
    userB: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Which side initiated the request — must be userA or userB. */
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    status: {
      type: String,
      enum: ["pending", "accepted", "blocked"],
      required: true,
      default: "pending",
      index: true,
    },

    /** Set on `acceptFriendRequest()` so the UI can sort by recency. */
    acceptedAt: { type: Date },
    /** Set on `blockFriend()`. */
    blockedAt: { type: Date },
    /** Which user pressed "block" — block is intentionally directional. */
    blockedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

friendshipSchema.index(
  { userA: 1, userB: 1 },
  { name: "friendship_pair_unique", unique: true },
);

export type FriendshipDoc = InferSchemaType<typeof friendshipSchema> & {
  _id: Types.ObjectId;
};
export type FriendshipModel = Model<FriendshipDoc>;

export const Friendship: FriendshipModel =
  (models.Friendship as FriendshipModel) ??
  model<FriendshipDoc>("Friendship", friendshipSchema);
