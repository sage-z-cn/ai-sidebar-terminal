
import "@xterm/xterm/css/xterm.css";
import * as AiSelector from "./ai-tool-selector";
import type { HostMessage, TerminalBackendType } from "../types";
import { TerminalManager } from "./terminal-manager";
import {
  copySelectionToClipboard,
  handlePasteEventWithImageSupport,
} from "./clipboard";
import { postMessage } from "./shared/vscode-api";
import { initTerminal } from "./terminal";
import { createMessageHandler, type MessageHandlerCallbacks } from "./messages";
import {
  setupReloadButton,
  setupEditorAttachmentButton,
  setupSettingsButton,
  initPills,
  updatePillsFromActiveSession,
  updateEditorAttachmentIcon,
} from "./toolbar";

const callbacks: MessageHandlerCallbacks = {
  onActiveSession(message) {
    const toolbarControls = document.querySelector(".toolbar-controls");

    if (toolbarControls) {
      toolbarControls.classList.add("hidden");
    }

    updatePillsFromActiveSession({
      backend: "native" as TerminalBackendType,
      aiToolLabel: message.aiToolLabel,
      aiTools: message.aiTools,
    });
  },

  onShowAiToolSelector(message) {
    AiSelector.show(
      message.sessionId,
      message.sessionName,
      message.defaultTool,
      message.tools,
    );
  },

  onPlatformInfo(message) {
    void message;
  },

  onTerminalConfig(message) {
    if (message.isEditorTab !== undefined) {
      updateEditorAttachmentIcon(message.isEditorTab);
    }
  },
};

const messageHandler = createMessageHandler(callbacks);

let terminalManager: TerminalManager | null = null;

function initApp(): void {
  // Clean up previous instance if webview is reused
  if (terminalManager) {
    terminalManager.destroy();
    terminalManager = null;
  }

  const container = document.getElementById("terminal-container");
  if (!container) return;

  const instance = initTerminal(container, {
    onData: (data) => {
      postMessage({ type: "terminalInput", data });
    },
    onResize: (cols, rows) => {
      postMessage({ type: "terminalResize", cols, rows });
    },
  });

  if (instance) {
    messageHandler.terminal = instance.terminal;
    messageHandler.fitAddon = instance.fitAddon;
  }

  terminalManager = new TerminalManager();
  terminalManager.init(container);
  terminalManager.register(instance?.terminal ?? null, instance?.fitAddon ?? null, container);

  container.addEventListener(
    "paste",
    (event: ClipboardEvent) => {
      if (!handlePasteEventWithImageSupport(event)) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );

  container.addEventListener(
    "copy",
    (event: ClipboardEvent) => {
      const selection = instance?.terminal.hasSelection()
        ? instance.terminal.getSelection()
        : "";
      if (!selection) {
        return;
      }

      event.preventDefault();
      copySelectionToClipboard(selection);
    },
    { capture: true },
  );

  setupReloadButton();
  setupEditorAttachmentButton();
  setupSettingsButton();
  initPills();

  window.addEventListener("message", (event: MessageEvent) => {
    messageHandler.handleEvent(event as MessageEvent<HostMessage>);
  });

  setupAiToolSelectorEvents();
}

const aiCallbacks = {
  postMessage: (msg: unknown) => {
    const m = msg as Record<string, unknown>;
    if (m && m.action === "launchAiTool") {
      postMessage({
        type: "launchAiTool",
        sessionId: String(m.sessionId ?? ""),
        tool: String(m.tool ?? ""),
        savePreference: Boolean(m.savePreference),
      });
    }
  },
};

function setupAiToolSelectorEvents(): void {
  document.addEventListener("click", (event) => {
    const target = event
      .composedPath()
      .find((el): el is Element => el instanceof Element);
    if (!target) return;
    if (AiSelector.isVisible()) {
      AiSelector.handleClick(target, aiCallbacks);
    }
  });
}

const boot = () => {
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => initApp());
  } else {
    initApp();
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
