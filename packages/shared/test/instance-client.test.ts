import { describe, it, expect } from "bun:test";
import { __test__, InstanceClient, InstanceError } from "../src/instance-client";

describe("signBody", () => {
  it("produces the same digest as the Go reference implementation (timestamp + . + body)", () => {
    // Mirrors the test vector used by the Go tests:
    //   secret = "the-secret"
    //   timestamp = "1234567890"
    //   body = `{"url":"https://example.com"}`
    // Computed by Node's built-in crypto and pinned here so the master/instance
    // implementations cannot drift apart silently.
    const sig = __test__.signBody("the-secret", "1234567890", '{"url":"https://example.com"}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    // Pin: hmac-sha256("1234567890" + "." + body, "the-secret"). Computed
    // once with `node -e 'console.log(crypto.createHmac("sha256","the-secret").update("1234567890.").update(body).digest("hex"))'`
    // to detect any future drift in the signing algorithm.
    expect(sig).toBe(
      "906e6f1a8d91ad650fdfbc73cf64c459481ef251857795587877b630e5bcea87",
    );
  });

  it("changes when timestamp changes", () => {
    const a = __test__.signBody("s", "1", "body");
    const b = __test__.signBody("s", "2", "body");
    expect(a).not.toBe(b);
  });

  it("changes when body changes", () => {
    const a = __test__.signBody("s", "1", "body-a");
    const b = __test__.signBody("s", "1", "body-b");
    expect(a).not.toBe(b);
  });
});

describe("InstanceClient.health", () => {
  it("calls /health, returns parsed JSON, never sends signature headers", async () => {
    let captured: { url: string; init?: RequestInit } | null = null;
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: typeof input === "string" ? input : input.toString(), init };
      return new Response(
        JSON.stringify({
          ok: true,
          version: "dev",
          startedAt: "2026-01-01T00:00:00Z",
          uptimeSeconds: 12,
          activeStreams: 0,
          maxStreams: 0,
          tools: { ytDlp: "2026.03.17", ffmpeg: "ffmpeg version 6.0" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const client = new InstanceClient(
      { url: "http://localhost:8080", secret: "s" },
      fakeFetch,
    );
    const health = await client.health({ timeoutMs: 1000 });
    expect(health.ok).toBe(true);
    expect(health.version).toBe("dev");
    expect(captured!.url).toBe("http://localhost:8080/health");
    const headers = (captured!.init?.headers ?? {}) as Record<string, string>;
    expect(headers["X-Wave-Signature"]).toBeUndefined();
    expect(headers["X-Wave-Timestamp"]).toBeUndefined();
  });

  it("throws InstanceError on non-2xx", async () => {
    const fakeFetch: typeof fetch = (async () =>
      new Response("nope", { status: 503 })) as typeof fetch;
    const client = new InstanceClient(
      { url: "http://localhost:8080", secret: "s" },
      fakeFetch,
    );
    await expect(client.health()).rejects.toBeInstanceOf(InstanceError);
  });
});

describe("InstanceClient.info (signed)", () => {
  it("attaches X-Wave-Timestamp and X-Wave-Signature on POST /info", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";
    const fakeFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      expect(url).toBe("http://localhost:8080/info");
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = init?.body as string;
      return new Response(JSON.stringify({ id: "x", title: "y", formats: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const client = new InstanceClient(
      { url: "http://localhost:8080", secret: "the-secret" },
      fakeFetch,
    );
    const info = await client.info({ url: "https://example.com" });
    expect(info.id).toBe("x");
    expect(capturedHeaders["X-Wave-Timestamp"]).toMatch(/^\d+$/);
    expect(capturedHeaders["X-Wave-Signature"]).toMatch(/^[0-9a-f]{64}$/);

    // Verify signature against the captured body and timestamp.
    const expected = __test__.signBody(
      "the-secret",
      capturedHeaders["X-Wave-Timestamp"],
      capturedBody,
    );
    expect(capturedHeaders["X-Wave-Signature"]).toBe(expected);
  });
});
