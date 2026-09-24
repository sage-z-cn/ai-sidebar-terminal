import { describe, it, expect } from "vitest";
import type {
  HostMessage,
  TerminalBackendType,
  WebviewMessage,
} from "./types";
import {
  DEFAULT_AI_TOOLS,
  detectAiToolName,
  getToolDetectionPatterns,
  getToolLaunchCommand,
  resolveAiToolConfigs,
} from "./types";

describe("Types", () => {
  describe("WebviewMessage", () => {
    it("should accept all variants", () => {
      const messages: WebviewMessage[] = [
        { type: "terminalInput", data: "test input" },
        { type: "terminalResize", cols: 80, rows: 24 },
        { type: "listTerminals" },
        {
          type: "openFile",
          path: "/test/file.ts",
          line: 10,
        },
        {
          type: "openUrl",
          url: "https://example.com",
        },
        { type: "ready", cols: 80, rows: 24 },
        {
          type: "filesDropped",
          files: ["/file1.ts", "/file2.ts"],
          shiftKey: true,
        },
        { type: "setClipboard", text: "clipboard text" },
        { type: "triggerPaste" },
        { type: "imagePasted", data: "data:image/png;base64,AA==" },
        {
          type: "launchAiTool",
          sessionId: "workspace-a",
          tool: "opencode",
          savePreference: true,
        },
        { type: "requestAiToolSelector" },
        { type: "requestRestart" },
        { type: "openSettings" },
        { type: "openKeyboardShortcuts" },
      ];

      expect(messages).toHaveLength(15);
      expect(messages[14]?.type).toBe("openKeyboardShortcuts");
    });

    it("should accept terminalInput message", () => {
      const message: WebviewMessage = {
        type: "terminalInput",
        data: "test input",
      };

      expect(message.type).toBe("terminalInput");
      expect(message.data).toBe("test input");
    });

    it("should accept terminalResize message", () => {
      const message: WebviewMessage = {
        type: "terminalResize",
        cols: 80,
        rows: 24,
      };

      expect(message.type).toBe("terminalResize");
      expect(message.cols).toBe(80);
      expect(message.rows).toBe(24);
    });

    it("should accept openFile message with line", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
    });

    it("should accept openFile message with line and column", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
        column: 5,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
      expect(message.column).toBe(5);
    });

    it("accepts openFile message with path line column and endLine", () => {
      const message: WebviewMessage = {
        type: "openFile",
        path: "/test/file.ts",
        line: 10,
        column: 5,
        endLine: 12,
      };

      expect(message.type).toBe("openFile");
      expect(message.path).toBe("/test/file.ts");
      expect(message.line).toBe(10);
      expect(message.column).toBe(5);
      expect(message.endLine).toBe(12);
    });

    it("should accept openUrl message", () => {
      const message: WebviewMessage = {
        type: "openUrl",
        url: "https://example.com",
      };

      expect(message.type).toBe("openUrl");
      expect(message.url).toBe("https://example.com");
    });

    it("should accept ready message", () => {
      const message: WebviewMessage = {
        type: "ready",
        cols: 80,
        rows: 24,
      };

      expect(message.type).toBe("ready");
      expect(message.cols).toBe(80);
      expect(message.rows).toBe(24);
    });

    it("should accept filesDropped message", () => {
      const message: WebviewMessage = {
        type: "filesDropped",
        files: ["/file1.ts", "/file2.ts"],
        shiftKey: true,
      };

      expect(message.type).toBe("filesDropped");
      expect(message.files).toEqual(["/file1.ts", "/file2.ts"]);
      expect(message.shiftKey).toBe(true);
    });

    it("should accept filesDropped blob fallback message", () => {
      const message: WebviewMessage = {
        type: "filesDropped",
        files: [],
        shiftKey: false,
        blobFiles: [
          {
            name: "note.txt",
            data: "data:text/plain;base64,SGVsbG8=",
          },
        ],
      };

      expect(message.type).toBe("filesDropped");
      expect(message.files).toEqual([]);
      expect(message.blobFiles).toEqual([
        {
          name: "note.txt",
          data: "data:text/plain;base64,SGVsbG8=",
        },
      ]);
    });
  });

  describe("HostMessage", () => {
    it("should accept terminalOutput message", () => {
      const message: HostMessage = {
        type: "terminalOutput",
        data: "output data",
      };

      expect(message.type).toBe("terminalOutput");
      expect(message.data).toBe("output data");
    });

    it("should accept terminalExited message", () => {
      const message: HostMessage = {
        type: "terminalExited",
      };

      expect(message.type).toBe("terminalExited");
    });

    it("should accept focusTerminal message", () => {
      const message: HostMessage = {
        type: "focusTerminal",
      };

      expect(message.type).toBe("focusTerminal");
    });

    it("should accept webviewVisible message", () => {
      const message: HostMessage = {
        type: "webviewVisible",
      };

      expect(message.type).toBe("webviewVisible");
    });

    it("should accept clearTerminal message", () => {
      const message: HostMessage = {
        type: "clearTerminal",
      };

      expect(message.type).toBe("clearTerminal");
    });
  });

  describe("AI tool helpers", () => {
    it("returns defaults when user config is empty", () => {
      expect(resolveAiToolConfigs([])).toEqual([...DEFAULT_AI_TOOLS]);
      expect(resolveAiToolConfigs(null as unknown as [])).toEqual([
        ...DEFAULT_AI_TOOLS,
      ]);
    });

    it("merges user tools with defaults — user overrides matching defaults, new defaults auto-append", () => {
      const userTools = [
        {
          name: "opencode",
          label: "My OpenCode",
          path: "/custom/opencode",
          args: ["--debug"],
        },
      ];

      const result = resolveAiToolConfigs(userTools);

      const opencode = result.find((t) => t.name === "opencode");
      expect(opencode?.label).toBe("My OpenCode");
      expect(opencode?.path).toBe("/custom/opencode");
      expect(opencode?.args).toEqual(["--debug"]);
      expect(opencode?.operator).toBe("opencode");

      expect(result.find((t) => t.name === "claude")).toBeDefined();
      expect(result.find((t) => t.name === "codex")).toBeDefined();
      expect(result.find((t) => t.name === "mimo")).toBeDefined();
    });

    it("appends fully custom user tools not in defaults", () => {
      const result = resolveAiToolConfigs([
        { name: "custom-tool", label: "Custom" },
      ]);

      expect(result.find((t) => t.name === "opencode")).toBeDefined();

      const custom = result.find((t) => t.name === "custom-tool");
      expect(custom?.label).toBe("Custom");
    });

    it("filters out explicitly disabled tools", () => {
      const result = resolveAiToolConfigs([
        { name: "codex", label: "Codex", enabled: false },
        { name: "custom", label: "Custom", enabled: false },
      ]);

      expect(result.find((t) => t.name === "codex")).toBeUndefined();
      expect(result.find((t) => t.name === "custom")).toBeUndefined();
      expect(result.find((t) => t.name === "opencode")).toBeDefined();
    });

    it("preserves defaults for missing fields when user overrides", () => {
      const result = resolveAiToolConfigs([
        { name: "opencode", label: "OpenCode Override" },
      ]);

      const opencode = result.find((t) => t.name === "opencode");
      expect(opencode?.args).toEqual(["-c"]);
      expect(opencode?.operator).toBe("opencode");
    });

    it("honors explicitly empty args over default args", () => {
      const result = resolveAiToolConfigs([
        { name: "opencode", label: "OpenCode", args: [] },
      ]);

      const opencode = result.find((t) => t.name === "opencode");
      expect(opencode?.args).toEqual([]);
    });

    it("falls back to default args when args is not an array", () => {
      const result = resolveAiToolConfigs([
        { name: "opencode", label: "OpenCode", args: "--bad" },
      ]);

      const opencode = result.find((t) => t.name === "opencode");
      expect(opencode?.args).toEqual(["-c"]);
    });

    it("normalizes invalid entries gracefully", () => {
      const result = resolveAiToolConfigs([
        null,
        { name: "missing-label" },
        {
          name: "custom",
          label: "Custom Tool",
          path: 42,
          args: ["run", 5],
          aliases: "custom-alias",
          operator: false,
        },
      ]);

      const custom = result.find((t) => t.name === "custom");
      expect(custom).toEqual({
        name: "custom",
        label: "Custom Tool",
        path: "",
        args: ["run", "5"],
        aliases: undefined,
        operator: undefined,
        enabled: undefined,
      });

      expect(result.find((t) => t.name === "opencode")).toBeDefined();
    });

    it("normalizes non-array args on custom tools to empty", () => {
      const result = resolveAiToolConfigs([
        { name: "no-args-array", label: "No Args Array", args: "--bad" },
      ]);

      const tool = result.find((t) => t.name === "no-args-array");
      expect(tool?.args).toEqual([]);
    });

    it("builds launch commands and detection patterns from optional config fields", () => {
      const tool = {
        name: "assistant",
        label: "Assistant CLI",
        path: "C:\\Tools\\assistant.exe",
        args: ["--print", "hello"],
        aliases: ["helper"],
        operator: "codex",
      };

      expect(getToolLaunchCommand(tool)).toBe(
        "C:\\Tools\\assistant.exe --print hello",
      );
      expect(getToolDetectionPatterns(tool)).toEqual(
        expect.arrayContaining([
          "assistant",
          "assistant.exe",
          "codex",
          "codex.exe",
          "helper",
          "helper.exe",
          "Assistant CLI",
        ]),
      );
    });

    it("adds non-matching basenames and skips empty detection text", () => {
      const tool = {
        name: "assistant",
        label: "Assistant CLI",
        path: "/opt/bin/custom-assistant",
        args: [],
        aliases: undefined,
        operator: undefined,
      };

      expect(getToolDetectionPatterns(tool)).toContain("custom-assistant");
      expect(detectAiToolName(undefined, [tool])).toBeUndefined();
      expect(detectAiToolName("run CUSTOM-ASSISTANT now", [tool])).toBe(
        "assistant",
      );
    });
  });
});
