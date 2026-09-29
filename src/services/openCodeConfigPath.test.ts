import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureOpenCodeGlobalFile,
  resolveOpenCodeGlobalAgentsMdPath,
  resolveOpenCodeGlobalConfigPath,
} from "./openCodeConfigPath";

describe("openCodeConfigPath global files", () => {
  let configDir: string;
  let previousConfigDir: string | undefined;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-config-"));
    previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
    process.env.OPENCODE_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (previousConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
    }
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it("resolves AGENTS.md under the OpenCode config dir", () => {
    expect(resolveOpenCodeGlobalAgentsMdPath()).toBe(
      path.join(configDir, "AGENTS.md"),
    );
  });

  it("prefers an existing opencode.jsonc over the default json name", () => {
    const jsonc = path.join(configDir, "opencode.jsonc");
    fs.writeFileSync(jsonc, "{}", "utf8");
    expect(resolveOpenCodeGlobalConfigPath()).toBe(jsonc);
  });

  it("prefers an existing opencode.json", () => {
    const json = path.join(configDir, "opencode.json");
    const jsonc = path.join(configDir, "opencode.jsonc");
    fs.writeFileSync(json, "{}", "utf8");
    fs.writeFileSync(jsonc, "{}", "utf8");
    expect(resolveOpenCodeGlobalConfigPath()).toBe(json);
  });

  it("creates missing AGENTS.md and opencode.json with starter content", () => {
    const agents = ensureOpenCodeGlobalFile("agentsMd");
    const config = ensureOpenCodeGlobalFile("opencodeJson");
    expect(fs.readFileSync(agents, "utf8")).toBe("");
    expect(fs.readFileSync(config, "utf8")).toBe("{}\n");
    // Second call reuses the same paths without rewriting.
    expect(ensureOpenCodeGlobalFile("agentsMd")).toBe(agents);
    expect(ensureOpenCodeGlobalFile("opencodeJson")).toBe(config);
  });

  it("opens an existing jsonc instead of creating a new json", () => {
    const jsonc = path.join(configDir, "opencode.jsonc");
    fs.writeFileSync(jsonc, "{\n}\n", "utf8");
    const resolved = ensureOpenCodeGlobalFile("opencodeJson");
    expect(resolved).toBe(jsonc);
    expect(fs.existsSync(path.join(configDir, "opencode.json"))).toBe(false);
    expect(fs.readFileSync(jsonc, "utf8")).toBe("{\n}\n");
  });

  it("creates missing cli.json with starter content", () => {
    const cli = ensureOpenCodeGlobalFile("cliJson");
    expect(cli).toBe(path.join(configDir, "cli.json"));
    expect(fs.readFileSync(cli, "utf8")).toBe("{}\n");
    expect(ensureOpenCodeGlobalFile("cliJson")).toBe(cli);
  });
});
