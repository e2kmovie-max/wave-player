import { Types } from "mongoose";
import { isIP } from "node:net";
import { decrypt, randomCode } from "./crypto";
import { GoogleAccount, Instance, Room } from "./models";
import {
  InstanceClient,
  InstanceError,
  isRotatableInstanceErrorCode,
  type InstanceCookie,
  type InstanceInfo,
} from "./instance-client";
import { parseCookiePayload } from "./cookie-payload";
import { markCookieAccountAutoDisabled } from "./cookie-pool";

export interface RoomVideoFormat {
  formatId: string;
  label: string;
  width?: number;
  height?: number;
  fps?: number;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  bitrate?: number;
}

export interface RoomSyncState {
  currentTime: number;
  isPlaying: boolean;
  playbackRate: number;
  selectedFormatId?: string;
  quality?: string;
  updatedAt: string;
}

interface InstanceRecord {
  _id: Types.ObjectId;
  name: string;
  url: string;
  secret: string;
  activeStreams?: number;
  maxStreams?: number;
}

interface CookieAccountRecord {
  _id: Types.ObjectId;
  cookiesEncrypted: string;
  userAgent?: string;
}

export interface YtDlpCredentials {
  /** Mongo `_id` of the GoogleAccount we picked, or null if no record matched. */
  accountId: string | null;
  /** Short human label of the picked record. */
  label?: string;
  cookies?: InstanceCookie[];
  userAgent?: string;
}

/**
 * Default cap on cookie-rotation retries per master call. Picked high enough
 * to walk a small pool when several entries are stale, but low enough that an
 * outage with broken cookies fails fast (rather than hammering the instance).
 */
export const MAX_COOKIE_ROTATIONS = 3;

interface RoomStateRecord {
  currentTime?: number;
  isPlaying?: boolean;
  playbackRate?: number;
  lastSyncAt?: Date;
  selectedFormatId?: string | null;
  quality?: string | null;
}

export class WatchPartyError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "WatchPartyError";
  }
}

/**
 * When false (the default and the only sensible production setting), URLs
 * that resolve to a literal loopback / RFC1918 / link-local IP are rejected
 * by [normalizeVideoUrl]. Tests flip this to `true` to keep using
 * `http://127.0.0.1:1234/...` fixtures without poking at process.env.
 *
 * The Go instance enforces the same check at the network edge — this guard
 * is a faster, friendlier error for the master to surface so the user does
 * not have to wait for yt-dlp to give up.
 */
let allowPrivateVideoTargets =
  process.env.WAVE_ALLOW_PRIVATE_VIDEO_TARGETS === "1" ||
  process.env.NODE_ENV === "test";

/** Test-only escape hatch — mirrors WAVE_ALLOW_PRIVATE_VIDEO_TARGETS. */
export function __setAllowPrivateVideoTargetsForTests(allow: boolean): void {
  allowPrivateVideoTargets = allow;
}

export function normalizeVideoUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WatchPartyError("Enter a valid http(s) video URL.", 400);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WatchPartyError("Only http(s) video URLs are supported.", 400);
  }
  if (!parsed.hostname) {
    throw new WatchPartyError("Enter a valid http(s) video URL.", 400);
  }
  // Userinfo (user:pass@host) is a classic SSRF / phishing payload vector and
  // yt-dlp itself ignores it. Refuse it outright to keep our logs clean.
  if (parsed.username || parsed.password) {
    throw new WatchPartyError("Video URLs must not embed credentials.", 400);
  }
  if (!allowPrivateVideoTargets && isPrivateHostname(parsed.hostname)) {
    throw new WatchPartyError(
      "Video URLs must point at a public host (no localhost / private IPs).",
      400,
    );
  }
  return parsed.toString();
}

function isPrivateHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "ip6-localhost" || lower === "ip6-loopback") {
    return true;
  }
  // [::1] etc. come in with surrounding brackets stripped by URL; isIP wants
  // the bare literal.
  const stripped = lower.replace(/^\[|\]$/g, "");
  const version = isIP(stripped);
  if (version === 0) return false;
  if (version === 4) return isPrivateIPv4(stripped);
  return isPrivateIPv6(stripped);
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // Unique local addresses (fc00::/7) and link-local (fe80::/10).
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return true;
  }
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — peek at the embedded IPv4 portion.
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped && isPrivateIPv4(mapped[1]!)) return true;
  return false;
}

export async function selectStreamingInstance(): Promise<InstanceRecord> {
  const candidates = await Instance.find({ enabled: true, isHealthy: true })
    .sort({ activeStreams: 1, lastHealthAt: -1, updatedAt: -1 })
    .lean<InstanceRecord[]>();
  const selected = candidates.find((candidate) => {
    const max = candidate.maxStreams ?? 0;
    return max === 0 || (candidate.activeStreams ?? 0) < max;
  });
  if (!selected) {
    throw new WatchPartyError(
      "No healthy streaming instance is available. Start the local instance or add one in INSTANCES_JSON.",
      503,
    );
  }
  return selected;
}

/**
 * Pick the least-recently-used enabled cookie record and return its plaintext
 * cookies + user-agent override, plus the account id so the caller can mark
 * it auto-disabled on a rotatable upstream error.
 *
 * Pass `excludeIds` to skip records that have already failed during this call
 * (the master rotation loop populates this with the previous attempt's id).
 */
export async function loadYtDlpCredentials(
  options: { excludeIds?: ReadonlyArray<string | Types.ObjectId> } = {},
): Promise<YtDlpCredentials> {
  const excluded = (options.excludeIds ?? []).map((id) =>
    id instanceof Types.ObjectId ? id : new Types.ObjectId(id),
  );
  const filter: Record<string, unknown> = { disabled: false };
  if (excluded.length > 0) filter._id = { $nin: excluded };

  const account = await GoogleAccount.findOneAndUpdate(
    filter,
    { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } },
    { sort: { lastUsedAt: 1, usageCount: 1, createdAt: 1 }, new: true },
  ).lean<(CookieAccountRecord & { label?: string }) | null>();
  if (!account) return { accountId: null };

  let cookies: InstanceCookie[];
  try {
    cookies = parseCookiePayload(decrypt(account.cookiesEncrypted));
  } catch (err) {
    throw new WatchPartyError(
      `Configured YouTube cookies cannot be used: ${(err as Error).message}`,
      500,
    );
  }
  return {
    accountId: String(account._id),
    label: account.label,
    cookies,
    userAgent: account.userAgent,
  };
}

/**
 * Run an instance call (e.g. `/info`) under the cookie pool rotation policy.
 *
 * Behaviour:
 *  - The first attempt uses whatever credentials `loadYtDlpCredentials()`
 *    returns (may be empty if no records exist).
 *  - On a rotatable `InstanceError`, the picked record is auto-disabled and
 *    the call is retried with the next record, up to `MAX_COOKIE_ROTATIONS`
 *    times. Records seen so far are excluded from the next pick.
 *  - Non-rotatable errors are rethrown unchanged.
 *  - Returns both the operation result and the credentials used on the
 *    successful attempt so the caller can log which record served the call.
 */
export async function withCookieRotation<T>(
  run: (credentials: YtDlpCredentials) => Promise<T>,
  options: {
    maxAttempts?: number;
    /** Override the credential loader — used by tests. */
    loader?: typeof loadYtDlpCredentials;
    /** Override the auto-disable callback — used by tests. */
    autoDisable?: (id: string, reason: string) => Promise<void>;
    log?: Pick<Console, "warn" | "info">;
  } = {},
): Promise<{ value: T; credentials: YtDlpCredentials; attempts: number }> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_COOKIE_ROTATIONS);
  const loader = options.loader ?? loadYtDlpCredentials;
  const autoDisable = options.autoDisable ?? markCookieAccountAutoDisabled;
  const log = options.log ?? console;

  const excludeIds: string[] = [];
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const credentials = await loader({ excludeIds });
    try {
      const value = await run(credentials);
      return { value, credentials, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (
        err instanceof InstanceError &&
        isRotatableInstanceErrorCode(err.errorCode) &&
        credentials.accountId
      ) {
        log.warn(
          `[wave] cookie pool: auto-disabling "${credentials.label ?? credentials.accountId}" after ${err.errorCode} (attempt ${attempt}/${maxAttempts})`,
        );
        await autoDisable(credentials.accountId, err.errorCode).catch((disableErr: unknown) => {
          log.warn(`[wave] cookie pool: auto-disable bookkeeping failed:`, disableErr);
        });
        excludeIds.push(credentials.accountId);
        continue;
      }
      throw err;
    }
  }
  if (lastErr) throw lastErr;
  // Shouldn't happen — the loop always either returns or throws.
  throw new WatchPartyError("Cookie rotation exhausted unexpectedly.", 500);
}

export interface PreviewResult {
  url: string;
  instance: InstanceRecord;
  info: InstanceInfo;
  formats: RoomVideoFormat[];
  selectedFormatId: string;
  quality: string;
  cookieAccountId: string | null;
  cookieRotations: number;
}

/**
 * TTL for the in-memory `/info` cache (milliseconds). yt-dlp metadata is
 * effectively static for a given URL over a short horizon, so coalescing
 * repeat lookups (e.g. a user clicking "Create" twice, or the web preview
 * preflight followed immediately by an actual room create) avoids paying for
 * a second yt-dlp invocation that would also burn a cookie rotation slot.
 */
export const PREVIEW_CACHE_TTL_MS = 90_000;
const PREVIEW_CACHE_MAX_ENTRIES = 128;

interface PreviewCacheEntry {
  expiresAt: number;
  result: Omit<PreviewResult, "instance"> & { instanceId: string };
}

const previewCache = new Map<string, PreviewCacheEntry>();

function previewCacheGet(key: string): PreviewCacheEntry | null {
  const entry = previewCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    previewCache.delete(key);
    return null;
  }
  // Refresh LRU position so heavy hitters survive eviction.
  previewCache.delete(key);
  previewCache.set(key, entry);
  return entry;
}

function previewCachePut(key: string, entry: PreviewCacheEntry): void {
  if (previewCache.size >= PREVIEW_CACHE_MAX_ENTRIES) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.set(key, entry);
}

/** Test-only — clears the in-memory preview cache between tests. */
export function __resetPreviewCacheForTests(): void {
  previewCache.clear();
}

export async function previewVideo(urlInput: string): Promise<PreviewResult> {
  const url = normalizeVideoUrl(urlInput);
  const cached = previewCacheGet(url);
  if (cached) {
    const instance = await loadInstanceById(cached.result.instanceId);
    if (instance) {
      const { instanceId: _ignored, ...rest } = cached.result;
      return { ...rest, instance };
    }
    // Instance went away — fall through to a fresh lookup.
  }

  const instance = await selectStreamingInstance();
  const client = new InstanceClient({ url: instance.url, secret: instance.secret });

  const { value: info, credentials, attempts } = await withCookieRotation((creds) =>
    client.info({
      url,
      cookies: creds.cookies,
      userAgent: creds.userAgent,
    }),
  );

  const formats = buildRoomFormats(info);
  const first = formats[0];
  if (!first) {
    throw new WatchPartyError("The instance returned no streamable formats for this video.", 502);
  }
  const result: PreviewResult = {
    url,
    instance,
    info,
    formats,
    selectedFormatId: first.formatId,
    quality: first.label,
    cookieAccountId: credentials.accountId,
    cookieRotations: attempts - 1,
  };
  previewCachePut(url, {
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
    result: {
      url,
      info,
      formats,
      selectedFormatId: first.formatId,
      quality: first.label,
      cookieAccountId: credentials.accountId,
      cookieRotations: attempts - 1,
      instanceId: String(instance._id),
    },
  });
  return result;
}

async function loadInstanceById(id: string): Promise<InstanceRecord | null> {
  try {
    const doc = await Instance.findOne({
      _id: new Types.ObjectId(id),
      enabled: true,
      isHealthy: true,
    }).lean<InstanceRecord | null>();
    return doc;
  } catch {
    return null;
  }
}

export async function createWatchRoom(input: {
  ownerId: string | Types.ObjectId;
  url: string;
  source?: "web" | "bot";
  botPayload?: string;
}): Promise<{ code: string; botPayload?: string }> {
  const ownerId =
    input.ownerId instanceof Types.ObjectId ? input.ownerId : new Types.ObjectId(input.ownerId);
  const preview = await previewVideo(input.url);
  const payload = input.botPayload ?? (input.source === "bot" ? randomCode(24).toLowerCase() : undefined);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomCode(8);
    try {
      await Room.create({
        code,
        ownerId,
        instanceId: preview.instance._id,
        videoUrl: preview.url,
        videoTitle: preview.info.title,
        videoDuration: preview.info.duration,
        videoThumbnail: preview.info.thumbnail,
        videoUploader: preview.info.uploader ?? preview.info.channel,
        availableFormats: preview.formats,
        selectedFormatId: preview.selectedFormatId,
        quality: preview.quality,
        participants: [{ userId: ownerId }],
        source: input.source ?? "web",
        botPayload: payload,
      });
      return { code, botPayload: payload };
    } catch (err) {
      if (isDuplicateKeyError(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new WatchPartyError("Could not allocate a unique room code.", 500);
}

export function buildRoomFormats(info: InstanceInfo): RoomVideoFormat[] {
  const heights = Array.from(
    new Set(
      info.formats
        .filter((format) => format.hasVideo && Number.isFinite(format.height) && (format.height ?? 0) > 0)
        .map((format) => format.height as number),
    ),
  ).sort((a, b) => b - a);

  const formats: RoomVideoFormat[] = [
    {
      formatId: "bv*+ba/b",
      label: "Best available",
    },
  ];
  for (const height of heights) {
    const sample = info.formats.find((format) => format.hasVideo && format.height === height);
    formats.push({
      formatId: `bv*[height<=${height}]+ba/b[height<=${height}]/best[height<=${height}]`,
      label: `${height}p`,
      width: sample?.width,
      height,
      fps: sample?.fps,
      ext: sample?.ext,
      vcodec: sample?.vcodec,
      acodec: sample?.acodec,
      filesize: sample?.filesize,
    });
  }
  return formats;
}

export function makeRoomState(room: RoomStateRecord): RoomSyncState {
  const syncedAt = room.lastSyncAt ?? new Date();
  const base = Math.max(0, room.currentTime ?? 0);
  const currentTime = room.isPlaying
    ? base + Math.max(0, Date.now() - syncedAt.getTime()) / 1000
    : base;
  return {
    currentTime,
    isPlaying: Boolean(room.isPlaying),
    playbackRate: room.playbackRate ?? 1,
    selectedFormatId: room.selectedFormatId ?? undefined,
    quality: room.quality ?? undefined,
    updatedAt: syncedAt.toISOString(),
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === 11000;
}

export const __watchPartyTest__ = {
  buildRoomFormats,
  parseCookiePayload,
};
