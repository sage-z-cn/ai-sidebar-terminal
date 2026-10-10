import { describe, expect, it } from "vitest";
import { OpenCodeToolOperator } from "./OpenCodeToolOperator";

describe("OpenCodeToolOperator", () => {
  const operator = new OpenCodeToolOperator();

  it("resolves launch commands from the command path and args", () => {
    expect(operator.getLaunchCommand({ commandPath: "opencode", args: [] })).toBe(
      "opencode",
    );
    expect(
      operator.getLaunchCommand({ commandPath: "opencode", args: ["-c"] }),
    ).toBe("opencode -c");
    expect(
      operator.getLaunchCommand({
        commandPath: "/opt/bin/opencode",
        args: ["--headless", "--json"],
      }),
    ).toBe("/opt/bin/opencode --headless --json");
  });

  it("appends the continue flag when continueLastSession is true", () => {
    expect(
      operator.getLaunchCommand({
        commandPath: "opencode",
        args: [],
        continueLastSession: true,
      }),
    ).toBe("opencode -c");
    expect(
      operator.getLaunchCommand({
        commandPath: "/opt/bin/opencode",
        args: ["--headless"],
        continueLastSession: true,
      }),
    ).toBe("/opt/bin/opencode --headless -c");
  });

  it("omits the continue flag when continueLastSession is false or unset", () => {
    expect(
      operator.getLaunchCommand({
        commandPath: "opencode",
        args: ["--headless"],
        continueLastSession: false,
      }),
    ).toBe("opencode --headless");
    expect(
      operator.getLaunchCommand({ commandPath: "opencode", args: [] }),
    ).toBe("opencode");
  });

  it("returns an empty string for an empty or blank command path", () => {
    expect(
      operator.getLaunchCommand({ commandPath: "", args: ["--headless"] }),
    ).toBe("");
    expect(operator.getLaunchCommand({ commandPath: "   ", args: [] })).toBe(
      "",
    );
    expect(
      operator.getLaunchCommand({
        commandPath: "",
        args: [],
        continueLastSession: true,
      }),
    ).toBe("");
  });

  it("trims the assembled command", () => {
    expect(
      operator.getLaunchCommand({ commandPath: "  opencode  ", args: [] }),
    ).toBe("opencode");
  });

  it("reports HTTP API and auto-context support", () => {
    expect(operator.supportsHttpApi()).toBe(true);
    expect(operator.supportsAutoContext()).toBe(true);
  });

  it("emits --port=N for a confirmed v1 and omits it for v2/unknown", () => {
    // OpenCode v1 reads the port from --port. OpenCode v2 rejects --port on
    // the TUI and attaches to the background service instead. An unknown
    // version must also omit the flag: passing it to a v2 TUI is fatal,
    // while a v1 TUI merely runs without the HTTP API.
    expect(operator.buildPortArg(59867, { cliMajorVersion: 1 })).toBe(
      "--port=59867",
    );
    expect(operator.buildPortArg(59867)).toBeUndefined();
    expect(operator.buildPortArg(59867, { cliMajorVersion: 2 })).toBeUndefined();
    expect(operator.buildPortArg(1, { cliMajorVersion: 2 })).toBeUndefined();
  });

  it("formats file references with optional line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 8,
        selectionEnd: 8,
      }),
    ).toBe("@src/file.ts#8");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 8,
      }),
    ).toBe("@src/file.ts#8");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 8,
        selectionEnd: 12,
      }),
    ).toBe("@src/file.ts#8-12");
  });

  it("formats dropped files with and without @ syntax", () => {
    const files = ["src/a.ts", "src/b.ts"];

    expect(operator.formatDroppedFiles(files, { useAtSyntax: true })).toBe(
      "@src/a.ts @src/b.ts",
    );
    expect(operator.formatDroppedFiles(files, { useAtSyntax: false })).toBe(
      "src/a.ts src/b.ts",
    );
  });

  it("passes pasted image paths through unchanged", () => {
    expect(operator.formatPastedImage("/tmp/pasted.png")).toBe(
      "/tmp/pasted.png",
    );
  });
});
