/**
 * Resolve a streamable URL to a canonical service id + human label.
 *
 * The friends list shows a small badge next to each user — "watching on
 * YouTube" / "watching on Twitch" — and the bot needs the same mapping
 * when it announces what a friend is up to. We keep the table here so
 * every consumer agrees on the canonical service id, and so adding a
 * new platform is a one-line change.
 *
 * The mapping is purely host-based: yt-dlp already accepts the URL, so
 * we only need to recognise the host. Unknown hosts get a generic
 * `"unknown"` id plus the raw host as `label` so the UI can still say
 * "watching on example.com".
 */

export interface VideoServiceInfo {
  /** Canonical short id stored on `User.watching.service`. */
  service: string;
  /** Human-readable label rendered in the friends list. */
  label: string;
  /** Raw host (lowercased, no `www.`) for fallback rendering. */
  host: string | null;
}

interface ServiceRule {
  service: string;
  label: string;
  /**
   * One or more host suffixes — `youtube.com` matches both
   * `youtube.com` and `m.youtube.com`. Match is case-insensitive.
   */
  hosts: readonly string[];
}

/**
 * Ordered list of services we recognise. Order matters for hosts that
 * share a suffix (none currently do, but keep the array stable).
 */
const SERVICE_RULES: readonly ServiceRule[] = [
  {
    service: "youtube",
    label: "YouTube",
    hosts: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
  },
  { service: "twitch", label: "Twitch", hosts: ["twitch.tv"] },
  { service: "vimeo", label: "Vimeo", hosts: ["vimeo.com"] },
  { service: "dailymotion", label: "Dailymotion", hosts: ["dailymotion.com", "dai.ly"] },
  { service: "tiktok", label: "TikTok", hosts: ["tiktok.com", "vm.tiktok.com"] },
  { service: "kick", label: "Kick", hosts: ["kick.com"] },
  { service: "rutube", label: "RuTube", hosts: ["rutube.ru"] },
  { service: "vk", label: "VK Video", hosts: ["vk.com", "vk.ru", "vkvideo.ru"] },
  { service: "ok", label: "OK Video", hosts: ["ok.ru", "odnoklassniki.ru"] },
  { service: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.watch"] },
  { service: "instagram", label: "Instagram", hosts: ["instagram.com"] },
  { service: "twitter", label: "Twitter / X", hosts: ["twitter.com", "x.com"] },
  { service: "reddit", label: "Reddit", hosts: ["reddit.com", "v.redd.it"] },
  { service: "soundcloud", label: "SoundCloud", hosts: ["soundcloud.com"] },
  { service: "bilibili", label: "Bilibili", hosts: ["bilibili.com"] },
  { service: "nicovideo", label: "Niconico", hosts: ["nicovideo.jp", "nico.ms"] },
  { service: "streamable", label: "Streamable", hosts: ["streamable.com"] },
  { service: "spotify", label: "Spotify", hosts: ["spotify.com", "open.spotify.com"] },
];

/**
 * Look up a known service by id. Returns the matching label or null.
 * Useful for hydrating cached `User.watching.service` strings.
 */
export function getServiceLabel(serviceId: string | null | undefined): string | null {
  if (!serviceId) return null;
  const rule = SERVICE_RULES.find((entry) => entry.service === serviceId);
  return rule?.label ?? null;
}

/**
 * The fallback descriptor returned when the URL is unparseable or its
 * host is empty. Exported for tests; production code should call
 * `detectVideoService()` and rely on the structured result.
 */
export const UNKNOWN_VIDEO_SERVICE: VideoServiceInfo = {
  service: "unknown",
  label: "Unknown",
  host: null,
};

/**
 * Resolve a URL string to its canonical service info.
 *
 * The result is always populated — unknown URLs come back as
 * `{ service: "unknown", label: "<host>" | "Unknown", host }` so the UI
 * never has to special-case `null`.
 */
export function detectVideoService(rawUrl: string | null | undefined): VideoServiceInfo {
  if (!rawUrl) return UNKNOWN_VIDEO_SERVICE;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return UNKNOWN_VIDEO_SERVICE;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host) return UNKNOWN_VIDEO_SERVICE;

  for (const rule of SERVICE_RULES) {
    for (const suffix of rule.hosts) {
      if (host === suffix || host.endsWith(`.${suffix}`)) {
        return { service: rule.service, label: rule.label, host };
      }
    }
  }
  return { service: "unknown", label: host, host };
}

/** Read-only view of the known services — handy for admin UIs. */
export function listKnownVideoServices(): ReadonlyArray<{ service: string; label: string }> {
  return SERVICE_RULES.map((rule) => ({ service: rule.service, label: rule.label }));
}
