import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FRIEND_RATE_LIMITS,
  FriendRateLimitError,
} from "../src/friend-rate-limit";

describe("FriendRateLimitError", () => {
  it("carries a structured code + status", () => {
    const err = new FriendRateLimitError("nope", "too_many_pending");
    expect(err.code).toBe("too_many_pending");
    expect(err.status).toBe(429);
    expect(err.name).toBe("FriendRateLimitError");
  });

  it("allows overriding the status", () => {
    const err = new FriendRateLimitError("nope", "too_many_recent", 503);
    expect(err.status).toBe(503);
  });
});

describe("DEFAULT_FRIEND_RATE_LIMITS", () => {
  it("is structurally sound", () => {
    expect(DEFAULT_FRIEND_RATE_LIMITS.maxOutstandingPending).toBeGreaterThan(0);
    expect(DEFAULT_FRIEND_RATE_LIMITS.maxPerWindow).toBeGreaterThan(0);
    expect(DEFAULT_FRIEND_RATE_LIMITS.windowMs).toBeGreaterThan(0);
  });
});
