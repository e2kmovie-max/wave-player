import { describe, expect, it } from "bun:test";
import { __i18nTest__, pickLang, t } from "../src/i18n";

describe("pickLang", () => {
  it("returns ru for ru-* / uk-* / be-* codes", () => {
    expect(pickLang("ru")).toBe("ru");
    expect(pickLang("ru-RU")).toBe("ru");
    expect(pickLang("uk")).toBe("ru");
    expect(pickLang("be-BY")).toBe("ru");
  });

  it("falls back to en for anything else (incl. missing)", () => {
    expect(pickLang(null)).toBe("en");
    expect(pickLang(undefined)).toBe("en");
    expect(pickLang("")).toBe("en");
    expect(pickLang("en-US")).toBe("en");
    expect(pickLang("de")).toBe("en");
  });
});

describe("t", () => {
  it("returns the matching ru/en string", () => {
    expect(t("ru", "common.added")).toBe("Добавлено.");
    expect(t("en", "common.added")).toBe("Added.");
  });

  it("interpolates {placeholder} variables", () => {
    const ru = t("ru", "admin.cookies.invalid_payload", { error: "bad" });
    expect(ru).toBe("Не получилось разобрать куки: bad");
    const en = t("en", "admin.cookies.invalid_payload", { error: "bad" });
    expect(en).toBe("Could not parse the cookies: bad");
  });

  it("leaves unknown placeholders intact (defensive)", () => {
    expect(t("en", "admin.cookies.invalid_payload", { other: "x" })).toContain("{error}");
  });

  it("covers every known key in both languages", () => {
    for (const [key, value] of Object.entries(__i18nTest__.strings)) {
      expect(typeof value.ru).toBe("string");
      expect(typeof value.en).toBe("string");
      expect(value.ru.length, `ru missing for ${key}`).toBeGreaterThan(0);
      expect(value.en.length, `en missing for ${key}`).toBeGreaterThan(0);
    }
  });
});
