import { describe, expect, it } from "bun:test";
import { __watchPartyTest__ } from "../src/watch-party";

describe("buildRoomFormats", () => {
  it("creates a best preset and descending height presets", () => {
    const formats = __watchPartyTest__.buildRoomFormats({
      id: "video",
      title: "Video",
      formats: [
        {
          formatId: "18",
          hasAudio: true,
          hasVideo: true,
          height: 360,
          width: 640,
        },
        {
          formatId: "137",
          hasAudio: false,
          hasVideo: true,
          height: 1080,
          width: 1920,
        },
        {
          formatId: "140",
          hasAudio: true,
          hasVideo: false,
        },
      ],
    });

    expect(formats.map((format) => format.label)).toEqual([
      "Best available",
      "1080p",
      "360p",
    ]);
    expect(formats[1]?.formatId).toContain("height<=1080");
  });
});

describe("parseCookiePayload", () => {
  it("parses Netscape cookies into instance cookie objects", () => {
    const cookies = __watchPartyTest__.parseCookiePayload(
      "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1893456000\tSID\tsecret",
    );

    expect(cookies).toEqual([
      {
        domain: ".youtube.com",
        path: "/",
        secure: true,
        expires: 1893456000,
        name: "SID",
        value: "secret",
        httpOnly: false,
      },
    ]);
  });
});
