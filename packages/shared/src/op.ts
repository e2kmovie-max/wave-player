/**
 * Required-channel subscription (OP — "обязательная подписка") helpers.
 *
 * The bot uses these helpers to:
 *   1. Parse admin input into a canonical channel identifier (`@username` or
 *      a numeric `-100…` ID).
 *   2. Decide which RequiredChannel records a user is still missing.
 *   3. Build the inline keyboard shown to a non-subscribed user.
 *
 * The Telegram API calls (`getChatMember`) live in the bot package since
 * shared is dependency-free of grammY. Shared exposes the pure logic and the
 * "is this membership status sufficient" predicate so the bot can pass back
 * whatever `getChatMember` returns.
 */

import { RequiredChannel, type RequiredChannelDoc } from "./models/RequiredChannel";

export interface ParsedChannelInput {
  /** Canonical chatId we store on the RequiredChannel doc. */
  chatId: string;
  /** Human title (taken from the input when available; falls back to chatId). */
  title: string;
  /** Optional invite link (e.g. https://t.me/+...) parsed from the input. */
  inviteLink?: string;
}

const PUBLIC_LINK_RE = /^https?:\/\/(?:t(?:elegram)?\.me|t\.me)\/([A-Za-z0-9_]+)\/?$/i;
const PRIVATE_INVITE_RE = /^https?:\/\/(?:t(?:elegram)?\.me|t\.me)\/\+[A-Za-z0-9_-]+\/?$/i;
const USERNAME_RE = /^@?([A-Za-z][A-Za-z0-9_]{3,31})$/;
const NUMERIC_ID_RE = /^-?\d+$/;

/**
 * Parse an admin-supplied channel reference. Returns null when the input does
 * not look like a public username, numeric chat id, or t.me link.
 */
export function parseChannelInput(raw: string): ParsedChannelInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const publicMatch = PUBLIC_LINK_RE.exec(trimmed);
  if (publicMatch && publicMatch[1]) {
    const username = publicMatch[1];
    return { chatId: `@${username}`, title: `@${username}` };
  }

  if (PRIVATE_INVITE_RE.test(trimmed)) {
    // Private invite link — we don't know the chat_id from the link alone.
    // Admin will need to forward a message from the channel for us to learn it.
    return null;
  }

  const usernameMatch = USERNAME_RE.exec(trimmed);
  if (usernameMatch && usernameMatch[1]) {
    const username = usernameMatch[1];
    return { chatId: `@${username}`, title: `@${username}` };
  }

  if (NUMERIC_ID_RE.test(trimmed)) {
    return { chatId: trimmed, title: trimmed };
  }

  return null;
}

/**
 * Determines whether a Telegram `getChatMember` status counts as a passing
 * subscription. We treat `member`, `administrator`, `creator`, and `restricted`
 * (still in the chat) as subscribed; everything else is missing.
 */
export function isSubscribedStatus(status: string | null | undefined): boolean {
  switch (status) {
    case "creator":
    case "administrator":
    case "member":
    case "restricted":
      return true;
    default:
      return false;
  }
}

export interface RequiredChannelLite {
  chatId: string;
  title: string;
  inviteLink?: string;
}

/** Returns all enabled required channels, sorted by `sortOrder` then `_id`. */
export async function listEnabledRequiredChannels(): Promise<RequiredChannelDoc[]> {
  return RequiredChannel.find({ enabled: true })
    .sort({ sortOrder: 1, _id: 1 })
    .lean<RequiredChannelDoc[]>();
}

/** Returns the chat-ids the user is NOT subscribed to, given a status lookup. */
export function findMissingSubscriptions(
  channels: RequiredChannelLite[],
  statuses: Record<string, string | null | undefined>,
): RequiredChannelLite[] {
  return channels.filter((channel) => !isSubscribedStatus(statuses[channel.chatId]));
}

export const __opTest__ = {
  parseChannelInput,
  isSubscribedStatus,
  findMissingSubscriptions,
};
