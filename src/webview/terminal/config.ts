import type { FocusIndicatorMode } from "../../types";

export interface TerminalConfig {
  fontSize: number;
  fontFamily: string;
  cursorBlink: boolean;
  cursorStyle: "block" | "underline" | "bar";
  scrollback: number;
  sendKeybindingsToShell: boolean;
  focusIndicatorMode: FocusIndicatorMode;
  focusIndicatorBorderWidth: number;
}

const FOCUS_INDICATOR_MODES: readonly FocusIndicatorMode[] = [
  "off",
  "bottomBorder",
  "fullBorder",
];

function parseFocusIndicatorMode(value: string | undefined): FocusIndicatorMode {
  return FOCUS_INDICATOR_MODES.includes(
    value as FocusIndicatorMode,
  )
    ? (value as FocusIndicatorMode)
    : "off";
}

function parseFocusIndicatorBorderWidth(value: string | undefined): number {
  const parsed = parseInt(value || "2", 10);
  if (Number.isNaN(parsed)) {
    return 2;
  }
  return Math.min(8, Math.max(1, parsed));
}

export function readTerminalConfig(element: HTMLElement): TerminalConfig {
  return {
    fontSize: parseInt(element.dataset.fontSize || "14", 10),
    fontFamily:
      element.dataset.fontFamily ||
      "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace",
    cursorBlink: element.dataset.cursorBlink !== "false",
    cursorStyle: (element.dataset.cursorStyle || "block") as
      | "block"
      | "underline"
      | "bar",
    scrollback: parseInt(element.dataset.scrollback || "10000", 10),
    sendKeybindingsToShell:
      element.dataset.sendKeybindingsToShell === "true",
    focusIndicatorMode: parseFocusIndicatorMode(
      element.dataset.focusIndicatorMode,
    ),
    focusIndicatorBorderWidth: parseFocusIndicatorBorderWidth(
      element.dataset.focusIndicatorBorderWidth,
    ),
  };
}
