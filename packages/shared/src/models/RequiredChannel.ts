import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A Telegram chat (channel/group) the bot will require users to join before
 * they can create or join a room. Configured by an admin via the bot admin
 * panel (Stage 4).
 */
const requiredChannelSchema = new Schema(
  {
    /**
     * Telegram chat identifier — either a `@username` for public channels
     * or a numeric `-100…` chat ID for private ones.
     */
    chatId: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    inviteLink: { type: String },
    enabled: { type: Boolean, default: true },
    /** Display order in the subscription prompt (lower first). */
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type RequiredChannelDoc = InferSchemaType<typeof requiredChannelSchema>;
export type RequiredChannelModel = Model<RequiredChannelDoc>;

export const RequiredChannel: RequiredChannelModel =
  (models.RequiredChannel as RequiredChannelModel) ??
  model<RequiredChannelDoc>("RequiredChannel", requiredChannelSchema);
