import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverOpenCodeThemesFromDisk,
  mergeThemeCatalogs,
} from "./openCodeThemeDiscovery";

describe("openCodeThemeDiscovery", () => {
  let dir: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-themes-"));
    prevConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = dir;
  });

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = prevConfigDir;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("always exposes default and system", () => {
    const found = discoverOpenCodeThemesFromDisk();
    const names = found.map((t) => t.name);
    expect(names).toContain("");
    expect(names).toContain("system");
  });

  it("discovers user themes from the themes directory", () => {
    const userThemes = path.join(dir, "themes");
    fs.mkdirSync(userThemes, { recursive: true });
    fs.writeFileSync(
      path.join(userThemes, "mine.json"),
      JSON.stringify({
        theme: {
          background: { dark: "#000000" },
          primary: { dark: "#0000ff" },
        },
      }),
      "utf8",
    );

    const found = discoverOpenCodeThemesFromDisk();
    const mine = found.find((t) => t.name === "mine");
    expect(mine?.source).toBe("user");
    expect(mine?.swatch.bg).toBe("#000000");
    expect(mine?.swatch.primary).toBe("#0000ff");
  });

  it("merges disk themes over hardcoded fallbacks", () => {
    const merged = mergeThemeCatalogs(
      [
        { name: "", swatch: { primary: "#111" }, source: "unknown" },
        { name: "custom-x", swatch: { primary: "#abc" }, source: "user" },
      ],
      [
        { value: "", label: "Default" },
        { value: "nord", label: "nord" },
        { value: "custom-x", label: "custom-x" },
      ],
      "unlisted",
    );
    const values = merged.map((m) => m.value);
    expect(values[0]).toBe("");
    expect(values).toContain("nord");
    expect(values).toContain("custom-x");
    expect(values).toContain("unlisted");
    expect(merged.find((m) => m.value === "custom-x")?.swatch.primary).toBe(
      "#abc",
    );
  });
});
