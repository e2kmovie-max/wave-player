import { describe, it, expect } from "bun:test";
import { pickWebLang, SUPPORTED_WEB_LANGS, t } from "../src/i18n";

describe("pickWebLang", () => {
  it("defaults to English when both inputs are empty/null", () => {
    expect(pickWebLang({})).toBe("en");
    expect(pickWebLang({ cookieValue: null, acceptLanguage: null })).toBe("en");
    expect(pickWebLang({ cookieValue: "", acceptLanguage: "" })).toBe("en");
  });

  it("respects an explicit cookie override over Accept-Language", () => {
    expect(pickWebLang({ cookieValue: "ru", acceptLanguage: "en-US,en;q=0.9" })).toBe("ru");
    expect(pickWebLang({ cookieValue: "en", acceptLanguage: "ru" })).toBe("en");
  });

  it("falls back to mapping an unknown override", () => {
    // 'uk' is not directly supported but maps to ru via Cyrillic-language rule.
    expect(pickWebLang({ cookieValue: "uk" })).toBe("ru");
    // Truly unknown override falls back to en.
    expect(pickWebLang({ cookieValue: "zz" })).toBe("en");
  });

  it("parses Accept-Language with q weights and picks the best supported match", () => {
    expect(pickWebLang({ acceptLanguage: "ru-RU,ru;q=0.9,en;q=0.8" })).toBe("ru");
    expect(pickWebLang({ acceptLanguage: "en-US,en;q=0.9" })).toBe("en");
    // Higher-weight ru beats lower-weight en.
    expect(pickWebLang({ acceptLanguage: "en;q=0.4,ru;q=0.8" })).toBe("ru");
    // Cyrillic neighbours all map to ru.
    expect(pickWebLang({ acceptLanguage: "uk-UA,uk;q=0.9" })).toBe("ru");
    expect(pickWebLang({ acceptLanguage: "be-BY" })).toBe("ru");
  });

  it("ignores unsupported language codes in Accept-Language", () => {
    expect(pickWebLang({ acceptLanguage: "fr-FR,de;q=0.9" })).toBe("en");
  });

  it("translates web strings in both languages", () => {
    expect(t("ru", "web.home.form_submit")).toBe("Создать комнату");
    expect(t("en", "web.home.form_submit")).toBe("Create room");
  });

  it("ships at least RU + EN in SUPPORTED_WEB_LANGS", () => {
    const codes = SUPPORTED_WEB_LANGS.map((l) => l.code).sort();
    expect(codes).toContain("ru");
    expect(codes).toContain("en");
  });
});
