import { describe, expect, it } from "vitest";
import { GeminiCLIOperator } from "./GeminiCLIOperator";
import type { AiToolConfig } from "../../../types";

describe("GeminiCLIOperator", () => {
  const operator = new GeminiCLIOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "gemini",
    label: "Gemini CLI",
    path: "",
    args: [],
    aliases: [],
    operator: "gemini",
    ...overrides,
  });

  it("matches by id, operator, or alias", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "gemini" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({ name: "custom", operator: "custom", aliases: ["gemini"] }),
      ),
    ).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "custom" })),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("gemini");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "/opt/bin/gemini", args: ["-p"] }),
      ),
    ).toBe("/opt/bin/gemini -p");
  });

  it("reports HTTP API and auto-context as disabled", () => {
    expect(operator.supportsHttpApi()).toBe(false);
    expect(operator.supportsAutoContext()).toBe(false);
  });

  it("does not emit a port arg (no HTTP API)", () => {
    expect(operator.buildPortArg(40000)).toBeUndefined();
  });

  it("formats file references WITHOUT line ranges (@file only)", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    // Line ranges are NOT supported — always just @file
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 5,
        selectionEnd: 5,
      }),
    ).toBe("@src/file.ts");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 5,
        selectionEnd: 11,
      }),
    ).toBe("@src/file.ts");
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
    expect(operator.formatPastedImage("/tmp/img.png")).toBe("/tmp/img.png");
  });
});
