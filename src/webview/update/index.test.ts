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
      "Last update failed. Click to check again",
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
        notice: "Update abandoned",
      });

      expect(card().classList.contains("hidden")).toBe(false);
      expect(card().textContent).toContain("Update abandoned");

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
      "Update OpenCode to 2.1.0",
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
