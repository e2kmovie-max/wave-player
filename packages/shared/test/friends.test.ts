import { describe, expect, it } from "bun:test";
import { Types } from "mongoose";
import { FriendshipError, __friendsTest__ } from "../src/friends";

const { canonicalPair, computeDirection, displayName, avatarUrl } = __friendsTest__;

describe("canonicalPair", () => {
  it("places the smaller _id in userA regardless of input order", () => {
    const a = new Types.ObjectId("000000000000000000000001");
    const b = new Types.ObjectId("000000000000000000000002");
    expect(canonicalPair(a, b)).toEqual({ userA: a, userB: b });
    expect(canonicalPair(b, a)).toEqual({ userA: a, userB: b });
  });

  it("rejects self-friendships", () => {
    const a = new Types.ObjectId("000000000000000000000001");
    expect(() => canonicalPair(a, a)).toThrow(FriendshipError);
  });
});

describe("computeDirection", () => {
  const viewer = new Types.ObjectId("000000000000000000000001");
  const other = new Types.ObjectId("000000000000000000000002");

  it("returns mutual for accepted pairs regardless of who requested", () => {
    expect(
      computeDirection(
        {
          _id: new Types.ObjectId(),
          userA: viewer,
          userB: other,
          requestedBy: other,
          status: "accepted",
        },
        viewer,
      ),
    ).toBe("mutual");
  });

  it("returns incoming when the other side requested", () => {
    expect(
      computeDirection(
        {
          _id: new Types.ObjectId(),
          userA: viewer,
          userB: other,
          requestedBy: other,
          status: "pending",
        },
        viewer,
      ),
    ).toBe("incoming");
  });

  it("returns outgoing when the viewer requested", () => {
    expect(
      computeDirection(
        {
          _id: new Types.ObjectId(),
          userA: viewer,
          userB: other,
          requestedBy: viewer,
          status: "pending",
        },
        viewer,
      ),
    ).toBe("outgoing");
  });
});

describe("displayName", () => {
  it("prefers Google name, falls back through Telegram → guest → email → Guest", () => {
    expect(displayName({ googleName: "Alice" })).toBe("Alice");
    expect(displayName({ telegramFirstName: "Bob" })).toBe("Bob");
    expect(displayName({ telegramUsername: "carol" })).toBe("carol");
    expect(displayName({ guestName: "Dave" })).toBe("Dave");
    expect(displayName({ googleEmail: "ed@example.com" })).toBe("ed@example.com");
    expect(displayName({})).toBe("Guest");
  });
});

describe("avatarUrl", () => {
  it("prefers googleAvatar, falls back to telegramPhotoUrl, then null", () => {
    expect(avatarUrl({ googleAvatar: "https://g/a" })).toBe("https://g/a");
    expect(avatarUrl({ telegramPhotoUrl: "https://t/b" })).toBe("https://t/b");
    expect(avatarUrl({})).toBeNull();
  });
});
