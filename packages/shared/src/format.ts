/**
 * Human-readable rendering for the friends-list payload.
 *
 * `presence.ts` produces a structured `PresenceSummary` and `friends.ts`
 * surfaces a `FriendView` — but UI surfaces (web cards, Telegram bot
 * messages, push notifications) all need a string like "Watching
 * “Stranger Things S01E01” on Netflix" or "Sleeping — last seen 12 min
 * ago". The helpers in this file keep that rendering consistent and i18n
 * aware so each consumer doesn't reinvent the wheel.
 *
 * Everything is pure — no Mongo, no Date.now() unless `now` is passed
 * explicitly — so the bot, the web SSR layer, and tests can share the
 * code without surprises.
 */

import { type Lang, t } from "./i18n";
import type { PresenceStatus, PresenceSummary, PresenceWatching } from "./presence";

/** Order the friends list uses by default: most "active" friends first. */
export const PRESENCE_STATUS_ORDER: readonly PresenceStatus[] = [
  "watching",
  "online",
  "idle",
  "sleeping",
  "offline",
];

const STATUS_LABEL_KEYS: Record<PresenceStatus, Parameters<typeof t>[1]> = {
  online: "web.friends.status_online",
  idle: "web.friends.status_idle",
  sleeping: "web.friends.status_sleeping",
  offline: "web.friends.status_offline",
  watching: "web.friends.status_watching",
};

/**
 * Translate a derived presence status into a one-word label.
 */
export function formatPresenceLabel(lang: Lang, status: PresenceStatus): string {
  return t(lang, STATUS_LABEL_KEYS[status]);
}

/**
 * Render the "watching XYZ on YouTube" line for a friend.
 *
 *  - If `videoTitle` is present, returns the localised "«title» — Service".
 *  - Otherwise returns the "Watching on Service" form.
 *  - When `watching` is `null` returns `null` — callers decide whether to
 *    hide the line or fall back to the status label.
 */
export function formatWatching(
  lang: Lang,
  watching: PresenceWatching | null | undefined,
): string | null {
  if (!watching) return null;
  const service = watching.serviceLabel || watching.serviceHost || "Unknown";
  if (watching.videoTitle) {
    return t(lang, "web.friends.watching_title_on", {
      title: watching.videoTitle,
      service,
    });
  }
  return t(lang, "web.friends.watching_on", { service });
}

/** Maximum age we attempt to render in words; older just says "offline for a while". */
const LAST_SEEN_GIVE_UP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Render "last seen 3 min ago" / "12h ago" / "2d ago".
 *
 *  - `null` / future timestamps → `null` so callers can fall back to a
 *    static label like "Offline".
 *  - Within the last 60 seconds → "just now" (no exact second count —
 *    avoids constant re-renders).
 *  - 1–59 min → minutes.
 *  - 1–23 h → hours.
 *  - 1–29 d → days.
 *  - older than 30 d → static "offline for a while".
 */
export function formatLastSeen(
  lang: Lang,
  lastActiveAt: string | Date | null | undefined,
  options: { now?: Date } = {},
): string | null {
  if (!lastActiveAt) return null;
  const at = lastActiveAt instanceof Date ? lastActiveAt : new Date(lastActiveAt);
  if (Number.isNaN(at.getTime())) return null;
  const now = options.now ?? new Date();
  const diff = now.getTime() - at.getTime();
  if (diff < 0) return null;
  if (diff < 60_000) return t(lang, "web.friends.last_seen_just_now");
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return t(lang, "web.friends.last_seen_minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t(lang, "web.friends.last_seen_hours", { hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t(lang, "web.friends.last_seen_days", { days });
  if (diff > LAST_SEEN_GIVE_UP_MS) return t(lang, "web.friends.last_seen_long_ago");
  return t(lang, "web.friends.last_seen_long_ago");
}

export interface FormattedPresence {
  /** Single-word state badge (e.g. "Online", "Sleeping"). */
  statusLabel: string;
  /** "Watching «X» on YouTube" when applicable; otherwise null. */
  watchingLine: string | null;
  /**
   * Caption shown under the name. Prefers the watching line if any,
   * otherwise the "last seen 3 min ago" / static "Offline" combination.
   */
  caption: string;
}

/**
 * Render the full friends-list line for a single user.
 *
 * The returned `caption` collapses the status + last-seen into one
 * line suitable for a friends-list row. Callers that need more
 * control can use the individual fields.
 */
export function formatPresence(
  lang: Lang,
  presence: PresenceSummary,
  options: { now?: Date } = {},
): FormattedPresence {
  const statusLabel = formatPresenceLabel(lang, presence.status);
  const watchingLine = formatWatching(lang, presence.watching);
  if (presence.status === "watching" && watchingLine) {
    return { statusLabel, watchingLine, caption: watchingLine };
  }
  const lastSeen = formatLastSeen(lang, presence.lastActiveAt, options);
  if (presence.status === "online" || presence.status === "idle") {
    if (lastSeen) {
      return { statusLabel, watchingLine, caption: `${statusLabel} · ${lastSeen}` };
    }
    return { statusLabel, watchingLine, caption: statusLabel };
  }
  // sleeping / offline: prefer last-seen detail when we have it.
  if (lastSeen) {
    return { statusLabel, watchingLine, caption: `${statusLabel} · ${lastSeen}` };
  }
  return { statusLabel, watchingLine, caption: statusLabel };
}

/**
 * Sort friends by presence: watching > online > idle > sleeping > offline.
 * Within a bucket, ordering is left to the caller (typically by name).
 */
export function comparePresenceStatus(a: PresenceStatus, b: PresenceStatus): number {
  return PRESENCE_STATUS_ORDER.indexOf(a) - PRESENCE_STATUS_ORDER.indexOf(b);
}
