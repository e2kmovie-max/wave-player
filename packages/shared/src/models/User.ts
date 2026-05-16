import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

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
  },
  { timestamps: true },
);

userSchema.index(
  { googleId: 1, telegramId: 1 },
  { name: "user_identity" },
);

export type UserDoc = InferSchemaType<typeof userSchema>;
export type UserModel = Model<UserDoc>;

export const User: UserModel =
  (models.User as UserModel) ?? model<UserDoc>("User", userSchema);
