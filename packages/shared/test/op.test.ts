import { describe, expect, it } from "bun:test";
import { __opTest__ } from "../src/op";

const { parseChannelInput, isSubscribedStatus, findMissingSubscriptions } = __opTest__;

describe("parseChannelInput", () => {
  it("parses bare @username", () => {
    expect(parseChannelInput("@wave_news")).toEqual({
      chatId: "@wave_news",
      title: "@wave_news",
    });
  });

  it("parses username without @ prefix", () => {
    expect(parseChannelInput("wave_news")).toEqual({
      chatId: "@wave_news",
      title: "@wave_news",
    });
  });

  it("parses https://t.me/<username>", () => {
    expect(parseChannelInput("https://t.me/wave_news")).toEqual({
      chatId: "@wave_news",
      title: "@wave_news",
    });
    expect(parseChannelInput("https://t.me/wave_news/")).toEqual({
      chatId: "@wave_news",
      title: "@wave_news",
    });
  });

  it("parses numeric -100… chat ids", () => {
    expect(parseChannelInput("-1001234567890")).toEqual({
      chatId: "-1001234567890",
      title: "-1001234567890",
    });
  });

  it("rejects private +invite links (need a forwarded message to learn the id)", () => {
    expect(parseChannelInput("https://t.me/+abc123")).toBeNull();
  });

  it("rejects junk input", () => {
    expect(parseChannelInput("")).toBeNull();
    expect(parseChannelInput("not a channel")).toBeNull();
    expect(parseChannelInput("https://example.com/foo")).toBeNull();
    expect(parseChannelInput("@a")).toBeNull(); // too short
  });
});

describe("isSubscribedStatus", () => {
  it("treats creator/admin/member/restricted as subscribed", () => {
    expect(isSubscribedStatus("creator")).toBe(true);
    expect(isSubscribedStatus("administrator")).toBe(true);
    expect(isSubscribedStatus("member")).toBe(true);
    expect(isSubscribedStatus("restricted")).toBe(true);
  });

  it("treats left/kicked/null/unknown as missing", () => {
    expect(isSubscribedStatus("left")).toBe(false);
    expect(isSubscribedStatus("kicked")).toBe(false);
    expect(isSubscribedStatus(null)).toBe(false);
    expect(isSubscribedStatus(undefined)).toBe(false);
    expect(isSubscribedStatus("anything-else")).toBe(false);
  });
});

describe("findMissingSubscriptions", () => {
  const channels = [
    { chatId: "@a", title: "A" },
    { chatId: "@b", title: "B" },
    { chatId: "-1001", title: "Private" },
  ];

  it("returns empty when all statuses are subscribed", () => {
    const missing = findMissingSubscriptions(channels, {
      "@a": "member",
      "@b": "creator",
      "-1001": "administrator",
    });
    expect(missing).toEqual([]);
  });

  it("returns each missing channel in original order", () => {
    const missing = findMissingSubscriptions(channels, {
      "@a": "left",
      "@b": "member",
      "-1001": null,
    });
    expect(missing.map((m) => m.chatId)).toEqual(["@a", "-1001"]);
  });
});
