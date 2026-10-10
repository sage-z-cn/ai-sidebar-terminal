// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
  acquireVsCodeApi: vi.fn(() => ({ postMessage: vi.fn() })),
}));

import toolbarHtml from "../terminal/toolbar.html?raw";
import { setKeymapOpenCodeV2 } from "../keymap";

// Minimal keymap DOM (markup.ts pulls host-side i18n; not needed here).
const keymapDom = `
<button type="button" id="btn-keymap" class="toolbar-btn hidden"></button>
<div class="km-overlay hidden" id="km-overlay"></div>
<div class="km-l2-overlay hidden" id="km-l2-overlay"></div>`;

describe("static OpenCode pill + keymap visibility wiring", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div class="toolbar">${toolbarHtml}</div>${keymapDom}`;
  });

  it("renders the AI tool pill as a static OpenCode label without dropdown", () => {
    const pill = document.getElementById("btn-pill-ai-tool")!;
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("data-single")).toBe("true");
    expect(pill.getAttribute("aria-haspopup")).toBeNull();
    expect(document.getElementById("pill-ai-tool-label")!.textContent).toBe(
      "OpenCode",
    );
    // No dropdown panel or chevron: nothing to interact with.
    expect(document.getElementById("dropdown-ai-tool")).toBeNull();
    expect(pill.querySelector(".pill-chevron")).toBeNull();
  });

  it("shows AGENTS.md / opencode.json for OpenCode v1 and v2 with separators", () => {
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
  });
});
