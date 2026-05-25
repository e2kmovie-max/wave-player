import { describe, expect, it } from "bun:test";
import {
  detectVideoService,
  getServiceLabel,
  listKnownVideoServices,
  UNKNOWN_VIDEO_SERVICE,
} from "../src/video-service";

describe("detectVideoService", () => {
  it("recognises canonical YouTube hosts", () => {
    expect(detectVideoService("https://www.youtube.com/watch?v=abc")).toEqual({
      service: "youtube",
      label: "YouTube",
      host: "youtube.com",
    });
    expect(detectVideoService("https://youtu.be/abc")).toEqual({
      service: "youtube",
      label: "YouTube",
      host: "youtu.be",
    });
    expect(detectVideoService("https://m.youtube.com/watch?v=abc")).toEqual({
      service: "youtube",
      label: "YouTube",
      host: "m.youtube.com",
    });
  });

  it("recognises Twitch, Vimeo, TikTok, Kick, RuTube, VK, Dailymotion", () => {
    expect(detectVideoService("https://twitch.tv/foo").service).toBe("twitch");
    expect(detectVideoService("https://vimeo.com/123").service).toBe("vimeo");
    expect(detectVideoService("https://www.tiktok.com/@user/video/1").service).toBe(
      "tiktok",
    );
    expect(detectVideoService("https://kick.com/foo").service).toBe("kick");
    expect(detectVideoService("https://rutube.ru/video/123").service).toBe("rutube");
    expect(detectVideoService("https://vkvideo.ru/video123").service).toBe("vk");
    expect(detectVideoService("https://www.dailymotion.com/video/x123").service).toBe(
      "dailymotion",
    );
    expect(detectVideoService("https://dai.ly/x123").service).toBe("dailymotion");
  });

  it("returns the host as the label for unknown services", () => {
    expect(detectVideoService("https://example.com/video/123")).toEqual({
      service: "unknown",
      label: "example.com",
      host: "example.com",
    });
  });

  it("returns the documented fallback for unparseable input", () => {
    expect(detectVideoService("not a url")).toEqual(UNKNOWN_VIDEO_SERVICE);
    expect(detectVideoService("")).toEqual(UNKNOWN_VIDEO_SERVICE);
    expect(detectVideoService(null)).toEqual(UNKNOWN_VIDEO_SERVICE);
    expect(detectVideoService(undefined)).toEqual(UNKNOWN_VIDEO_SERVICE);
  });
});

describe("getServiceLabel", () => {
  it("maps canonical ids to human labels", () => {
    expect(getServiceLabel("youtube")).toBe("YouTube");
    expect(getServiceLabel("twitch")).toBe("Twitch");
    expect(getServiceLabel("unknown")).toBeNull();
    expect(getServiceLabel("")).toBeNull();
    expect(getServiceLabel(null)).toBeNull();
    expect(getServiceLabel(undefined)).toBeNull();
  });
});

describe("listKnownVideoServices", () => {
  it("returns at least YouTube and Twitch", () => {
    const services = listKnownVideoServices().map((entry) => entry.service);
    expect(services).toContain("youtube");
    expect(services).toContain("twitch");
  });
});
