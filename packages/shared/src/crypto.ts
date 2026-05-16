import { createHmac, randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/**
 * Crypto helpers backed by APP_SECRET.
 *
 * - signToken / verifyToken: short HMAC-signed payloads (sessions, deeplinks).
 * - encrypt / decrypt: AES-256-GCM symmetric encryption for cookies-at-rest.
 */

function appKey(salt = "wave/app"): Buffer {
  const { APP_SECRET } = getEnv();
  return scryptSync(APP_SECRET, salt, 32);
}

export interface SignedPayload<T> {
  data: T;
  exp?: number; // unix seconds
}

function b64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signToken<T>(data: T, ttlSeconds?: number): string {
  const payload: SignedPayload<T> = { data };
  if (ttlSeconds) payload.exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac("sha256", appKey("wave/sign")).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken<T>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", appKey("wave/sign")).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return null;
  }
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;
  try {
    const parsed: SignedPayload<T> = JSON.parse(fromB64url(body).toString("utf8"));
    if (parsed.exp && parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey("wave/aead"), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [b64url(iv), b64url(enc), b64url(tag)].join(".");
}

export function decrypt(payload: string): string {
  const [iv, enc, tag] = payload.split(".");
  if (!iv || !enc || !tag) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", appKey("wave/aead"), fromB64url(iv));
  decipher.setAuthTag(fromB64url(tag));
  const dec = Buffer.concat([decipher.update(fromB64url(enc)), decipher.final()]);
  return dec.toString("utf8");
}

export function randomCode(length = 8): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}
