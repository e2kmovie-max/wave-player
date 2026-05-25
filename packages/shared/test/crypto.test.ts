import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { decrypt, encrypt, randomCode, signToken, verifyToken } from "../src/crypto";

const ENV_KEYS = ["APP_SECRET", "MONGODB_URI"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  process.env.APP_SECRET = "test-app-secret-aaaaaaaaaaaaaaaaaaaa";
  process.env.MONGODB_URI = "mongodb://localhost:27017/wave-test";
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

describe("signToken / verifyToken", () => {
  it("round-trips a primitive payload", () => {
    const token = signToken({ uid: "abc" });
    expect(verifyToken<{ uid: string }>(token)?.uid).toBe("abc");
  });

  it("returns null for tokens missing a signature", () => {
    expect(verifyToken("noDotHere")).toBeNull();
    expect(verifyToken("body.")).toBeNull();
    expect(verifyToken(".sig")).toBeNull();
  });

  it("returns null when the signature is wrong", () => {
    const token = signToken({ uid: "abc" });
    const [body] = token.split(".");
    const tampered = `${body}.AAAA`;
    expect(verifyToken(tampered)).toBeNull();
  });

  it("honours TTL: not expired immediately", () => {
    const token = signToken({ uid: "abc" }, 60);
    expect(verifyToken<{ uid: string }>(token)?.uid).toBe("abc");
  });

  it("honours TTL: expired after the deadline", () => {
    // Wait > 2 s — verifyToken uses second-resolution `floor(now) < exp`
    // (strict), so we need at least a full extra second beyond the TTL for
    // the deadline to definitely have passed.
    const token = signToken({ uid: "abc" }, 1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(verifyToken(token)).toBeNull();
        resolve();
      }, 2200);
    });
  });
});

describe("encrypt / decrypt", () => {
  it("round-trips utf-8 payloads", () => {
    const enc = encrypt("hello мир 🌊");
    expect(typeof enc).toBe("string");
    expect(decrypt(enc)).toBe("hello мир 🌊");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("throws on a malformed payload", () => {
    expect(() => decrypt("not-a-real-ciphertext")).toThrow();
  });
});

describe("randomCode", () => {
  it("produces the requested length using the safe alphabet", () => {
    const code = randomCode(8);
    expect(code).toHaveLength(8);
    expect(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]+$/.test(code)).toBe(true);
  });
});
