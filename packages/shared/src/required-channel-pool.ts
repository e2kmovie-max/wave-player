/**
 * CRUD wrappers around the RequiredChannel collection. Used by both the bot
 * admin and the web admin so behaviour stays in lockstep.
 */

import type { HydratedDocument } from "mongoose";
import { RequiredChannel, type RequiredChannelDoc } from "./models/RequiredChannel";

export interface AddChannelInput {
  chatId: string;
  title: string;
  inviteLink?: string;
  sortOrder?: number;
}

export interface RequiredChannelView {
  id: string;
  chatId: string;
  title: string;
  inviteLink?: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export class RequiredChannelError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "RequiredChannelError";
  }
}

export async function addRequiredChannel(
  input: AddChannelInput,
): Promise<HydratedDocument<RequiredChannelDoc>> {
  const chatId = input.chatId.trim();
  if (!chatId) throw new RequiredChannelError("chatId is required.");
  const title = input.title.trim() || chatId;

  const existing = await RequiredChannel.findOne({ chatId });
  if (existing) {
    throw new RequiredChannelError("This channel is already in the list.", 409);
  }
  return RequiredChannel.create({
    chatId,
    title,
    inviteLink: input.inviteLink?.trim() || undefined,
    enabled: true,
    sortOrder: input.sortOrder ?? 0,
  });
}

export async function listRequiredChannels(): Promise<RequiredChannelView[]> {
  const docs = await RequiredChannel.find()
    .sort({ sortOrder: 1, _id: 1 })
    .lean<
      Array<
        RequiredChannelDoc & {
          _id: { toString(): string };
          createdAt?: Date;
          updatedAt?: Date;
        }
      >
    >();
  return docs.map((doc) => ({
    id: String(doc._id),
    chatId: doc.chatId,
    title: doc.title,
    inviteLink: doc.inviteLink || undefined,
    enabled: Boolean(doc.enabled),
    sortOrder: doc.sortOrder ?? 0,
    createdAt: (doc.createdAt ?? new Date()).toISOString(),
    updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
  }));
}

export async function setRequiredChannelEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await RequiredChannel.updateOne({ _id: id }, { $set: { enabled } });
}

export async function deleteRequiredChannel(id: string): Promise<void> {
  await RequiredChannel.deleteOne({ _id: id });
}
