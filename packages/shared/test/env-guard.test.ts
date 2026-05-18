import { describe, expect, it, afterEach } from "bun:test";
import { DEV_APP_SECRET, __resetEnvCacheForTests, getEnv } from "../src/env";

describe("getEnv() APP_SECRET production guard", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    __resetEnvCacheForTests();
  });

  it("allows the dev default outside production", () => {
    delete process.env.APP_SECRET;
    process.env.NODE_ENV = "development";
    __resetEnvCacheForTests();
    expect(getEnv().APP_SECRET).toBe(DEV_APP_SECRET);
  });

  it("blocks the dev default in production", () => {
    process.env.APP_SECRET = DEV_APP_SECRET;
    process.env.NODE_ENV = "production";
    delete process.env.WAVE_ALLOW_INSECURE_APP_SECRET;
    __resetEnvCacheForTests();
    expect(() => getEnv()).toThrow(/APP_SECRET/);
  });

  it("lets an explicit override past the production guard", () => {
    process.env.APP_SECRET = "z".repeat(64);
    process.env.NODE_ENV = "production";
    __resetEnvCacheForTests();
    expect(getEnv().APP_SECRET).toBe("z".repeat(64));
  });

  it("respects the WAVE_ALLOW_INSECURE_APP_SECRET escape hatch", () => {
    process.env.APP_SECRET = DEV_APP_SECRET;
    process.env.NODE_ENV = "production";
    process.env.WAVE_ALLOW_INSECURE_APP_SECRET = "1";
    __resetEnvCacheForTests();
    // Should not throw — primarily so one-off CLIs can boot during a
    // recovery window even on the prod secret.
    expect(getEnv().APP_SECRET).toBe(DEV_APP_SECRET);
  });
});
