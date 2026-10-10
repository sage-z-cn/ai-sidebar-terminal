// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
  acquireVsCodeApi: vi.fn(() => ({ postMessage: vi.fn() })),
}));

import { postMessage } from "../shared/vscode-api";
import {
  applyOpenCodeUpdateStatus,
  initOpenCodeUpdateUi,
  isInstallPromptVisible,
} from "./index";

/**
 * The module keeps singleton state (initialized flag + merged status), so
 * the DOM is built once and each test starts from a cleared status. Empty
 * strings overwrite stale merged fields the way host hide-pushes do.
 */
function resetStatus(): void {
  applyOpenCodeUpdateStatus({
    state: "idle",
    step: "",
    installedVersion: "",
    latestVersion: "",
    currentVersion: "",
    detail: "",
    manualCommands: [],
    remediationCommands: [],
    history: [],
    installPromptPending: false,
    sessionAutoStarted: false,
  });
}

function pill(): HTMLButtonElement {
  return document.getElementById("btn-oc-version") as HTMLButtonElement;
}

function card(): HTMLElement {
  return document.getElementById("ocu-card") as HTMLElement;
}

function popover(): HTMLElement {
  return document.getElementById("ocu-popover") as HTMLElement;
}

function installDialog(): HTMLElement {
  return document.getElementById("ocu-install-prompt") as HTMLElement;
}

describe("OpenCode update UI (webview)", () => {
  // vitest resets mocks before each test, so init-time posts are captured
  // right after initialization.
  let initPosts: unknown[][] = [];

  beforeAll(() => {
    document.body.innerHTML = `
      <button type="button" id="btn-oc-version" class="pill-version hidden">
        <span id="ocu-version-text"></span>
      </button>
      <div id="menu-oc-update-check" class="hidden"></div>
      <div id="terminal-container"></div>`;
    initOpenCodeUpdateUi();
    initPosts = vi.mocked(postMessage).mock.calls.slice();
  });

  it("requests the status snapshot on init", () => {
    expect(initPosts).toContainEqual([
      { type: "requestOpenCodeUpdateStatus" },
    ]);
  });

  it("shows the entry pill when available and hides it on a cleared idle push", () => {
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      currentVersion: "2.0.6",
      latestVersion: "2.0.7",
    });

    expect(pill().classList.contains("hidden")).toBe(false);
    expect(pill().classList.contains("is-entry")).toBe(true);

    resetStatus();

    // Empty-string version fields must clear the merged pill state.
    expect(pill().classList.contains("hidden")).toBe(true);
    expect(pill().disabled).toBe(true);
  });

  it("re-checks from the failed pill instead of opening the popover", () => {
    vi.mocked(postMessage).mockClear();
    applyOpenCodeUpdateStatus({
      state: "failed",
      step: "",
      detail: "upgrade command failed",
      targetVersion: "2.0.7",
    });

    expect(pill().getAttribute("title")).toBe(
      "Last install failed. Click to check again",
    );

    pill().click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "checkOpenCodeUpdates",
    });
    // The local checking card replaced the failure card.
    expect(card().textContent).toContain("Checking for updates");
  });

  it("checks for updates from the version pill in the idle state", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "idle",
      step: "",
      installedVersion: "2.0.7",
    });

    expect(pill().classList.contains("hidden")).toBe(false);
    expect(pill().disabled).toBe(false);
    expect(pill().getAttribute("title")).toBe(
      "Click to check for updates",
    );
    expect(pill().getAttribute("aria-label")).toBe(
      "Click to check for updates",
    );

    pill().click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "checkOpenCodeUpdates",
    });
    expect(card().textContent).toContain("Checking for updates");
  });

  it("does not re-post the manual check while the checking card is showing", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "idle",
      step: "",
      installedVersion: "2.0.7",
    });

    pill().click();
    pill().click();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith({
      type: "checkOpenCodeUpdates",
    });
  });

  it("dismisses the success card before re-checking from the pill", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "success",
      step: "",
      installedVersion: "2.0.8",
    });

    expect(card().classList.contains("hidden")).toBe(false);

    pill().click();

    const types = vi.mocked(postMessage).mock.calls.map(
      (call) => call[0].type,
    );
    expect(types).toEqual(["dismissOpenCodeUpdate", "checkOpenCodeUpdates"]);
    expect(card().textContent).toContain("Checking for updates");
  });

  it("renders a generic failure title when no version was verified", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "failed",
      step: "",
      detail: "upgrade command failed: timeout",
    });

    expect(card().textContent).toContain("upgrade command failed: timeout");
    expect(card().getAttribute("role")).toBe("alert");
    expect(card().textContent).not.toContain("version is still");
  });

  it("renders manual commands without a remediate action", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "failed",
      step: "",
      detail: "nvm trust failed",
      manualCommands: [
        "nvm firewall trust module opencode",
        "nvm reshim",
      ],
    });

    expect(card().textContent).toContain(
      "nvm firewall trust module opencode",
    );
    expect(card().querySelector('[data-ocu-act="remediate"]')).toBeNull();
  });

  it("shows the remediate step and abandon action inside the progress card", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "updating",
      step: "remediate-trust",
    });

    expect(card().textContent).toContain("Apply nvm trust setting");
    expect(card().querySelector('[data-ocu-act="abandon"]')).not.toBeNull();
  });

  it("restores the failure card after a transient hint expires", () => {
    vi.useFakeTimers();
    try {
      resetStatus();
      applyOpenCodeUpdateStatus({
        state: "failed",
        step: "",
        detail: "upgrade command failed",
        notice:
          "Could not check for updates. Check your network connection and try again.",
      });

      expect(card().classList.contains("hidden")).toBe(false);
      expect(card().textContent).toContain("Could not check for updates");

      vi.advanceTimersByTime(4500);

      expect(card().classList.contains("hidden")).toBe(false);
      expect(card().textContent).toContain("upgrade command failed");
      expect(card().getAttribute("role")).toBe("alert");
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides the hint card after expiry when back to idle", () => {
    vi.useFakeTimers();
    try {
      resetStatus();
      applyOpenCodeUpdateStatus({
        state: "idle",
        step: "",
        notice: "Install abandoned",
      });

      expect(card().classList.contains("hidden")).toBe(false);
      expect(card().textContent).toContain("Install abandoned");

      vi.advanceTimersByTime(4500);

      expect(card().classList.contains("hidden")).toBe(true);
      expect(card().textContent).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses via X on the success card like Esc", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "success",
      step: "",
      installedVersion: "2.0.7",
    });

    card().querySelector<HTMLButtonElement>('[data-ocu-act="x"]')?.click();

    expect(postMessage).toHaveBeenCalledWith({ type: "dismissOpenCodeUpdate" });
    expect(card().classList.contains("hidden")).toBe(true);
  });

  it("opens the popover on a manual-check available push and refreshes rows on the enrichment re-push", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      installedVersion: "2.0.9",
      latestVersion: "2.1.0",
      targetVersion: "2.1.0",
      openMethodPicker: true,
    });

    expect(popover().classList.contains("hidden")).toBe(false);
    expect(popover().querySelector("#ocu-popover-title")?.textContent).toBe(
      "Install OpenCode CLI",
    );

    // Enrichment re-push without the flag: refresh in place, no toggle-close.
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      methods: ["npm", "bun"],
    });

    expect(popover().classList.contains("hidden")).toBe(false);
    const rows = Array.from(
      popover().querySelectorAll<HTMLElement>(".ocu-pop-row"),
    );
    expect(rows.map((row) => row.dataset.ocuMethod)).toEqual(["npm", "bun"]);

    resetStatus();
  });

  it("keeps the popover hidden for an automatic available push", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      currentVersion: "2.0.6",
      latestVersion: "2.0.7",
    });

    expect(popover().classList.contains("hidden")).toBe(true);

    resetStatus();
  });

  it("shows the install pill and opens the install popover when installable", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      methods: ["npm", "pnpm", "brew", "scoop", "choco", "curl"],
      defaultMethod: "npm",
    });

    const pillEl = pill();
    expect(pillEl.classList.contains("hidden")).toBe(false);
    expect(pillEl.classList.contains("is-entry")).toBe(true);
    expect(document.getElementById("ocu-version-text")?.textContent).toBe(
      "Install",
    );
    expect(pillEl.getAttribute("title")).toBe(
      "OpenCode CLI is not installed. Click to choose an install method.",
    );
    expect(pillEl.getAttribute("aria-label")).toBe(
      "OpenCode CLI is not installed. Click to choose an install method.",
    );
    // No card in the installable state: the pill is the entry.
    expect(card().classList.contains("hidden")).toBe(true);

    pillEl.click();

    expect(popover().classList.contains("hidden")).toBe(false);
    expect(popover().querySelector("#ocu-popover-title")?.textContent).toBe(
      "Install OpenCode CLI",
    );
    const rows = Array.from(
      popover().querySelectorAll<HTMLElement>(".ocu-pop-row"),
    );
    expect(rows.map((row) => row.dataset.ocuMethod)).toEqual([
      "npm",
      "pnpm",
      "brew",
      "scoop",
      "choco",
      "curl",
    ]);

    rows[0].click();

    expect(postMessage).toHaveBeenCalledWith({
      type: "startOpenCodeUpdate",
      method: "npm",
    });
    expect(popover().classList.contains("hidden")).toBe(true);

    resetStatus();
  });

  it("drops the detected mark when entering the installable state", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      latestVersion: "2.1.0",
      detectedMethod: "npm",
      openMethodPicker: true,
    });
    expect(
      popover().querySelector(".ocu-tag-det"),
    ).not.toBeNull();

    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      methods: ["npm", "curl"],
      defaultMethod: "npm",
      // The host clears the detected mark explicitly; the webview merge
      // keeps stale values for absent keys.
      detectedMethod: undefined,
    });

    expect(popover().classList.contains("hidden")).toBe(false);
    expect(popover().querySelector(".ocu-tag-det")).toBeNull();
    expect(popover().querySelector("#ocu-popover-title")?.textContent).toBe(
      "Install OpenCode CLI",
    );

    resetStatus();
  });

  // ── Missing-CLI install confirmation dialog ──

  /** Arms the pending edge, then pushes installable + pending. */
  function pushPendingInstallable(): void {
    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      methods: ["npm"],
      defaultMethod: "npm",
      installPromptPending: false,
    });
    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      installPromptPending: true,
    });
  }

  it("shows the install confirmation once for a pending installable push", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();

    pushPendingInstallable();

    const dialog = installDialog();
    expect(dialog.classList.contains("hidden")).toBe(false);
    expect(
      dialog.querySelector(".ocu-ip-dialog")?.getAttribute("role"),
    ).toBe("alertdialog");
    expect(dialog.textContent).toContain("Install OpenCode CLI");
    expect(dialog.textContent).toContain(
      "OpenCode CLI was not found on this machine. Install it now?",
    );
    expect(document.activeElement).toBe(
      dialog.querySelector('[data-ocu-ip="install"]'),
    );

    // A status re-push with the flag still set never re-pops or rebuilds.
    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      installPromptPending: true,
    });
    expect(installDialog()).toBe(dialog);
    expect(dialog.classList.contains("hidden")).toBe(false);

    dialog
      .querySelector<HTMLButtonElement>('[data-ocu-ip="notNow"]')
      ?.click();

    expect(dialog.classList.contains("hidden")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "answerCliInstallPrompt",
      action: "notNow",
    });

    resetStatus();
  });

  it("does not show the confirmation without the pending flag or from the pill", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();

    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      methods: ["npm"],
      defaultMethod: "npm",
      installPromptPending: false,
    });

    expect(installDialog().classList.contains("hidden")).toBe(true);

    // A direct pill click opens the popover, never the confirmation.
    pill().click();

    expect(popover().classList.contains("hidden")).toBe(false);
    expect(installDialog().classList.contains("hidden")).toBe(true);

    resetStatus();
  });

  it("opens the method popover and answers install on the primary button", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();

    pushPendingInstallable();

    installDialog()
      .querySelector<HTMLButtonElement>('[data-ocu-ip="install"]')
      ?.click();

    expect(installDialog().classList.contains("hidden")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "answerCliInstallPrompt",
      action: "install",
    });
    expect(popover().classList.contains("hidden")).toBe(false);
    expect(popover().querySelector("#ocu-popover-title")?.textContent).toBe(
      "Install OpenCode CLI",
    );

    resetStatus();
  });

  it("answers dontAskAgain from the third button", () => {
    vi.mocked(postMessage).mockClear();
    resetStatus();

    pushPendingInstallable();

    installDialog()
      .querySelector<HTMLButtonElement>('[data-ocu-ip="dontAskAgain"]')
      ?.click();

    expect(installDialog().classList.contains("hidden")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "answerCliInstallPrompt",
      action: "dontAskAgain",
    });

    resetStatus();
  });

  it("treats Esc and backdrop clicks like Not now", () => {
    resetStatus();

    pushPendingInstallable();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(installDialog().classList.contains("hidden")).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "answerCliInstallPrompt",
      action: "notNow",
    });

    // Re-arm via the host's clearing round-trip, then click the backdrop.
    applyOpenCodeUpdateStatus({
      state: "installable",
      step: "",
      installPromptPending: false,
    });
    pushPendingInstallable();
    installDialog().dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    expect(installDialog().classList.contains("hidden")).toBe(true);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "answerCliInstallPrompt",
      action: "notNow",
    });

    resetStatus();
  });

  it("hides the install confirmation when the state leaves installable", () => {
    resetStatus();

    pushPendingInstallable();
    expect(installDialog().classList.contains("hidden")).toBe(false);
    expect(isInstallPromptVisible()).toBe(true);

    // The flow starts: the confirmation must not linger.
    applyOpenCodeUpdateStatus({ state: "updating", step: "installing" });

    expect(installDialog().classList.contains("hidden")).toBe(true);
    expect(isInstallPromptVisible()).toBe(false);

    resetStatus();
  });

  it("shows the auto-started line instead of restart actions after an install", () => {
    resetStatus();

    applyOpenCodeUpdateStatus({
      state: "success",
      step: "",
      installedVersion: "2.1.0",
      sessionAutoStarted: true,
    });

    expect(card().classList.contains("hidden")).toBe(false);
    expect(card().querySelector('[data-ocu-act="restart"]')).toBeNull();
    expect(card().querySelector('[data-ocu-act="later"]')).toBeNull();
    expect(card().textContent).toContain(
      "OpenCode session started automatically.",
    );

    resetStatus();
  });

  it("keeps the restart actions for a regular update success", () => {
    resetStatus();

    applyOpenCodeUpdateStatus({
      state: "success",
      step: "",
      installedVersion: "2.0.7",
    });

    expect(card().querySelector('[data-ocu-act="restart"]')).not.toBeNull();
    expect(card().querySelector('[data-ocu-act="later"]')).not.toBeNull();

    resetStatus();
  });

  it("closes the popover via the cancel button and restores pill focus", () => {
    resetStatus();
    applyOpenCodeUpdateStatus({
      state: "available",
      step: "",
      latestVersion: "2.1.0",
      openMethodPicker: true,
    });

    expect(popover().classList.contains("hidden")).toBe(false);

    popover().querySelector<HTMLButtonElement>("#ocu-pop-cancel")?.click();

    expect(popover().classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(pill());

    resetStatus();
  });

  it("keeps the keyboard hints as an aria-hidden group inside the footer", () => {
    const foot = popover().querySelector<HTMLElement>(".ocu-pop-foot");
    const hints = popover().querySelector<HTMLElement>(".ocu-pop-hints");

    expect(foot?.getAttribute("aria-hidden")).toBeNull();
    expect(hints?.getAttribute("aria-hidden")).toBe("true");
    expect(hints?.textContent).toContain("Enter to confirm");
    expect(hints?.textContent).toContain("Esc to cancel");
    expect(hints?.textContent).toContain("Up and down to switch");
  });
});
