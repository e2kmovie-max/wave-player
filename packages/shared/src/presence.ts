/**
 * Friends-list presence model.
 *
 * Each user has three persisted columns we read from here:
 *  - `lastActiveAt`  — bumped on every authenticated heartbeat.
 *  - `manualStatus`  — explicit override (`online | sleeping | offline`).
 *  - `watching`      — sub-doc set while the user is inside a watch room.
 *
 * `computePresence()` collapses those into one of five derived states:
 *  - `online`   — active heartbeat, no override.
 *  - `idle`     — heartbeat seen recently but not in the active window.
 *  - `sleeping` — explicit manual status OR auto-derived from a long
 *                 stretch of inactivity (configurable).
 *  - `offline`  — explicit offline override OR stale heartbeat.
 *  - `watching` — currently inside a room with a fresh heartbeat. Wins
 *                 over `online` so the friends list can render the
 *                 video instead of a plain dot.
 *
 * UI consumers should call `summarizePresence()` instead of inspecting
 * fields directly so the heuristics stay in lockstep across surfaces.
 */

import { Types } from "mongoose";
import { User, type UserDoc } from "./models/User";
import { detectVideoService } from "./video-service";

/** Derived friend-list status. Strings are stable for API responses. */
export type PresenceStatus = "online" | "idle" | "sleeping" | "offline" | "watching";

/** Manual override the user picked themselves. `null` means automatic. */
export type ManualPresence = "online" | "sleeping" | "offline" | null;

export interface PresenceWatching {
  /** Room short code (uppercase). */
  roomCode: string;
  videoUrl?: string;
  videoTitle?: string;
  videoThumbnail?: string;
  /** Canonical service id (see `detectVideoService`). */
  service: string;
  /** Human label, e.g. "YouTube". */
  serviceLabel: string;
  /** Raw host for unknown services. */
  serviceHost?: string;
  /** ISO timestamp the heartbeat was last refreshed. */
  startedAt: string;
}

export interface PresenceSummary {
  status: PresenceStatus;
  manual: ManualPresence;
  /** ISO timestamp of the last activity heartbeat, or null. */
  lastActiveAt: string | null;
  /** Set when status === "watching"; null otherwise. */
  watching: PresenceWatching | null;
}

/** Knobs that govern when a user transitions between derived states. */
export interface PresenceThresholds {
  /** Heartbeats newer than this count as "online" / "watching". */
  onlineWithinMs: number;
  /** Heartbeats older than `onlineWithinMs` but newer than this become "idle". */
  idleWithinMs: number;
  /** No heartbeat for this long → auto-`sleeping`. After that → `offline`. */
  autoSleepAfterMs: number;
  /** Watching is only "live" if the watch sub-doc heartbeat is this fresh. */
  watchingFreshMs: number;
}

export const DEFAULT_PRESENCE_THRESHOLDS: PresenceThresholds = {
  onlineWithinMs: 2 * 60 * 1000, // 2 min
  idleWithinMs: 10 * 60 * 1000, // 10 min
  autoSleepAfterMs: 8 * 60 * 60 * 1000, // 8 hours
  watchingFreshMs: 5 * 60 * 1000, // 5 min
};

/** Inputs `computePresence()` needs. Shaped so tests can call it without Mongoose. */
export interface PresenceInputs {
  lastActiveAt: Date | string | null | undefined;
  manualStatus: ManualPresence | undefined;
  watching: PresenceWatching | null | undefined;
}

interface RawWatchingDoc {
  roomCode: string;
  videoUrl?: string | null;
  videoTitle?: string | null;
  videoThumbnail?: string | null;
  service?: string | null;
  serviceLabel?: string | null;
  serviceHost?: string | null;
  startedAt?: Date | string | null;
}

/**
 * Normalize a Mongoose `User.watching` sub-doc (or `null`) into the
 * public `PresenceWatching` shape used by the friends-list payload.
 */
export function normalizeWatching(
  raw: RawWatchingDoc | null | undefined,
): PresenceWatching | null {
  if (!raw || !raw.roomCode) return null;
  const startedAt =
    raw.startedAt instanceof Date
      ? raw.startedAt.toISOString()
      : raw.startedAt
        ? new Date(raw.startedAt).toISOString()
        : new Date().toISOString();
  const result: PresenceWatching = {
    roomCode: raw.roomCode,
    service: raw.service ?? "unknown",
    serviceLabel: raw.serviceLabel ?? "Unknown",
    startedAt,
  };
  if (raw.videoUrl) result.videoUrl = raw.videoUrl;
  if (raw.videoTitle) result.videoTitle = raw.videoTitle;
  if (raw.videoThumbnail) result.videoThumbnail = raw.videoThumbnail;
  if (raw.serviceHost) result.serviceHost = raw.serviceHost;
  return result;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Reduce a user's persisted presence fields into a single derived
 * status. Pure function — same inputs always yield the same status.
 *
 * `now` and `thresholds` are injectable for testing and for sites that
 * want a stricter "online" window (e.g. mobile clients).
 */
export function computePresence(
  inputs: PresenceInputs,
  options: { now?: Date; thresholds?: Partial<PresenceThresholds> } = {},
): PresenceStatus {
  const thresholds: PresenceThresholds = { ...DEFAULT_PRESENCE_THRESHOLDS, ...options.thresholds };
  const now = options.now ?? new Date();
  const manual = inputs.manualStatus ?? null;

  // Explicit offline always wins so users can hide cleanly.
  if (manual === "offline") return "offline";
  // Explicit sleeping always wins over auto-online. We still let
  // "watching" override sleeping below because a user clearly is awake
  // if they're actively in a room.
  const lastActive = toDate(inputs.lastActiveAt);
  const lastActiveMs = lastActive ? now.getTime() - lastActive.getTime() : Infinity;

  const watching = inputs.watching ?? null;
  const watchingStartedAt = watching ? toDate(watching.startedAt) : null;
  const watchingFresh =
    watching !== null &&
    watchingStartedAt !== null &&
    now.getTime() - watchingStartedAt.getTime() <= thresholds.watchingFreshMs;

  if (watchingFresh && manual !== "sleeping") return "watching";
  if (manual === "sleeping") return "sleeping";
  if (manual === "online") return "online";

  if (lastActiveMs <= thresholds.onlineWithinMs) return "online";
  if (lastActiveMs <= thresholds.idleWithinMs) return "idle";
  if (lastActiveMs <= thresholds.autoSleepAfterMs) return "sleeping";
  return "offline";
}

/**
 * Build the full presence payload for a single user. Accepts either a
 * hydrated Mongoose doc or any plain object shaped like one (e.g. a
 * `.lean()` result), so route handlers and the bot can share the call.
 */
export function summarizePresence(
  user: {
    lastActiveAt?: Date | string | null;
    manualStatus?: ManualPresence | string | null;
    watching?: RawWatchingDoc | null;
  },
  options: { now?: Date; thresholds?: Partial<PresenceThresholds> } = {},
): PresenceSummary {
  const manual = normalizeManual(user.manualStatus ?? null);
  const watching = normalizeWatching(user.watching ?? null);
  const status = computePresence(
    {
      lastActiveAt: user.lastActiveAt ?? null,
      manualStatus: manual,
      watching,
    },
    options,
  );
  const lastActive = toDate(user.lastActiveAt ?? null);
  return {
    status,
    manual,
    lastActiveAt: lastActive ? lastActive.toISOString() : null,
    // `watching` should mirror the derived status so consumers don't
    // accidentally render a stale "watching" payload while the badge
    // says "sleeping".
    watching: status === "watching" ? watching : null,
  };
}

function normalizeManual(value: string | null | undefined): ManualPresence {
  if (value === "online" || value === "sleeping" || value === "offline") return value;
  return null;
}

// ---------------------------------------------------------------------
// Mongoose helpers. These are the bits the route handlers actually call
// from API endpoints / WebSocket lifecycle hooks.
// ---------------------------------------------------------------------

interface UserIdLike {
  toString(): string;
}

function asObjectId(id: string | Types.ObjectId | UserIdLike): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  return new Types.ObjectId(typeof id === "string" ? id : id.toString());
}

/**
 * Bump a user's `lastActiveAt` to now. Safe to call on every request —
 * the underlying `updateOne` is cheap and idempotent.
 */
export async function recordActivityHeartbeat(
  userId: string | Types.ObjectId,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  await User.updateOne({ _id: asObjectId(userId) }, { $set: { lastActiveAt: now } });
}

/**
 * Update the user's "currently watching" sub-document.
 *
 * Pass `null` (or call `clearWatchingStatus()`) when the user leaves a
 * room. The service id is resolved from `videoUrl` and persisted with
 * the record so the friends list does not have to re-detect on read.
 *
 * `lastActiveAt` is bumped alongside the watch record because a user
 * with a fresh "watching" payload is, by definition, active.
 */
export async function recordWatchingHeartbeat(
  userId: string | Types.ObjectId,
  input: {
    roomCode: string;
    videoUrl?: string | null;
    videoTitle?: string | null;
    videoThumbnail?: string | null;
  },
  options: { now?: Date } = {},
): Promise<PresenceWatching> {
  if (!input.roomCode) {
    throw new Error("recordWatchingHeartbeat: roomCode is required.");
  }
  const now = options.now ?? new Date();
  const detected = detectVideoService(input.videoUrl ?? undefined);
  const watching: PresenceWatching = {
    roomCode: input.roomCode,
    service: detected.service,
    serviceLabel: detected.label,
    startedAt: now.toISOString(),
  };
  if (input.videoUrl) watching.videoUrl = input.videoUrl;
  if (input.videoTitle) watching.videoTitle = input.videoTitle;
  if (input.videoThumbnail) watching.videoThumbnail = input.videoThumbnail;
  if (detected.host) watching.serviceHost = detected.host;
  await User.updateOne(
    { _id: asObjectId(userId) },
    {
      $set: {
        lastActiveAt: now,
        watching: {
          roomCode: watching.roomCode,
          videoUrl: watching.videoUrl ?? null,
          videoTitle: watching.videoTitle ?? null,
          videoThumbnail: watching.videoThumbnail ?? null,
          service: watching.service,
          serviceLabel: watching.serviceLabel,
          serviceHost: watching.serviceHost ?? null,
          startedAt: now,
        },
      },
    },
  );
  return watching;
}

/**
 * Clear the `watching` sub-document. Called when the user leaves a room
 * or the WebSocket disconnects with `wasActiveInRoom=true`.
 */
export async function clearWatchingStatus(
  userId: string | Types.ObjectId,
): Promise<void> {
  await User.updateOne(
    { _id: asObjectId(userId) },
    { $set: { watching: null } },
  );
}

/**
 * Set the user's manual presence override. Pass `null` to remove the
 * override and revert to the automatic heuristic.
 */
export async function setManualPresence(
  userId: string | Types.ObjectId,
  manual: ManualPresence,
): Promise<void> {
  await User.updateOne(
    { _id: asObjectId(userId) },
    { $set: { manualStatus: manual } },
  );
}

/** Convenience wrapper for `summarizePresence()` that pulls from Mongo. */
export async function getPresenceForUser(
  userId: string | Types.ObjectId,
  options: { now?: Date; thresholds?: Partial<PresenceThresholds> } = {},
): Promise<PresenceSummary | null> {
  const doc = await User.findById(asObjectId(userId))
    .select({ lastActiveAt: 1, manualStatus: 1, watching: 1 })
    .lean<Pick<UserDoc, "lastActiveAt" | "manualStatus" | "watching">>();
  if (!doc) return null;
  return summarizePresence(doc, options);
}

export const __presenceTest__ = {
  normalizeManual,
  normalizeWatching,
};
