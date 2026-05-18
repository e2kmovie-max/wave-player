import { describe, expect, it } from "bun:test";
import { InstancePoolError, normalizeInstanceUrl } from "../src/instance-pool";

describe("normalizeInstanceUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeInstanceUrl("https://stream.example.com/")).toBe(
      "https://stream.example.com",
    );
    expect(normalizeInstanceUrl(" https://stream.example.com//  ")).toBe(
      "https://stream.example.com",
    );
  });

  it("keeps explicit ports", () => {
    expect(normalizeInstanceUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("rejects non-http schemes", () => {
    expect(() => normalizeInstanceUrl("ftp://example.com")).toThrow(InstancePoolError);
    expect(() => normalizeInstanceUrl("file:///etc/passwd")).toThrow(InstancePoolError);
  });

  it("rejects malformed input that the old regex would accept", () => {
    // The regex `^https?:\/\/[^\s]+$` matched even when there was no host.
    expect(() => normalizeInstanceUrl("http://")).toThrow(InstancePoolError);
    expect(() => normalizeInstanceUrl("https://")).toThrow(InstancePoolError);
  });

  it("rejects entirely missing input", () => {
    expect(() => normalizeInstanceUrl("")).toThrow(InstancePoolError);
    expect(() => normalizeInstanceUrl("not a url")).toThrow(InstancePoolError);
  });
});
