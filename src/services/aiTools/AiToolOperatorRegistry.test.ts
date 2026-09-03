import { describe, expect, it } from "vitest";
import { AiToolOperatorRegistry } from "./AiToolOperatorRegistry";
import { DEFAULT_AI_TOOLS } from "../../types";
import { OpenCodeToolOperator } from "./operators/OpenCodeToolOperator";
import { ClaudeCodeToolOperator } from "./operators/ClaudeCodeToolOperator";
import { CodexToolOperator } from "./operators/CodexToolOperator";
import { MimoCodeOperator } from "./operators/MimoCodeOperator";

describe("AiToolOperatorRegistry", () => {
  it("resolves aliased tools by name", () => {
    const registry = new AiToolOperatorRegistry();

    const resolved = registry.resolveTool(DEFAULT_AI_TOOLS, "claude");

    expect(resolved?.name).toBe("claude");
  });

  it("formats file references through the matching operator", () => {
    const registry = new AiToolOperatorRegistry();
    const tool = registry.resolveTool(DEFAULT_AI_TOOLS, "opencode");

    expect(tool).toBeDefined();

    const operator = registry.getForConfig(tool!);
    expect(
      operator.formatFileReference({
        path: "src/file.ts",
        selectionStart: 10,
        selectionEnd: 12,
      }),
    ).toBe("@src/file.ts#10-12");
  });

  it("uses operator aliases when matching a config", () => {
    const registry = new AiToolOperatorRegistry();
    const tool = {
      name: "claude",
      label: "Claude Code",
      path: "",
      args: [],
      aliases: ["claude"],
      operator: "claude",
    };

    expect(registry.getForConfig(tool).id).toBe("claude");
    expect(registry.matchesName(tool, "claude")).toBe(true);
    expect(registry.matchesName(tool, "claude")).toBe(true);
    expect(registry.matchesName(tool, "missing")).toBe(false);
  });

  it("returns operators by id or alias", () => {
    const registry = new AiToolOperatorRegistry();

    expect(registry.getByToolName("opencode")).toBeInstanceOf(
      OpenCodeToolOperator,
    );
    expect(registry.getByToolName("claude")).toBeInstanceOf(
      ClaudeCodeToolOperator,
    );
    expect(registry.getByToolName("codex")).toBeInstanceOf(CodexToolOperator);
    expect(registry.getByToolName("mimo")).toBeInstanceOf(MimoCodeOperator);
    expect(registry.getByToolName("mimo-code")).toBeInstanceOf(MimoCodeOperator);
    expect(registry.getByToolName("missing")).toBeUndefined();
  });

  it("falls back to codex when no operator matches a config", () => {
    const registry = new AiToolOperatorRegistry();

    const tool = {
      name: "custom-tool",
      label: "Custom Tool",
      path: "",
      args: [],
      aliases: ["custom-alias"],
      operator: "custom-operator",
    };

    expect(registry.getForConfig(tool)).toBeInstanceOf(CodexToolOperator);
  });

  it("returns the first default tool when no preference is provided (defaults are the base)", () => {
    const registry = new AiToolOperatorRegistry();

    expect(registry.resolveTool([], undefined)?.name).toBe("opencode");
    expect(registry.resolveTool([{}], undefined)?.name).toBe("opencode");

    // User custom tool is appended after defaults; first tool is still opencode
    const result = registry.resolveTool(
      [
        {
          name: "custom",
          label: "Custom",
          path: "/opt/custom",
          args: ["--run"],
          aliases: ["custom-cli"],
          operator: "codex",
        },
      ],
      undefined,
    );
    expect(result?.name).toBe("opencode");

    // Custom tool can be resolved explicitly by name
    const custom = registry.resolveTool(
      [
        {
          name: "custom",
          label: "Custom",
          path: "/opt/custom",
          args: ["--run"],
          aliases: ["custom-cli"],
          operator: "codex",
        },
      ],
      "custom",
    );
    expect(custom).toMatchObject({
      name: "custom",
      path: "/opt/custom",
      args: ["--run"],
      aliases: ["custom-cli"],
      operator: "codex",
    });
  });

  it("resolves the preferred tool by name, operator, or alias", () => {
    const registry = new AiToolOperatorRegistry();
    const userTools = [
      {
        name: "custom-opencode",
        label: "Custom OpenCode",
        path: "/opt/opencode",
        args: ["-c"],
        aliases: ["open-code"],
        operator: "opencode",
      },
      {
        name: "assistant",
        label: "Assistant",
        path: "/opt/assistant",
        args: [],
        aliases: ["claude"],
        operator: "claude",
      },
    ];

    expect(registry.resolveTool(userTools, "custom-opencode")?.label).toBe(
      "Custom OpenCode",
    );
    // "claude" matches the default claude entry (merged from DEFAULT_AI_TOOLS)
    // because merge strategy puts defaults first; user "assistant" is a separate tool
    expect(registry.resolveTool(userTools, "claude")?.name).toBe("claude");
    // User can resolve their custom tool by name
    expect(registry.resolveTool(userTools, "assistant")?.name).toBe(
      "assistant",
    );
    expect(registry.resolveTool(userTools, "missing")).toBeUndefined();
  });

  it("resolves mimo and mimo-code alias", () => {
    const registry = new AiToolOperatorRegistry();

    const resolved = registry.resolveTool(DEFAULT_AI_TOOLS, "mimo");
    expect(resolved?.name).toBe("mimo");
    expect(resolved?.label).toBe("Mimo Code");

    const resolvedByAlias = registry.resolveTool(DEFAULT_AI_TOOLS, "mimo-code");
    expect(resolvedByAlias?.name).toBe("mimo");
  });

  it("matches tool names when aliases are omitted", () => {
    const registry = new AiToolOperatorRegistry();
    const tool = {
      name: "plain",
      label: "Plain",
      path: "",
      args: [],
      operator: undefined,
    };

    expect(registry.matchesName(tool, "plain")).toBe(true);
    expect(registry.matchesName(tool, "missing")).toBe(false);
  });
});
