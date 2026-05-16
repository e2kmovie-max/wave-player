import { Schema, model, models, type InferSchemaType, type Model, Types } from "mongoose";

const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: () => new Date() },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const videoFormatSchema = new Schema(
  {
    formatId: { type: String, required: true },
    label: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    fps: { type: Number },
    ext: { type: String },
    vcodec: { type: String },
    acodec: { type: String },
    filesize: { type: Number },
    bitrate: { type: Number },
  },
  { _id: false },
);

const chatMessageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { _id: true },
);

const roomSchema = new Schema(
  {
    /** Short, shareable, URL-safe code (e.g. "K9F2R7BP"). Unique. */
    code: { type: String, required: true, unique: true, index: true },

    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    /** The Go streaming instance currently servicing this room. */
    instanceId: { type: Schema.Types.ObjectId, ref: "Instance" },

    videoUrl: { type: String, required: true },
    videoTitle: { type: String },
    videoDuration: { type: Number },
    videoThumbnail: { type: String },
    videoUploader: { type: String },
    availableFormats: { type: [videoFormatSchema], default: [] },

    selectedFormatId: { type: String },
    quality: { type: String },

    currentTime: { type: Number, default: 0 },
    isPlaying: { type: Boolean, default: false },
    playbackRate: { type: Number, default: 1 },
    lastSyncAt: { type: Date, default: () => new Date() },

    participants: { type: [participantSchema], default: [] },
    chatMessages: { type: [chatMessageSchema], default: [] },

    /** Where the room was created from. */
    source: { type: String, enum: ["web", "bot"], required: true, default: "web" },

    /** When created via bot, the deeplink payload used as t.me/<bot>?start=<payload>. */
    botPayload: { type: String, index: true, sparse: true },

    isClosed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type RoomDoc = InferSchemaType<typeof roomSchema> & { _id: Types.ObjectId };
export type RoomModel = Model<RoomDoc>;

export const Room: RoomModel =
  (models.Room as RoomModel) ?? model<RoomDoc>("Room", roomSchema);
