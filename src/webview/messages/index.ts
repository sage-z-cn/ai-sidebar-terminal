import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { HostMessage, type FocusIndicatorMode } from "../../types";
import { handlePasteWithImageSupport } from "../clipboard";
import { postMessage } from "../shared/vscode-api";
import { scheduleRefresh } from "../shared/utils";

export interface MessageHandlerCallbacks {
  onActiveSession: (
    message: Extract<HostMessage, { type: "activeSession" }>,
  ) => void;
  onShowAiToolSelector: (
    message: Extract<HostMessage, { type: "showAiToolSelector" }>,
  ) => void;
  onPlatformInfo?: (
    message: Extract<HostMessage, { type: "platformInfo" }>,
  ) => void;
  onTerminalConfig?: (
    message: Extract<HostMessage, { type: "terminalConfig" }>,
  ) => void;
  onFocusIndicatorConfig?: (mode: FocusIndicatorMode, width: number) => void;
}

export interface MessageHandler {
  terminal: Terminal | null;
  fitAddon: FitAddon | null;
  handleEvent: (event: MessageEvent<HostMessage>) => void;
}

function postTerminalResize(terminal: Terminal): void {
  postMessage({
    type: "terminalResize",
    cols: terminal.cols,
    rows: terminal.rows,
  });
}

export function createMessageHandler(
  callbacks: MessageHandlerCallbacks,
): MessageHandler {
  const state: MessageHandler = {
    terminal: null,
    fitAddon: null,
    handleEvent(event: MessageEvent<HostMessage>) {
      const message = event.data;
      const { terminal, fitAddon } = state;

      switch (message.type) {
        case "terminalOutput":
          if (terminal) {
            terminal.write(message.data);
          }
          break;

        case "terminalExited":
          if (terminal) {
            terminal.write("\r\n\x1b[31mOpenCode exited\x1b[0m\r\n");
          }
          break;

        case "clearTerminal":
          if (terminal) {
            terminal.clear();
            terminal.reset();
            if (fitAddon) {
              fitAddon.fit();
              postTerminalResize(terminal);
            }
          }
          break;

        case "focusTerminal":
          if (terminal) {
            terminal.focus();
          }
          break;

        case "webviewVisible":
          setTimeout(() => {
            if (terminal && fitAddon) {
              fitAddon.fit();
              scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
              postTerminalResize(terminal);
            }
          }, 50);
          break;

        case "platformInfo":
          callbacks.onPlatformInfo?.(message);
          break;

        case "terminalConfig": {
          // Only touch xterm when a terminal-affecting field actually
          // changed. Focus-indicator-only updates must skip the refit:
          // fitting a hidden webview would shrink the PTY to minimum
          // dimensions until the next visible fit.
          if (terminal) {
            const options = terminal.options;
            const needsTerminalUpdate =
              options.fontSize !== message.fontSize ||
              options.fontFamily !== message.fontFamily ||
              options.cursorBlink !== message.cursorBlink ||
              options.cursorStyle !== message.cursorStyle;
            if (needsTerminalUpdate) {
              options.fontSize = message.fontSize;
              options.fontFamily = message.fontFamily;
              options.cursorBlink = message.cursorBlink;
              options.cursorStyle = message.cursorStyle;
              if (fitAddon) {
                fitAddon.fit();
              }
              scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
            }
          }
          callbacks.onTerminalConfig?.(message);
          callbacks.onFocusIndicatorConfig?.(
            message.focusIndicatorMode ?? "off",
            message.focusIndicatorBorderWidth ?? 2,
          );
          break;
        }

        case "requestPaste":
          void handlePasteWithImageSupport();
          break;

        case "clipboardContent":
          if (message.text && terminal) {
            terminal.paste(message.text);
          }
          break;

        case "activeSession":
          callbacks.onActiveSession(message);
          break;

        case "showAiToolSelector":
          callbacks.onShowAiToolSelector(message);
          break;
      }
    },
  };

  return state;
}
