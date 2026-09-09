export interface TerminalContainerParams {
  fontSize: string;
  fontFamily: string;
  cursorBlink: string;
  cursorStyle: string;
  scrollback: string;
  sendKeybindingsToShell?: string;
  focusIndicatorMode?: string;
  focusIndicatorBorderWidth?: string;
}

export function renderTerminalContainer({
  fontSize,
  fontFamily,
  cursorBlink,
  cursorStyle,
  scrollback,
  sendKeybindingsToShell = "false",
  focusIndicatorMode = "off",
  focusIndicatorBorderWidth = "2",
}: TerminalContainerParams): string {
  return `<div
      id="terminal-container"
      data-font-size="${fontSize}"
      data-font-family="${fontFamily}"
      data-cursor-blink="${cursorBlink}"
      data-cursor-style="${cursorStyle}"
      data-scrollback="${scrollback}"
      data-send-keybindings-to-shell="${sendKeybindingsToShell}"
      data-focus-indicator-mode="${focusIndicatorMode}"
      data-focus-indicator-border-width="${focusIndicatorBorderWidth}"
    ></div>`;
}
