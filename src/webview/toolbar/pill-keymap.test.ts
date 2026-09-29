// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
  acquireVsCodeApi: vi.fn(() => ({ postMessage: vi.fn() })),
}));

import toolbarHtml from "../terminal/toolbar.html?raw";
import {
  initPills,
  updatePillsFromActiveSession,
} from "./index";
import { setKeymapOpenCodeV2 } from "../keymap";

// Minimal keymap DOM (markup.ts pulls host-side i18n; not needed here).
const keymapDom = `
<button type="button" id="btn-keymap" class="toolbar-btn hidden"></button>
<div class="km-overlay hidden" id="km-overlay"></div>
<div class="km-l2-overlay hidden" id="km-l2-overlay"></div>`;

describe("ai tool pill + keymap visibility wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="toolbar">${toolbarHtml}</div>${keymapDom}`;
  });

  it("fills pill options from activeSession and toggles the keymap button", () => {
    initPills();

    updatePillsFromActiveSession({
      aiTools: [
        { name: "opencode", label: "OpenCode" },
        { name: "claude", label: "Claude Code" },
      ],
      aiToolName: "opencode",
      aiToolLabel: "OpenCode",
    });

    // Open the dropdown and check the rendered options.
    document.getElementById("btn-pill-ai-tool")!.click();
    const options = document.querySelectorAll("#dropdown-ai-tool .pill-option");
    expect(options.length).toBe(2);

    // Keymap button: opencode selected + v2 flag → visible.
    setKeymapOpenCodeV2(true);
    const btn = document.getElementById("btn-keymap")!;
    expect(btn.classList.contains("hidden")).toBe(false);

    // User switches tool: button hides immediately.
    const claudeOption = [...options].find(
      (el) => (el as HTMLElement).dataset.value === "claude",
    ) as HTMLElement;
    claudeOption.click();
    expect(btn.classList.contains("hidden")).toBe(true);
    expect(
      document.getElementById("pill-ai-tool-label")!.textContent,
    ).toBe("Claude Code");

    // Out-of-order host message: v2 flag arrives while the pill still
    // shows claude — the button must stay hidden (single source of truth
    // is the pill's actual selection, not the message order).
    setKeymapOpenCodeV2(true);
    expect(btn.classList.contains("hidden")).toBe(true);
  });

  it("shows AGENTS.md / opencode.json for OpenCode v1 and v2 with separators", () => {
    initPills();
    updatePillsFromActiveSession({
      aiTools: [
        { name: "opencode", label: "OpenCode" },
        { name: "claude", label: "Claude Code" },
      ],
      aiToolName: "opencode",
      aiToolLabel: "OpenCode",
    });

    const agents = document.getElementById("btn-oc-agents-md")!;
    const configJson = document.getElementById("btn-oc-config-json")!;
    const keymap = document.getElementById("btn-keymap")!;
    const cli = document.getElementById("btn-oc-cli-settings")!;
    const sepFont = document.getElementById("toolbar-sep-font-oc")!;
    const sepSettings = document.getElementById("toolbar-sep-oc-settings")!;

    // OpenCode v1: global file buttons + separators visible; v2-only stay hidden.
    setKeymapOpenCodeV2(false);
    expect(agents.classList.contains("hidden")).toBe(false);
    expect(configJson.classList.contains("hidden")).toBe(false);
    expect(keymap.classList.contains("hidden")).toBe(true);
    expect(cli.classList.contains("hidden")).toBe(true);
    expect(sepFont.classList.contains("hidden")).toBe(false);
    expect(sepSettings.classList.contains("hidden")).toBe(false);

    // OpenCode v2: all four OpenCode buttons visible.
    setKeymapOpenCodeV2(true);
    expect(agents.classList.contains("hidden")).toBe(false);
    expect(configJson.classList.contains("hidden")).toBe(false);
    expect(keymap.classList.contains("hidden")).toBe(false);
    expect(cli.classList.contains("hidden")).toBe(false);

    // Non-OpenCode tool: everything OpenCode-specific hides, separators too.
    document.getElementById("btn-pill-ai-tool")!.click();
    const claudeOption = [
      ...document.querySelectorAll("#dropdown-ai-tool .pill-option"),
    ].find((el) => (el as HTMLElement).dataset.value === "claude") as HTMLElement;
    claudeOption.click();
    expect(agents.classList.contains("hidden")).toBe(true);
    expect(configJson.classList.contains("hidden")).toBe(true);
    expect(keymap.classList.contains("hidden")).toBe(true);
    expect(cli.classList.contains("hidden")).toBe(true);
    expect(sepFont.classList.contains("hidden")).toBe(true);
    expect(sepSettings.classList.contains("hidden")).toBe(true);
  });
});
