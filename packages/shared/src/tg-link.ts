/**
 * Helpers for the Telegram → Web Google-linking deeplink.
 *
 * Goal: while a user is inside the Telegram bot, generate a single-use,
 * time-limited link to the web app that — after the user signs in with
 * Google — links that Google identity onto the *same* Wave user as the
 * Telegram identity the link was issued for.
 *
 * The token is HMAC-signed by APP_SECRET (via signToken), so the chat_id
 * inside cannot be spoofed by anyone who doesn't hold the secret.
 *
 * URL shape:
 *   <PUBLIC_WEB_URL>/tg-auth?token=<signed-base64-payload>
 *
 * Lifetime: 10 minutes by default.
 */

import { getEnv } from "./env";
import { signToken, verifyToken } from "./crypto";

/** Default TTL for the deeplink token (seconds). */
export const TG_LINK_TTL_SECONDS = 10 * 60;

/** The signed payload embedded in /tg-auth?token=... */
export interface TgLinkTokenData {
  /** Telegram user id — used both for matching and as private chat id. */
  tgUserId: number;
  /** Telegram chat id to deliver the success notification to. */
  chatId: number;
  /** Display fields for the landing page (no secrets). */
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  /** Language to render the landing page in, when known from Telegram. */
  lang?: "ru" | "en";
}

export function signTgLinkToken(
  data: TgLinkTokenData,
  ttlSeconds: number = TG_LINK_TTL_SECONDS,
): string {
  return signToken<TgLinkTokenData>(data, ttlSeconds);
}

export function verifyTgLinkToken(token: string): TgLinkTokenData | null {
  if (!token) return null;
  return verifyToken<TgLinkTokenData>(token);
}

/**
 * Builds the absolute deeplink URL pointing at the web `/tg-auth` route.
 *
 * We accept the public web base URL as a parameter for testability; defaults
 * to `getEnv().PUBLIC_WEB_URL`.
 */
export function buildTgAuthDeeplink(
  data: TgLinkTokenData,
  opts: { publicWebUrl?: string; ttlSeconds?: number } = {},
): string {
  const base = (opts.publicWebUrl ?? getEnv().PUBLIC_WEB_URL).replace(/\/$/, "");
  const token = signTgLinkToken(data, opts.ttlSeconds ?? TG_LINK_TTL_SECONDS);
  return `${base}/tg-auth?token=${encodeURIComponent(token)}`;
}
