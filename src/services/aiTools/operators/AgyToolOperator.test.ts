import { describe, expect, it } from "vitest";
import { AgyToolOperator } from "./AgyToolOperator";
import type { AiToolConfig } from "../../../types";

describe("AgyToolOperator", () => {
  const operator = new AgyToolOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "agy",
    label: "Antigravity",
    path: "",
    args: [],
    aliases: ["antigravity"],
    operator: "agy",
    ...overrides,
  });

  it("matches by id, operator, and alias", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "agy" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["antigravity"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["agy"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["different"],
        }),
      ),
    ).toBe(false);
    expect(
      operator.matches(
        createTool({ name: "custom", operator: "custom", aliases: undefined }),
      ),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("agy");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "/root/.local/bin/agy", args: ["--continue"] }),
      ),
    ).toBe("/root/.local/bin/agy --continue");
  });

  it("reports HTTP API and auto-context support as disabled", () => {
    expect(operator.supportsHttpApi()).toBe(false);
    expect(operator.supportsAutoContext()).toBe(false);
  });

  it("uses native paste so Agy can read rich clipboard content", () => {
    expect(operator.supportsNativePaste()).toBe(true);
  });

  it("does not emit a port arg (no HTTP API)", () => {
    expect(operator.buildPortArg(40000)).toBeUndefined();
  });

  it("formats file references with optional line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 3,
        selectionEnd: 3,
      }),
    ).toBe("@src/file.ts#L3");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 3,
        selectionEnd: 9,
      }),
    ).toBe("@src/file.ts#L3-L9");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 5,
      }),
    ).toBe("@src/file.ts#L5");
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

  it("formats pasted image paths as file references", () => {
    expect(operator.formatPastedImage("/tmp/pasted.png")).toBe(
      "@/tmp/pasted.png",
    );
  });
});
