import { describe, expect, it } from "vitest";
import {
  builtinThemeSwatch,
  swatchFromThemeJson,
} from "./openCodeThemeSwatches";

describe("openCodeThemeSwatches", () => {
  it("returns built-in swatches for known themes", () => {
    const nord = builtinThemeSwatch("nord");
    expect(nord.bg?.toLowerCase()).toBe("#2e3440");
    expect(nord.primary).toBeTruthy();
    expect(nord.accent).toBeTruthy();
  });

  it("falls back to default swatch for unknown names", () => {
    const unknown = builtinThemeSwatch("not-a-theme");
    expect(unknown.primary).toBeTruthy();
  });

  it("resolves def references and dark/light objects", () => {
    const swatch = swatchFromThemeJson({
      defs: { bg0: "#111111", accent0: "#ff0000" },
      theme: {
        background: { dark: "bg0", light: "#eeeeee" },
        backgroundPanel: "bg0",
        primary: "#00ff00",
        accent: "accent0",
        text: "none",
      },
    });
    expect(swatch.bg).toBe("#111111");
    expect(swatch.panel).toBe("#111111");
    expect(swatch.primary).toBe("#00ff00");
    expect(swatch.accent).toBe("#ff0000");
    expect(swatch.text).toBeUndefined();
  });

  it("returns empty swatch for invalid input", () => {
    expect(swatchFromThemeJson(null)).toEqual({});
    expect(swatchFromThemeJson({})).toEqual({});
  });
});
