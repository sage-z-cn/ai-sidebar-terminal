import { describe, expect, it } from "vitest";
import { KimiCodeOperator } from "./KimiCodeOperator";
import type { AiToolConfig } from "../../../types";

describe("KimiCodeOperator", () => {
  const operator = new KimiCodeOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "kimi",
    label: "Kimi Code",
    path: "",
    args: [],
    aliases: [],
    operator: "kimi",
    ...overrides,
  });

  it("matches by id, operator, or alias (including kimi-code)", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "kimi" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({ name: "custom", operator: "custom", aliases: ["kimi"] }),
      ),
    ).toBe(true);
    // matches by the "kimi-code" alias
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["kimi-code"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "custom" })),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("kimi");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "kimi", args: ["--config=startup_tool=opencode"] }),
      ),
    ).toBe("kimi --config=startup_tool=opencode");
  });

  it("reports HTTP API and auto-context as disabled", () => {
    expect(operator.supportsHttpApi()).toBe(false);
    expect(operator.supportsAutoContext()).toBe(false);
  });

  it("does not emit a port arg (no HTTP API)", () => {
    expect(operator.buildPortArg(40000)).toBeUndefined();
  });

  it("formats file references with colon-based line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 10,
      }),
    ).toBe("@src/file.ts:10");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 20,
      }),
    ).toBe("@src/file.ts:10-20");
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
