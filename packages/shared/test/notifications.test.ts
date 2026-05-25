import { describe, expect, it } from "bun:test";
import { NOTIFICATION_TYPES, type NotificationType } from "../src/models/Notification";

describe("NOTIFICATION_TYPES", () => {
  it("covers the four canonical friend events", () => {
    const expected: NotificationType[] = [
      "friend.request",
      "friend.accepted",
      "friend.online",
      "friend.watching",
    ];
    for (const t of expected) expect(NOTIFICATION_TYPES).toContain(t);
    expect(NOTIFICATION_TYPES.length).toBe(expected.length);
  });
});
