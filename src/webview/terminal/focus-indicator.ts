import type { FocusIndicatorMode } from "../../types";

export interface FocusIndicator {
  update(mode: FocusIndicatorMode, width: number): void;
  dispose(): void;
}

const INDICATOR_CLASSES: readonly string[] = [
  "focus-indicator-bottom",
  "focus-indicator-full",
];

function modeClassName(mode: FocusIndicatorMode): string | null {
  switch (mode) {
    case "bottomBorder":
      return "focus-indicator-bottom";
    case "fullBorder":
      return "focus-indicator-full";
    default:
      return null;
  }
}

/**
 * Tracks webview focus and reflects it on a fixed overlay element appended
 * to `document.body`. The overlay carries the `focused` class plus a mode
 * class (`focus-indicator-bottom` or `focus-indicator-full`). Styling lives
 * in terminal.css: the overlay is `pointer-events: none`, stacked above all
 * content (so opaque children like the toolbar or terminal canvas cannot
 * cover the highlight) and uses inset box-shadow so no layout change can
 * trigger an xterm refit.
 */
export function createFocusIndicator(): FocusIndicator {
  let listenersAttached = false;

  const overlay = document.createElement("div");
  overlay.className = "focus-indicator-overlay";
  document.body.appendChild(overlay);

  const handleFocus = (): void => {
    overlay.classList.add("focused");
  };

  const handleBlur = (): void => {
    overlay.classList.remove("focused");
  };

  // Covers webview hidden -> restored and load-while-focused cases
  // where the browser may not re-fire a plain focus event.
  const syncFromDocument = (): void => {
    overlay.classList.toggle("focused", document.hasFocus());
  };

  const attachListeners = (): void => {
    if (listenersAttached) {
      return;
    }
    listenersAttached = true;
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", syncFromDocument);
    window.addEventListener("pageshow", syncFromDocument);
  };

  const detachListeners = (): void => {
    if (!listenersAttached) {
      return;
    }
    listenersAttached = false;
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("blur", handleBlur);
    document.removeEventListener("visibilitychange", syncFromDocument);
    window.removeEventListener("pageshow", syncFromDocument);
  };

  const clearIndicator = (): void => {
    overlay.classList.remove("focused", ...INDICATOR_CLASSES);
    overlay.style.removeProperty("--focus-indicator-width");
  };

  return {
    update(mode, width) {
      overlay.classList.remove(...INDICATOR_CLASSES);

      const modeClass = modeClassName(mode);
      if (!modeClass) {
        detachListeners();
        overlay.classList.remove("focused");
        overlay.style.removeProperty("--focus-indicator-width");
        return;
      }

      overlay.classList.add(modeClass);
      overlay.style.setProperty("--focus-indicator-width", `${width}px`);
      attachListeners();
      syncFromDocument();
    },

    dispose() {
      detachListeners();
      clearIndicator();
      overlay.remove();
    },
  };
}
