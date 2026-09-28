/**
 * Theme swatch colors for the settings UI (dark-mode preview).
 * Built-in values come from OpenCode packages/tui/src/theme/assets.
 */
import type { OpenCodeThemeSwatch } from "../../types";

export const OPENCODE_BUILTIN_THEME_SWATCHES: Record<
  string,
  OpenCodeThemeSwatch
> = {
  "": { bg: "#0a0a0a", panel: "#141414", primary: "#fab283", accent: "#9d7cd8", text: "#eeeeee" },
  system: { bg: "#1e1e1e", panel: "#2a2a2a", primary: "#88c0d0", accent: "#8fbcbb", text: "#d4d4d4" },
  aura: { bg: "#0f0f0f", panel: "#15141b", primary: "#a277ff", accent: "#a277ff", text: "#edecee" },
  ayu: { bg: "#0B0E14", panel: "#0F131A", primary: "#59C2FF", accent: "#E6B450", text: "#BFBDB6" },
  carbonfox: { bg: "#161616", panel: "#1a1a1a", primary: "#33b1ff", accent: "#ff7eb6", text: "#f2f4f8" },
  "catppuccin": { bg: "#1e1e2e", panel: "#181825", primary: "#89b4fa", accent: "#f5c2e7", text: "#cdd6f4" },
  "catppuccin-frappe": { bg: "#303446", panel: "#292c3c", primary: "#8da4e2", accent: "#f4b8e4", text: "#c6d0f5" },
  "catppuccin-macchiato": { bg: "#24273a", panel: "#1e2030", primary: "#8aadf4", accent: "#f5bde6", text: "#cad3f5" },
  cobalt2: { bg: "#193549", panel: "#122738", primary: "#0088ff", accent: "#2affdf", text: "#ffffff" },
  cursor: { bg: "#181818", panel: "#141414", primary: "#88c0d0", accent: "#88c0d0", text: "#e4e4e4" },
  dracula: { bg: "#282a36", panel: "#21222c", primary: "#bd93f9", accent: "#8be9fd", text: "#f8f8f2" },
  everforest: { bg: "#2d353b", panel: "#333c43", primary: "#a7c080", accent: "#d699b6", text: "#d3c6aa" },
  flexoki: { bg: "#100F0F", panel: "#1C1B1A", primary: "#DA702C", accent: "#8B7EC8", text: "#CECDC3" },
  github: { bg: "#0d1117", panel: "#010409", primary: "#58a6ff", accent: "#39c5cf", text: "#c9d1d9" },
  gruvbox: { bg: "#282828", panel: "#3c3836", primary: "#83a598", accent: "#8ec07c", text: "#ebdbb2" },
  kanagawa: { bg: "#1F1F28", panel: "#2A2A37", primary: "#7E9CD8", accent: "#D27E99", text: "#DCD7BA" },
  "lucent-orng": { bg: "#1a0f0a", panel: "#24140c", primary: "#EC5B2B", accent: "#FFF7F1", text: "#eeeeee" },
  material: { bg: "#263238", panel: "#1e272c", primary: "#82aaff", accent: "#89ddff", text: "#eeffff" },
  matrix: { bg: "#0a0e0a", panel: "#0e130d", primary: "#2eff6a", accent: "#c770ff", text: "#62ff94" },
  mercury: { bg: "#171721", panel: "#10101a", primary: "#8da4f5", accent: "#8da4f5", text: "#dddde5" },
  monokai: { bg: "#272822", panel: "#1e1f1c", primary: "#66d9ef", accent: "#a6e22e", text: "#f8f8f2" },
  nightowl: { bg: "#011627", panel: "#0b253a", primary: "#82AAFF", accent: "#c792ea", text: "#d6deeb" },
  nord: { bg: "#2E3440", panel: "#3B4252", primary: "#88C0D0", accent: "#8FBCBB", text: "#ECEFF4" },
  "one-dark": { bg: "#282c34", panel: "#21252b", primary: "#61afef", accent: "#56b6c2", text: "#abb2bf" },
  opencode: { bg: "#0a0a0a", panel: "#141414", primary: "#fab283", accent: "#9d7cd8", text: "#eeeeee" },
  orng: { bg: "#0a0a0a", panel: "#141414", primary: "#EC5B2B", accent: "#FFF7F1", text: "#eeeeee" },
  "osaka-jade": { bg: "#111c18", panel: "#1a2520", primary: "#2DD5B7", accent: "#549e6a", text: "#C1C497" },
  palenight: { bg: "#292d3e", panel: "#1e2132", primary: "#82aaff", accent: "#89ddff", text: "#a6accd" },
  rosepine: { bg: "#191724", panel: "#1f1d2e", primary: "#9ccfd8", accent: "#ebbcba", text: "#e0def4" },
  solarized: { bg: "#002b36", panel: "#073642", primary: "#268bd2", accent: "#2aa198", text: "#839496" },
  synthwave84: { bg: "#262335", panel: "#1e1a29", primary: "#36f9f6", accent: "#b084eb", text: "#ffffff" },
  tokyonight: { bg: "#1a1b26", panel: "#1e2030", primary: "#82aaff", accent: "#ff966c", text: "#c8d3f5" },
  vercel: { bg: "#000000", panel: "#1A1A1A", primary: "#0070F3", accent: "#8E4EC6", text: "#EDEDED" },
  vesper: { bg: "#101010", panel: "#101010", primary: "#FFC799", accent: "#FFC799", text: "#FFFFFF" },
  zenburn: { bg: "#3f3f3f", panel: "#4f4f4f", primary: "#8cd0d3", accent: "#93e0e3", text: "#dcdccc" },
};

type ThemeJsonLike = {
  defs?: Record<string, unknown>;
  theme?: Record<string, unknown>;
};

function resolveColor(
  value: unknown,
  defs: Record<string, unknown>,
  seen = new Set<string>(),
): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s || s === "none") return undefined;
    if (s.startsWith("#")) return s;
    if (/^[0-9a-fA-F]{3,8}$/.test(s)) return `#${s}`;
    if (defs && s in defs && !seen.has(s)) {
      seen.add(s);
      return resolveColor(defs[s], defs, seen);
    }
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return resolveColor(obj.dark ?? obj.light, defs, seen);
  }
  return undefined;
}

/** Extract preview swatch from an OpenCode theme JSON document. */
export function swatchFromThemeJson(doc: unknown): OpenCodeThemeSwatch {
  if (!doc || typeof doc !== "object") return {};
  const parsed = doc as ThemeJsonLike;
  const defs = parsed.defs ?? {};
  const theme = parsed.theme ?? {};
  const pick = (key: string) => resolveColor(theme[key], defs);
  return {
    bg: pick("background"),
    panel: pick("backgroundPanel"),
    primary: pick("primary"),
    accent: pick("accent"),
    text: pick("text"),
  };
}

export function builtinThemeSwatch(name: string): OpenCodeThemeSwatch {
  return (
    OPENCODE_BUILTIN_THEME_SWATCHES[name] ?? OPENCODE_BUILTIN_THEME_SWATCHES[""]
  );
}
