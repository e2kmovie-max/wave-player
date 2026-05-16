/**
 * Web-side OP check. The bot package uses its grammY `api.getChatMember`; the
 * web app can't depend on a running bot instance, so it talks to the Telegram
 * Bot API directly over HTTPS using `BOT_TOKEN`.
 *
 * This module is intentionally tiny and dependency-free of grammY so it can
 * live in the shared package and be tree-shaken into the Next.js bundle.
 */

import {
  findMissingSubscriptions,
  listEnabledRequiredChannels,
  type RequiredChannelLite,
} from "./op";
import { getEnv } from "./env";

interface GetChatMemberResponse {
  ok: boolean;
  result?: { status?: string };
  description?: string;
}

export interface WebOpCheckResult {
  /** True when the user has cleared every enabled RequiredChannel. */
  passed: boolean;
  missing: RequiredChannelLite[];
  /**
   * True when there are no enabled required channels — the gate is a no-op
   * regardless of who is asking.
   */
  gateInactive: boolean;
}

export async function checkTelegramSubscriptions(
  telegramId: number,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<WebOpCheckResult> {
  const channels = await listEnabledRequiredChannels();
  if (channels.length === 0) {
    return { passed: true, missing: [], gateInactive: true };
  }

  const env = getEnv();
  if (!env.BOT_TOKEN) {
    // No bot token configured ⇒ we can't verify, so we surface "all missing"
    // to keep the door closed when OP is intentionally on.
    return {
      passed: false,
      gateInactive: false,
      missing: channels.map((c) => ({
        chatId: c.chatId,
        title: c.title,
        inviteLink: c.inviteLink ?? undefined,
      })),
    };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const statuses: Record<string, string | null> = {};
  for (const channel of channels) {
    statuses[channel.chatId] = await fetchStatus(
      doFetch,
      env.BOT_TOKEN,
      channel.chatId,
      telegramId,
      timeoutMs,
    );
  }
  const lite: RequiredChannelLite[] = channels.map((c) => ({
    chatId: c.chatId,
    title: c.title,
    inviteLink: c.inviteLink ?? undefined,
  }));
  const missing = findMissingSubscriptions(lite, statuses);
  return { passed: missing.length === 0, missing, gateInactive: false };
}

async function fetchStatus(
  doFetch: typeof fetch,
  botToken: string,
  chatId: string,
  userId: number,
  timeoutMs: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, user_id: userId }),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as GetChatMemberResponse | null;
    if (!body || !body.ok) return null;
    return body.result?.status ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
