import { postMessage } from "../shared/vscode-api";
import type { TerminalBackendType } from "../../types";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { scheduleRefresh } from "../shared/utils";
import { setKeymapActiveTool } from "../keymap";

import { PillDropdown, type PillOption, closeAllPillDropdowns, registerExternalDropdownClose } from "./pill-dropdown";

/** Matches package.json `ai-sidebar-terminal.fontSize` bounds/default. */
const MIN_FONT_SIZE = 6;
const MAX_FONT_SIZE = 25;
const DEFAULT_FONT_SIZE = 12;
const FONT_SIZE_TOOLTIP_MS = 3000;

// ── Pill instances (lazy-initialised) ──

let aiToolPill: PillDropdown | null = null;

export function initPills(): {
  aiToolPill: PillDropdown;
} {
  aiToolPill = new PillDropdown({
    hostId: "pill-ai-tool",
    buttonId: "btn-pill-ai-tool",
    labelId: "pill-ai-tool-label",
    dropdownId: "dropdown-ai-tool",
    onSelect(value) {
      const sessionId = getCurrentSessionId();
      setKeymapActiveTool(value);
      postMessage({
        type: "launchAiTool",
        sessionId: sessionId ?? "",
        tool: value,
        savePreference: false,
      });
    },
  });

  return { aiToolPill };
}

export function getAiToolPill(): PillDropdown | null {
  return aiToolPill;
}

/**
 * Update AI tool pill from an activeSession message.
 */
export function updatePillsFromActiveSession(data: {
  aiToolLabel?: string;
  aiTools?: readonly { name: string; label: string }[];
  backend?: TerminalBackendType;
}): void {
  if (aiToolPill && data.aiTools) {
    const toolOptions: PillOption[] = data.aiTools.map((t) => ({
      value: t.name,
      label: t.label,
    }));
    const currentTool =
      data.aiTools.find((t) => t.label === data.aiToolLabel)?.name ??
      data.aiTools[0]?.name ??
      "";
    aiToolPill.update(toolOptions, currentTool);
    setKeymapActiveTool(currentTool || undefined);
  }
}

// ── Legacy helpers ──

let currentSessionId: string | null = null;

function getCurrentSessionId(): string | null {
  return currentSessionId;
}

export function setCurrentSessionId(id: string | null): void {
  currentSessionId = id;
}

// ── Other toolbar buttons ──

export function setupReloadButton(): void {
  document.getElementById("btn-restart")?.addEventListener("click", () => {
    postMessage({ type: "requestRestart" });
  });
}

export function applyFontSize(
  next: number,
  getTerminal: () => Terminal | null,
  getFitAddon: () => FitAddon | null,
): boolean {
  const terminal = getTerminal();
  if (!terminal) {
    return false;
  }

  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next));
  const current = terminal.options.fontSize ?? DEFAULT_FONT_SIZE;
  if (clamped === current) {
    return false;
  }

  terminal.options.fontSize = clamped;
  const fitAddon = getFitAddon();
  if (fitAddon) {
    fitAddon.fit();
  }
  scheduleRefresh(() => terminal.refresh(0, terminal.rows - 1));
  postMessage({ type: "updateFontSize", fontSize: clamped });
  showFontSizeTooltip(clamped);
  return true;
}

let fontSizeTooltipTimer: ReturnType<typeof setTimeout> | null = null;

function formatFontSizeLabel(size: number): string {
  if (size === DEFAULT_FONT_SIZE) {
    const strings =
      (window as unknown as { __TOOLBAR_L10N__?: Record<string, string> })
        .__TOOLBAR_L10N__ ?? {};
    const defaultLabel = strings.default ?? "default";
    return `${size}px (${defaultLabel})`;
  }
  return `${size}px`;
}

export function showFontSizeTooltip(size: number): void {
  const tooltip = document.getElementById("font-size-tooltip");
  if (!tooltip) {
    return;
  }

  tooltip.textContent = formatFontSizeLabel(size);
  tooltip.classList.remove("hidden");

  if (fontSizeTooltipTimer !== null) {
    clearTimeout(fontSizeTooltipTimer);
  }
  fontSizeTooltipTimer = setTimeout(() => {
    tooltip.classList.add("hidden");
    fontSizeTooltipTimer = null;
  }, FONT_SIZE_TOOLTIP_MS);
}

export function disposeFontSizeTooltip(): void {
  if (fontSizeTooltipTimer !== null) {
    clearTimeout(fontSizeTooltipTimer);
    fontSizeTooltipTimer = null;
  }
  document.getElementById("font-size-tooltip")?.classList.add("hidden");
}

export function setupFontSizeButtons(
  getTerminal: () => Terminal | null,
  getFitAddon: () => FitAddon | null,
): void {
  const applyDelta = (delta: number): void => {
    const terminal = getTerminal();
    if (!terminal) {
      return;
    }

    const current = terminal.options.fontSize ?? DEFAULT_FONT_SIZE;
    if (applyFontSize(current + delta, getTerminal, getFitAddon)) {
      return;
    }
    // Already at min/max: still surface the current size so the user
    // gets feedback that the click registered.
    showFontSizeTooltip(current);
  };

  document.getElementById("btn-font-increase")?.addEventListener("click", () => {
    applyDelta(1);
  });
  document.getElementById("btn-font-decrease")?.addEventListener("click", () => {
    applyDelta(-1);
  });
}

export function updateEditorAttachmentIcon(isEditorTab: boolean): void {
  const strings =
    (window as unknown as { __TOOLBAR_L10N__?: Record<string, string> })
      .__TOOLBAR_L10N__ ?? {};
  const icon = document.getElementById("settings-toggle-editor-icon");
  const label = document.getElementById("settings-toggle-editor-label");
  if (icon) {
    icon.textContent = isEditorTab ? "↖︎" : "↗︎";
  }
  if (label) {
    label.textContent = isEditorTab
      ? (strings.switchToSidebar ?? "Switch to sidebar")
      : (strings.switchToEditor ?? "Switch to editor");
  }
}

// ── Settings button (dropdown menu) ──

/** Delay in ms before auto-closing settings dropdown on mouse leave. */
const SETTINGS_CLOSE_DELAY_MS = 200;

export function setupSettingsButton(options?: {
  getTerminal?: () => Terminal | null;
  getFitAddon?: () => FitAddon | null;
}): void {
  const btn = document.getElementById("btn-settings");
  const dropdown = document.getElementById("dropdown-settings");
  const host = document.querySelector(".settings-host");

  if (!btn || !dropdown) return;

  let leaveTimer: ReturnType<typeof setTimeout> | null = null;

  function closeDropdown(): void {
    dropdown!.classList.add("hidden");
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function scheduleClose(): void {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => closeDropdown(), SETTINGS_CLOSE_DELAY_MS);
  }

  registerExternalDropdownClose(() => closeDropdown());

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!dropdown.classList.contains("hidden")) {
      closeDropdown();
    } else {
      closeAllPillDropdowns();
      dropdown.classList.remove("hidden");
    }
  });

  host?.addEventListener("pointerleave", () => {
    if (!dropdown.classList.contains("hidden")) scheduleClose();
  });

  host?.addEventListener("pointerenter", () => {
    if (leaveTimer !== null) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  });

  dropdown.querySelectorAll(".settings-option").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = (item as HTMLElement).dataset.action;
      if (action === "resetFontSize") {
        const getTerminal = options?.getTerminal ?? (() => null);
        const getFitAddon = options?.getFitAddon ?? (() => null);
        const terminal = getTerminal();
        if (terminal && (terminal.options.fontSize ?? DEFAULT_FONT_SIZE) !== DEFAULT_FONT_SIZE) {
          applyFontSize(DEFAULT_FONT_SIZE, getTerminal, getFitAddon);
        } else {
          postMessage({ type: "updateFontSize", fontSize: DEFAULT_FONT_SIZE });
          showFontSizeTooltip(DEFAULT_FONT_SIZE);
        }
      } else if (action === "toggleEditor") {
        postMessage({ type: "toggleEditorAttachment" });
      } else if (action === "keyboardShortcuts") {
        postMessage({ type: "openKeyboardShortcuts" });
      } else {
        postMessage({ type: "openSettings" });
      }
      closeDropdown();
    });
  });
}
