import { describe, expect, it } from "bun:test";
import {
  computePresence,
  DEFAULT_PRESENCE_THRESHOLDS,
  summarizePresence,
  __presenceTest__,
} from "../src/presence";

const NOW = new Date("2024-06-01T12:00:00.000Z");
const MIN = 60 * 1000;

describe("computePresence", () => {
  it("is offline when manual override is offline, even if active", () => {
    const status = computePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: "offline",
        watching: {
          roomCode: "ABC12345",
          service: "youtube",
          serviceLabel: "YouTube",
          startedAt: NOW.toISOString(),
        },
      },
      { now: NOW },
    );
    expect(status).toBe("offline");
  });

  it("is sleeping when manual override is sleeping and no watching", () => {
    const status = computePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: "sleeping",
        watching: null,
      },
      { now: NOW },
    );
    expect(status).toBe("sleeping");
  });

  it("manual sleeping wins over watching to support DND mode", () => {
    const status = computePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: "sleeping",
        watching: {
          roomCode: "ABC12345",
          service: "youtube",
          serviceLabel: "YouTube",
          startedAt: NOW.toISOString(),
        },
      },
      { now: NOW },
    );
    expect(status).toBe("sleeping");
  });

  it("watching wins when the heartbeat is fresh and no DND", () => {
    const status = computePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: null,
        watching: {
          roomCode: "ABC12345",
          service: "youtube",
          serviceLabel: "YouTube",
          startedAt: NOW.toISOString(),
        },
      },
      { now: NOW },
    );
    expect(status).toBe("watching");
  });

  it("watching is downgraded to online when the watching heartbeat is stale", () => {
    const status = computePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: null,
        watching: {
          roomCode: "ABC12345",
          service: "youtube",
          serviceLabel: "YouTube",
          // 30 min old — beyond watchingFreshMs.
          startedAt: new Date(NOW.getTime() - 30 * MIN).toISOString(),
        },
      },
      { now: NOW },
    );
    expect(status).toBe("online");
  });

  it("transitions online → idle → sleeping → offline as activity ages", () => {
    const baseInputs = {
      manualStatus: null as const,
      watching: null,
    };
    expect(
      computePresence(
        { ...baseInputs, lastActiveAt: new Date(NOW.getTime() - 60_000) },
        { now: NOW },
      ),
    ).toBe("online");
    expect(
      computePresence(
        { ...baseInputs, lastActiveAt: new Date(NOW.getTime() - 5 * MIN) },
        { now: NOW },
      ),
    ).toBe("idle");
    expect(
      computePresence(
        { ...baseInputs, lastActiveAt: new Date(NOW.getTime() - 60 * MIN) },
        { now: NOW },
      ),
    ).toBe("sleeping");
    expect(
      computePresence(
        {
          ...baseInputs,
          lastActiveAt: new Date(NOW.getTime() - 48 * 60 * MIN),
        },
        { now: NOW },
      ),
    ).toBe("offline");
  });

  it("treats missing lastActiveAt as offline", () => {
    expect(
      computePresence(
        { lastActiveAt: null, manualStatus: null, watching: null },
        { now: NOW },
      ),
    ).toBe("offline");
  });

  it("respects custom thresholds", () => {
    expect(
      computePresence(
        {
          lastActiveAt: new Date(NOW.getTime() - 30_000),
          manualStatus: null,
          watching: null,
        },
        { now: NOW, thresholds: { onlineWithinMs: 10_000 } },
      ),
    ).toBe("idle");
  });
});

describe("summarizePresence", () => {
  it("returns watching payload only when status === 'watching'", () => {
    const summary = summarizePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: null,
        watching: {
          roomCode: "ABC12345",
          videoUrl: "https://youtu.be/abc",
          videoTitle: "Test",
          service: "youtube",
          serviceLabel: "YouTube",
          startedAt: NOW.toISOString(),
        },
      },
      { now: NOW },
    );
    expect(summary.status).toBe("watching");
    expect(summary.watching).not.toBeNull();
    expect(summary.watching?.serviceLabel).toBe("YouTube");
    expect(summary.lastActiveAt).toBe(new Date(NOW.getTime() - 30_000).toISOString());
  });

  it("strips watching payload for non-watching states", () => {
    // ~1h old: past `idleWithinMs` (10 min) but inside `autoSleepAfterMs` (8h).
    const summary = summarizePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 60 * MIN),
        manualStatus: null,
        watching: null,
      },
      { now: NOW },
    );
    expect(summary.status).toBe("sleeping");
    expect(summary.watching).toBeNull();
  });

  it("normalizes invalid manualStatus into null", () => {
    const summary = summarizePresence(
      {
        lastActiveAt: new Date(NOW.getTime() - 30_000),
        manualStatus: "garbage",
        watching: null,
      },
      { now: NOW },
    );
    expect(summary.manual).toBeNull();
    expect(summary.status).toBe("online");
  });
});

describe("normalizeWatching", () => {
  it("returns null for empty input", () => {
    expect(__presenceTest__.normalizeWatching(null)).toBeNull();
    expect(__presenceTest__.normalizeWatching(undefined)).toBeNull();
    expect(__presenceTest__.normalizeWatching({ roomCode: "" })).toBeNull();
  });

  it("fills sensible defaults", () => {
    const result = __presenceTest__.normalizeWatching({
      roomCode: "ABC12345",
    });
    expect(result).not.toBeNull();
    expect(result?.service).toBe("unknown");
    expect(result?.serviceLabel).toBe("Unknown");
    expect(typeof result?.startedAt).toBe("string");
  });
});

describe("DEFAULT_PRESENCE_THRESHOLDS", () => {
  it("is structurally sound", () => {
    expect(DEFAULT_PRESENCE_THRESHOLDS.onlineWithinMs).toBeGreaterThan(0);
    expect(DEFAULT_PRESENCE_THRESHOLDS.idleWithinMs).toBeGreaterThan(
      DEFAULT_PRESENCE_THRESHOLDS.onlineWithinMs,
    );
    expect(DEFAULT_PRESENCE_THRESHOLDS.autoSleepAfterMs).toBeGreaterThan(
      DEFAULT_PRESENCE_THRESHOLDS.idleWithinMs,
    );
  });
});
