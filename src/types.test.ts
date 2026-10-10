import { describe, it, expect } from "vitest";
import type {
  HostMessage,
  TerminalBackendType,
  WebviewMessage,
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
        { type: "requestRestart" },
        { type: "openSettings" },
        { type: "openKeyboardShortcuts" },
        { type: "openOpenCodeGlobalFile", target: "agentsMd" },
        { type: "openOpenCodeGlobalFile", target: "opencodeJson" },
        { type: "openOpenCodeGlobalFile", target: "cliJson" },
      ];

      expect(messages).toHaveLength(16);
      expect(messages[12]?.type).toBe("openKeyboardShortcuts");
      expect(messages[13]).toEqual({
        type: "openOpenCodeGlobalFile",
        target: "agentsMd",
      });
      expect(messages[14]).toEqual({
        type: "openOpenCodeGlobalFile",
        target: "opencodeJson",
      });
      expect(messages[15]).toEqual({
        type: "openOpenCodeGlobalFile",
        target: "cliJson",
      });
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

    it("should accept openCodeSessionStarted message", () => {
      const message: HostMessage = {
        type: "openCodeSessionStarted",
      };

      expect(message.type).toBe("openCodeSessionStarted");
    });
  });
});
