import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";

/**
 * FitAddon (`@xterm/addon-fit`) permanently reserves 14px for the xterm
 * scrollbar whenever `scrollback > 0`, even though this webview hides that
 * scrollbar. That leaves a dead strip on the right and shortens `cols`.
 *
 * These helpers fit to the **full** parent width instead.
 */
export function proposeFullWidthCols(
  terminal: Terminal,
  fitAddon: FitAddon,
  dims?: { cols: number; rows: number } | null,
): number | null {
  const fallback = dims ?? fitAddon.proposeDimensions();
  if (!fallback) {
    return null;
  }

  const element = terminal.element;
  const parent = element?.parentElement;
  if (!element || !parent) {
    return fallback.cols;
  }

  const core = (terminal as unknown as {
    _core?: {
      _renderService?: {
        dimensions?: { css?: { cell?: { width: number } } };
      };
    };
  })._core;
  const cellWidth = core?._renderService?.dimensions?.css?.cell?.width;
  if (typeof cellWidth !== "number" || cellWidth <= 0) {
    return fallback.cols;
  }

  const parentStyle = window.getComputedStyle(parent);
  const parentWidth =
    parseInt(parentStyle.getPropertyValue("width"), 10) || 0;

  const elementStyle = window.getComputedStyle(element);
  const padH =
    (parseInt(elementStyle.getPropertyValue("padding-left"), 10) || 0) +
    (parseInt(elementStyle.getPropertyValue("padding-right"), 10) || 0);

  return Math.max(2, Math.floor((parentWidth - padH) / cellWidth));
}

/**
 * Drop-in replacement for `fitAddon.fit()` that does not reserve the hidden
 * scrollbar gutter. Resizes at most once per call, so a steady-state fit is
 * a no-op and emits no `terminalResize` churn.
 */
export function fitFullWidth(terminal: Terminal, fitAddon: FitAddon): void {
  const dims = fitAddon.proposeDimensions();
  if (!dims) {
    return;
  }

  const cols = proposeFullWidthCols(terminal, fitAddon, dims) ?? dims.cols;
  if (cols !== terminal.cols || dims.rows !== terminal.rows) {
    const core = (terminal as unknown as {
      _core?: { _renderService?: { clear?: () => void } };
    })._core;
    core?._renderService?.clear?.();
    terminal.resize(cols, dims.rows);
  }
}
