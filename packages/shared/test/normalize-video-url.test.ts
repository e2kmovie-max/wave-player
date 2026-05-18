import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import { normalizeVideoUrl, WatchPartyError, __setAllowPrivateVideoTargetsForTests } from "../src/watch-party";

describe("normalizeVideoUrl", () => {
  beforeEach(() => {
    // Start each test in the production stance: private targets blocked.
    __setAllowPrivateVideoTargetsForTests(false);
  });
  afterAll(() => {
    // Bun test env defaults NODE_ENV=test so other suites can keep using
    // localhost fixtures (e.g. instance-client.test.ts spins up a server on
    // 127.0.0.1).
    __setAllowPrivateVideoTargetsForTests(true);
  });

  it("normalises a public YouTube URL unchanged", () => {
    const got = normalizeVideoUrl("  https://www.youtube.com/watch?v=dQw4w9WgXcQ  ");
    expect(got).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("rejects junk that is not a URL", () => {
    expect(() => normalizeVideoUrl("definitely not a url")).toThrow(WatchPartyError);
    expect(() => normalizeVideoUrl("")).toThrow(WatchPartyError);
  });

  it("rejects non-http(s) schemes", () => {
    for (const u of [
      "ftp://example.com/foo",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "data:text/plain,hi",
    ]) {
      expect(() => normalizeVideoUrl(u)).toThrow(WatchPartyError);
    }
  });

  it("rejects URLs with embedded credentials", () => {
    expect(() => normalizeVideoUrl("http://user:pw@youtube.com/foo")).toThrow(WatchPartyError);
  });

  it("rejects localhost and loopback IPs", () => {
    for (const u of [
      "http://localhost/foo",
      "http://127.0.0.1:8080/info",
      "http://[::1]/x",
    ]) {
      expect(() => normalizeVideoUrl(u)).toThrow(WatchPartyError);
    }
  });

  it("rejects RFC1918 and link-local targets", () => {
    for (const u of [
      "http://10.0.0.5/x",
      "http://192.168.1.50/x",
      "http://172.16.5.1/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[fc00::1]/x",
      "http://[fe80::1]/x",
    ]) {
      expect(() => normalizeVideoUrl(u)).toThrow(WatchPartyError);
    }
  });

  it("rejects multicast and unspecified addresses", () => {
    for (const u of ["http://224.0.0.1/x", "http://0.0.0.0/x"]) {
      expect(() => normalizeVideoUrl(u)).toThrow(WatchPartyError);
    }
  });

  it("respects the test escape hatch", () => {
    __setAllowPrivateVideoTargetsForTests(true);
    expect(normalizeVideoUrl("http://127.0.0.1:9999/whatever")).toBe(
      "http://127.0.0.1:9999/whatever",
    );
  });
});
