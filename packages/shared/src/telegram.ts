import { createHmac } from "node:crypto";

/**
 * Verifies and parses Telegram Mini App `initData` per the spec:
 *   https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Algorithm:
 *   secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
 *   data_check_string = "\n".join("{k}={v}" for k,v in sorted(params if k != "hash"))
 *   expected = HEX( HMAC_SHA256(key=secret_key, message=data_check_string) )
 *   compare expected vs the `hash` param (constant-time)
 *
 * Returns the decoded user payload + auth_date when valid; otherwise null.
 */

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export interface TelegramInitData {
  user?: TelegramInitDataUser;
  receiver?: TelegramInitDataUser;
  start_param?: string;
  auth_date: number;
  query_id?: string;
  chat_type?: string;
  chat_instance?: string;
  hash: string;
  raw: Record<string, string>;
}

export interface VerifyOptions {
  /** Reject initData older than this many seconds. Default: 86400 (24h). */
  maxAgeSeconds?: number;
}

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  opts: VerifyOptions = {},
): TelegramInitData | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const entries: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    entries.push([k, v]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (expected.length !== hash.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  if (diff !== 0) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const maxAge = opts.maxAgeSeconds ?? 86400;
  if (Math.floor(Date.now() / 1000) - authDate > maxAge) return null;

  const raw: Record<string, string> = {};
  for (const [k, v] of params.entries()) raw[k] = v;

  let user: TelegramInitDataUser | undefined;
  let receiver: TelegramInitDataUser | undefined;
  try {
    if (raw.user) user = JSON.parse(raw.user) as TelegramInitDataUser;
    if (raw.receiver) receiver = JSON.parse(raw.receiver) as TelegramInitDataUser;
  } catch {
    return null;
  }

  return {
    user,
    receiver,
    start_param: raw.start_param,
    auth_date: authDate,
    query_id: raw.query_id,
    chat_type: raw.chat_type,
    chat_instance: raw.chat_instance,
    hash,
    raw,
  };
}
