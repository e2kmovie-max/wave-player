/**
 * Cookie payload parser shared by the cookie-pool admin helpers and the
 * watch-party runtime path. Lives in its own module so neither importer needs
 * to depend on the other (the previous shape created a `watch-party.ts` ↔
 * `cookie-pool.ts` circular import).
 *
 * Accepts:
 *  - a Netscape `cookies.txt` blob (the format yt-dlp ships natively); and
 *  - a JSON array of objects matching the Chrome DevTools Protocol cookie shape.
 *
 * The output type matches `InstanceCookie` from `./instance-client` so the
 * shape can be sent straight to the streaming instance.
 */

import type { InstanceCookie } from "./instance-client";

export function parseCookiePayload(payload: string): InstanceCookie[] {
  const trimmed = payload.trim();
  if (trimmed === "") return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("cookie JSON must be an array");
    return parsed.map(parseJsonCookie);
  }
  return parseNetscapeCookies(trimmed);
}

function parseJsonCookie(value: unknown): InstanceCookie {
  if (!isRecord(value)) throw new Error("cookie must be an object");
  const name = asString(value.name);
  const cookieValue = asString(value.value);
  const domain = asString(value.domain);
  if (!name || !domain) throw new Error("cookie requires name and domain");
  const expires = typeof value.expires === "number" ? value.expires : undefined;
  return {
    name,
    value: cookieValue,
    domain,
    path: typeof value.path === "string" ? value.path : "/",
    expires,
    secure: typeof value.secure === "boolean" ? value.secure : undefined,
    httpOnly: typeof value.httpOnly === "boolean" ? value.httpOnly : undefined,
  };
}

function parseNetscapeCookies(payload: string): InstanceCookie[] {
  const cookies: InstanceCookie[] = [];
  for (const rawLine of payload.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) continue;
    const httpOnly = line.startsWith("#HttpOnly_");
    const normalized = httpOnly ? line.replace(/^#HttpOnly_/, "") : line;
    const parts = normalized.split("\t");
    if (parts.length < 7) continue;
    const [domain, , path, secureRaw, expiresRaw, name, ...valueParts] = parts;
    if (!domain || !name) continue;
    const expires = Number(expiresRaw);
    cookies.push({
      domain,
      path: path || "/",
      secure: secureRaw?.toUpperCase() === "TRUE",
      expires: Number.isFinite(expires) ? expires : undefined,
      name,
      value: valueParts.join("\t"),
      httpOnly,
    });
  }
  return cookies;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
