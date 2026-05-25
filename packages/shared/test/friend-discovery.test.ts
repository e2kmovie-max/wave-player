import { describe, expect, it } from "bun:test";
import { escapeRegex, __friendDiscoveryTest__ } from "../src/friend-discovery";

const { displayName, avatarUrl } = __friendDiscoveryTest__;

describe("escapeRegex", () => {
  it("escapes regex metacharacters so user input cannot blow up the query", () => {
    expect(escapeRegex("a.b*c?")).toBe("a\\.b\\*c\\?");
    expect(escapeRegex("[]^$|(){}")).toBe("\\[\\]\\^\\$\\|\\(\\)\\{\\}");
    expect(escapeRegex("plain")).toBe("plain");
    expect(escapeRegex("")).toBe("");
  });
});

describe("displayName / avatarUrl pickers", () => {
  it("walks the same priority list as friends.ts", () => {
    expect(displayName({ googleName: "A" })).toBe("A");
    expect(displayName({ telegramFirstName: "B" })).toBe("B");
    expect(displayName({ telegramUsername: "c" })).toBe("c");
    expect(displayName({ guestName: "D" })).toBe("D");
    expect(displayName({ googleEmail: "e@example.com" })).toBe("e@example.com");
    expect(displayName({})).toBe("Guest");
  });

  it("prefers google avatar, then telegram photo, else null", () => {
    expect(avatarUrl({ googleAvatar: "g" })).toBe("g");
    expect(avatarUrl({ telegramPhotoUrl: "t" })).toBe("t");
    expect(avatarUrl({})).toBeNull();
  });
});
