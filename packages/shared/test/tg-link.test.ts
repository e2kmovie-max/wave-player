import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  buildTgAuthDeeplink,
  signTgLinkToken,
  TG_LINK_TTL_SECONDS,
  verifyTgLinkToken,
  type TgLinkTokenData,
} from "../src/tg-link";

const ENV_KEYS = ["APP_SECRET", "MONGODB_URI"] as const;
const originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) originalEnv[k] = process.env[k];
  // getEnv() requires APP_SECRET to be at least 16 chars.
  process.env.APP_SECRET = "test-app-secret-aaaaaaaaaaaaaaaaaaaa";
  process.env.MONGODB_URI = "mongodb://localhost:27017/wave-test";
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

const baseData: TgLinkTokenData = {
  tgUserId: 123456,
  chatId: 123456,
  firstName: "Иван",
  lastName: "Иванов",
  username: "ivan",
  photoUrl: "https://t.me/i/userpic/320/ivan.jpg",
  lang: "ru",
};

describe("signTgLinkToken / verifyTgLinkToken", () => {
  it("round-trips the full payload", () => {
    const token = signTgLinkToken(baseData);
    const parsed = verifyTgLinkToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.tgUserId).toBe(baseData.tgUserId);
    expect(parsed!.chatId).toBe(baseData.chatId);
    expect(parsed!.firstName).toBe(baseData.firstName);
    expect(parsed!.lastName).toBe(baseData.lastName);
    expect(parsed!.username).toBe(baseData.username);
    expect(parsed!.photoUrl).toBe(baseData.photoUrl);
    expect(parsed!.lang).toBe("ru");
  });

  it("rejects an empty token", () => {
    expect(verifyTgLinkToken("")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const token = signTgLinkToken(baseData);
    const [body, sig] = token.split(".");
    // Mutate the body — signature stays the same → must fail.
    const tampered = `${body}AA.${sig}`;
    expect(verifyTgLinkToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    // Sign with a 1-second TTL, then verify after waiting past it. We need
    // to wait > 2 wall-clock seconds because verifyToken uses
    // `floor(now) < exp` (strict) with second-level resolution, so a token
    // signed at T.x with TTL=1 has exp=floor(T)+1 and stops being valid only
    // once floor(now) > floor(T)+1.
    const token = signTgLinkToken(baseData, 1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(verifyTgLinkToken(token)).toBeNull();
        resolve();
      }, 2200);
    });
  });

  it("defaults TTL to 10 minutes", () => {
    expect(TG_LINK_TTL_SECONDS).toBe(10 * 60);
  });
});

describe("buildTgAuthDeeplink", () => {
  it("embeds a valid signed token under /tg-auth", () => {
    // Pass publicWebUrl explicitly so the test doesn't depend on which env
    // value happened to be cached by getEnv() before this file loaded.
    const url = buildTgAuthDeeplink(baseData, {
      publicWebUrl: "https://wave.example",
    });
    expect(url.startsWith("https://wave.example/tg-auth?token=")).toBe(true);
    const u = new URL(url);
    expect(u.pathname).toBe("/tg-auth");
    const token = u.searchParams.get("token");
    expect(token).toBeTruthy();
    const decoded = verifyTgLinkToken(token!);
    expect(decoded?.tgUserId).toBe(baseData.tgUserId);
  });

  it("strips a trailing slash from the base URL", () => {
    const url = buildTgAuthDeeplink(baseData, {
      publicWebUrl: "https://wave.example/foo/",
    });
    expect(url.startsWith("https://wave.example/foo/tg-auth?token=")).toBe(true);
  });

  it("emits a signed token with two dot-separated segments", () => {
    const url = buildTgAuthDeeplink(baseData, {
      publicWebUrl: "https://wave.example",
    });
    const u = new URL(url);
    const token = u.searchParams.get("token");
    expect(token).toBeTruthy();
    expect(token!.split(".").length).toBe(2);
  });
});
