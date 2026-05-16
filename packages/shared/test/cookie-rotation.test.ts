import { describe, it, expect } from "bun:test";
import { withCookieRotation, type YtDlpCredentials } from "../src/watch-party";
import { InstanceError } from "../src/instance-client";

const silent = { warn: () => {}, info: () => {} } as const;

function makeCreds(id: string | null): YtDlpCredentials {
  return id === null
    ? { accountId: null }
    : { accountId: id, label: `label-${id}`, cookies: [], userAgent: "test" };
}

describe("withCookieRotation", () => {
  it("returns the first attempt when run() succeeds", async () => {
    const loader = async () => makeCreds("a1");
    const autoDisable = async () => {
      throw new Error("should not be called");
    };
    const result = await withCookieRotation(async () => "ok", {
      loader,
      autoDisable,
      log: silent,
    });
    expect(result.attempts).toBe(1);
    expect(result.value).toBe("ok");
    expect(result.credentials.accountId).toBe("a1");
  });

  it("rotates once on a rotatable error and succeeds on the next pick", async () => {
    const queued = ["a1", "a2"];
    const loader = async ({ excludeIds }: { excludeIds?: ReadonlyArray<string> } = {}) => {
      const next = queued.shift();
      if (!next) return makeCreds(null);
      if (excludeIds?.includes(next)) {
        throw new Error("loader should not return excluded id " + next);
      }
      return makeCreds(next);
    };
    const disabled: Array<{ id: string; reason: string }> = [];
    const autoDisable = async (id: string, reason: string) => {
      disabled.push({ id, reason });
    };

    let attempt = 0;
    const result = await withCookieRotation(
      async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new InstanceError("blocked", 401, '{"error":"blocked","errorCode":"bot_detected"}');
        }
        return "served";
      },
      { loader, autoDisable, log: silent, maxAttempts: 3 },
    );

    expect(attempt).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.value).toBe("served");
    expect(result.credentials.accountId).toBe("a2");
    expect(disabled).toEqual([{ id: "a1", reason: "bot_detected" }]);
  });

  it("rethrows non-rotatable instance errors without disabling", async () => {
    const loader = async () => makeCreds("a1");
    let autoDisableCalls = 0;
    const autoDisable = async () => {
      autoDisableCalls += 1;
    };
    await expect(
      withCookieRotation(
        async () => {
          throw new InstanceError("gone", 410, '{"errorCode":"unavailable"}');
        },
        { loader, autoDisable, log: silent },
      ),
    ).rejects.toBeInstanceOf(InstanceError);
    expect(autoDisableCalls).toBe(0);
  });

  it("does not rotate when no account id is available (empty pool)", async () => {
    const loader = async () => makeCreds(null);
    let autoDisableCalls = 0;
    const autoDisable = async () => {
      autoDisableCalls += 1;
    };
    await expect(
      withCookieRotation(
        async () => {
          throw new InstanceError("blocked", 401, '{"errorCode":"bot_detected"}');
        },
        { loader, autoDisable, log: silent },
      ),
    ).rejects.toBeInstanceOf(InstanceError);
    // No id ⇒ nothing to rotate ⇒ the error is rethrown immediately.
    expect(autoDisableCalls).toBe(0);
  });

  it("stops after maxAttempts and rethrows the last error", async () => {
    let loaderHits = 0;
    const loader = async () => {
      loaderHits += 1;
      return makeCreds(`a${loaderHits}`);
    };
    const autoDisable = async () => {};
    await expect(
      withCookieRotation(
        async () => {
          throw new InstanceError("blocked", 401, '{"errorCode":"bot_detected"}');
        },
        { loader, autoDisable, log: silent, maxAttempts: 2 },
      ),
    ).rejects.toBeInstanceOf(InstanceError);
    expect(loaderHits).toBe(2);
  });

  it("swallows auto-disable failures and keeps rotating", async () => {
    const queued = ["a1", "a2"];
    const loader = async () => {
      const next = queued.shift();
      return next ? makeCreds(next) : makeCreds(null);
    };
    const autoDisable = async () => {
      throw new Error("mongo unreachable");
    };
    let attempt = 0;
    const result = await withCookieRotation(
      async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new InstanceError("blocked", 401, '{"errorCode":"bot_detected"}');
        }
        return "served";
      },
      { loader, autoDisable, log: silent, maxAttempts: 3 },
    );
    expect(result.value).toBe("served");
    expect(result.attempts).toBe(2);
  });
});
