import { describe, expect, it } from "vitest";
import { MimoCodeOperator } from "./MimoCodeOperator";
import type { AiToolConfig } from "../../../types";

describe("MimoCodeOperator", () => {
  const operator = new MimoCodeOperator();

  const createTool = (overrides: Partial<AiToolConfig> = {}): AiToolConfig => ({
    name: "mimo",
    label: "Mimo Code",
    path: "",
    args: [],
    aliases: [],
    operator: "mimo",
    ...overrides,
  });

  it("matches by id, operator, or alias (including mimo-code)", () => {
    expect(operator.matches(createTool())).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "mimo" })),
    ).toBe(true);
    expect(
      operator.matches(
        createTool({ name: "custom", operator: "custom", aliases: ["mimo"] }),
      ),
    ).toBe(true);
    // matches by the "mimo-code" alias
    expect(
      operator.matches(
        createTool({
          name: "custom",
          operator: "custom",
          aliases: ["mimo-code"],
        }),
      ),
    ).toBe(true);
    expect(
      operator.matches(createTool({ name: "custom", operator: "custom" })),
    ).toBe(false);
  });

  it("resolves launch commands from config", () => {
    expect(operator.getLaunchCommand(createTool())).toBe("mimo");
    expect(
      operator.getLaunchCommand(
        createTool({ path: "mimo", args: ["--config=startup_tool=opencode"] }),
      ),
    ).toBe("mimo --config=startup_tool=opencode");
  });

  it("reports HTTP API and auto-context as enabled", () => {
    expect(operator.supportsHttpApi()).toBe(true);
    expect(operator.supportsAutoContext()).toBe(true);
  });

  it("emits --port=N (OpenCode-derived CLI contract)", () => {
    expect(operator.buildPortArg(50000)).toBe("--port=50000");
  });

  it("formats file references with hash + L prefix line ranges", () => {
    expect(operator.formatFileReference({ path: "src/file.ts" })).toBe(
      "@src/file.ts",
    );
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 10,
      }),
    ).toBe("@src/file.ts#L10");
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 20,
      }),
    ).toBe("@src/file.ts#L10-L20");
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
