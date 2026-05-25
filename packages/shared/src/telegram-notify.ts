/**
 * Minimal HTTP wrapper over the Telegram Bot API used by the web side.
 *
 * The web app needs to push a "Google account linked" confirmation back into
 * the Telegram chat after a successful /tg-auth flow. We don't want to keep a
 * grammY runtime hot in the web process, so we just call sendMessage directly.
 *
 * Errors are non-fatal: callers swallow them (we still want to redirect the
 * user to the success page even if Telegram's API hiccups).
 */

import { getEnv } from "./env";

const API_BASE = "https://api.telegram.org";

export interface SendBotMessageInput {
  chatId: number | string;
  text: string;
  /** Defaults to "HTML" (matches the rest of the bot). */
  parseMode?: "HTML" | "MarkdownV2";
  /** Defaults to true. */
  disableWebPagePreview?: boolean;
  /** Override bot token; defaults to env.BOT_TOKEN. */
  botToken?: string;
}

export interface SendBotMessageResult {
  ok: boolean;
  errorCode?: number;
  description?: string;
}

export async function sendBotMessage(
  input: SendBotMessageInput,
): Promise<SendBotMessageResult> {
  const token = input.botToken ?? getEnv().BOT_TOKEN;
  if (!token) return { ok: false, description: "bot_token_not_configured" };

  const body = {
    chat_id: input.chatId,
    text: input.text,
    parse_mode: input.parseMode ?? "HTML",
    disable_web_page_preview: input.disableWebPagePreview ?? true,
  };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, description: `network_error: ${(err as Error).message}` };
  }

  let data: { ok?: boolean; error_code?: number; description?: string } = {};
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, description: `non_json_response: HTTP ${res.status}` };
  }
  if (!res.ok || !data.ok) {
    return {
      ok: false,
      errorCode: data.error_code,
      description: data.description ?? `HTTP ${res.status}`,
    };
  }
  return { ok: true };
}
