import { describe, it, expect } from "bun:test";
import { parseInstancesJson } from "../src/instance-sync";

describe("parseInstancesJson", () => {
  it("returns [] for empty / whitespace input", () => {
    expect(parseInstancesJson("")).toEqual([]);
    expect(parseInstancesJson("   ")).toEqual([]);
  });

  it("parses a valid one-instance configuration with defaults filled in", () => {
    const got = parseInstancesJson(
      JSON.stringify([{ name: "local", url: "http://localhost:8080", secret: "s" }]),
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      name: "local",
      url: "http://localhost:8080",
      secret: "s",
      isLocal: false,
      enabled: true,
      maxStreams: 0,
    });
  });

  it("parses multiple entries", () => {
    const raw = JSON.stringify([
      { name: "local", url: "http://localhost:8080", secret: "s1", isLocal: true },
      { name: "eu-1", url: "https://stream.example.com", secret: "s2", maxStreams: 4 },
    ]);
    const got = parseInstancesJson(raw);
    expect(got.map((g) => g.name)).toEqual(["local", "eu-1"]);
    expect(got[0]?.isLocal).toBe(true);
    expect(got[1]?.maxStreams).toBe(4);
  });

  it("rejects non-array JSON", () => {
    expect(() => parseInstancesJson('{"name":"x"}')).toThrow();
  });

  it("rejects bad JSON syntax", () => {
    expect(() => parseInstancesJson("[{")).toThrow();
  });

  it("rejects entries missing required fields", () => {
    expect(() => parseInstancesJson('[{"name":"x","url":"http://x"}]')).toThrow();
    expect(() =>
      parseInstancesJson('[{"name":"x","url":"not-a-url","secret":"s"}]'),
    ).toThrow();
  });

  it("rejects entries with non-http(s) urls", () => {
    expect(() =>
      parseInstancesJson(
        JSON.stringify([{ name: "x", url: "ftp://example.com", secret: "s" }]),
      ),
    ).toThrow();
  });
});
