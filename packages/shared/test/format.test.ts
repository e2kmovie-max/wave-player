import { describe, expect, it } from "bun:test";
import {
  comparePresenceStatus,
  formatLastSeen,
  formatPresence,
  formatPresenceLabel,
  formatWatching,
  PRESENCE_STATUS_ORDER,
} from "../src/format";
import type { PresenceSummary } from "../src/presence";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const MIN = 60 * 1000;

describe("formatPresenceLabel", () => {
  it("translates each derived status into a one-word label in en + ru", () => {
    expect(formatPresenceLabel("en", "online")).toBe("Online");
    expect(formatPresenceLabel("ru", "online")).toBe("Онлайн");
    expect(formatPresenceLabel("en", "watching")).toBe("Watching");
    expect(formatPresenceLabel("ru", "watching")).toBe("Смотрит");
    expect(formatPresenceLabel("en", "sleeping")).toBe("Sleeping");
    expect(formatPresenceLabel("ru", "sleeping")).toBe("Спит");
    expect(formatPresenceLabel("en", "idle")).toBe("Idle");
    expect(formatPresenceLabel("ru", "idle")).toBe("Неактивен");
    expect(formatPresenceLabel("en", "offline")).toBe("Offline");
    expect(formatPresenceLabel("ru", "offline")).toBe("Не в сети");
  });
});

describe("formatWatching", () => {
  it("returns null for empty / undefined input", () => {
    expect(formatWatching("en", null)).toBeNull();
    expect(formatWatching("en", undefined)).toBeNull();
  });

  it("returns 'watching on Service' when there's no title", () => {
    expect(
      formatWatching("en", {
        roomCode: "ABC",
        service: "youtube",
        serviceLabel: "YouTube",
        startedAt: NOW.toISOString(),
      }),
    ).toBe("Watching on YouTube");
    expect(
      formatWatching("ru", {
        roomCode: "ABC",
        service: "youtube",
        serviceLabel: "YouTube",
        startedAt: NOW.toISOString(),
      }),
    ).toBe("Смотрит на YouTube");
  });

  it("renders the title alongside the service when available", () => {
    expect(
      formatWatching("en", {
        roomCode: "ABC",
        videoTitle: "Cosmos S01E01",
        service: "youtube",
        serviceLabel: "YouTube",
        startedAt: NOW.toISOString(),
      }),
    ).toBe("“Cosmos S01E01” — YouTube");
  });

  it("falls back to serviceHost when no label, then 'Unknown'", () => {
    expect(
      formatWatching("en", {
        roomCode: "ABC",
        service: "unknown",
        serviceLabel: "",
        serviceHost: "example.com",
        startedAt: NOW.toISOString(),
      }),
    ).toBe("Watching on example.com");
    expect(
      formatWatching("en", {
        roomCode: "ABC",
        service: "unknown",
        serviceLabel: "",
        startedAt: NOW.toISOString(),
      }),
    ).toBe("Watching on Unknown");
  });
});

describe("formatLastSeen", () => {
  it("returns null for missing or invalid values", () => {
    expect(formatLastSeen("en", null, { now: NOW })).toBeNull();
    expect(formatLastSeen("en", undefined, { now: NOW })).toBeNull();
    expect(formatLastSeen("en", "not a date", { now: NOW })).toBeNull();
  });

  it("returns null for future timestamps", () => {
    expect(
      formatLastSeen("en", new Date(NOW.getTime() + 10 * MIN), { now: NOW }),
    ).toBeNull();
  });

  it("returns 'just now' inside the first minute", () => {
    expect(
      formatLastSeen("en", new Date(NOW.getTime() - 30 * 1000), { now: NOW }),
    ).toBe("just now");
    expect(
      formatLastSeen("ru", new Date(NOW.getTime() - 30 * 1000), { now: NOW }),
    ).toBe("только что");
  });

  it("renders minutes / hours / days inside the 30-day window", () => {
    expect(
      formatLastSeen("en", new Date(NOW.getTime() - 5 * MIN), { now: NOW }),
    ).toBe("5 min ago");
    expect(
      formatLastSeen("en", new Date(NOW.getTime() - 90 * MIN), { now: NOW }),
    ).toBe("1h ago");
    expect(
      formatLastSeen("en", new Date(NOW.getTime() - 3 * 24 * 60 * MIN), { now: NOW }),
    ).toBe("3d ago");
  });

  it("falls back to 'offline for a while' past 30 days", () => {
    expect(
      formatLastSeen("en", new Date(NOW.getTime() - 60 * 24 * 60 * MIN), { now: NOW }),
    ).toBe("offline for a while");
  });
});

describe("formatPresence", () => {
  function buildSummary(overrides: Partial<PresenceSummary> = {}): PresenceSummary {
    return {
      status: "online",
      manual: null,
      lastActiveAt: new Date(NOW.getTime() - 30 * 1000).toISOString(),
      watching: null,
      ...overrides,
    };
  }

  it("returns the watching line as caption when status === watching", () => {
    const result = formatPresence(
      "en",
      buildSummary({
        status: "watching",
        watching: {
          roomCode: "ABC",
          videoTitle: "Demo",
          service: "youtube",
          serviceLabel: "YouTube",
          startedAt: NOW.toISOString(),
        },
      }),
      { now: NOW },
    );
    expect(result.caption).toBe("“Demo” — YouTube");
    expect(result.statusLabel).toBe("Watching");
    expect(result.watchingLine).toBe("“Demo” — YouTube");
  });

  it("combines status + last-seen for online / idle", () => {
    const result = formatPresence("en", buildSummary({ status: "online" }), { now: NOW });
    expect(result.caption).toBe("Online · just now");
  });

  it("combines status + last-seen for sleeping / offline", () => {
    const result = formatPresence(
      "en",
      buildSummary({
        status: "sleeping",
        lastActiveAt: new Date(NOW.getTime() - 60 * MIN).toISOString(),
      }),
      { now: NOW },
    );
    expect(result.caption).toBe("Sleeping · 1h ago");
  });

  it("falls back to plain status label when last-seen is missing", () => {
    const result = formatPresence(
      "en",
      buildSummary({ status: "offline", lastActiveAt: null }),
      { now: NOW },
    );
    expect(result.caption).toBe("Offline");
  });
});

describe("comparePresenceStatus / PRESENCE_STATUS_ORDER", () => {
  it("orders watching > online > idle > sleeping > offline", () => {
    const order = [...PRESENCE_STATUS_ORDER];
    const shuffled: typeof order = ["sleeping", "online", "offline", "watching", "idle"];
    shuffled.sort(comparePresenceStatus);
    expect(shuffled).toEqual(order);
  });
});
