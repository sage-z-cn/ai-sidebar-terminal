// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupFontSizeButtons, setupSettingsButton } from "./index";

const mockPostMessage = vi.hoisted(() => vi.fn());
const mockScheduleRefresh = vi.hoisted(() => vi.fn((fn: () => void) => fn()));

vi.mock("../shared/vscode-api", () => ({
  postMessage: mockPostMessage,
}));

vi.mock("../shared/utils", () => ({
  scheduleRefresh: mockScheduleRefresh,
}));

describe("setupFontSizeButtons", () => {
  let options: { fontSize: number };
  let fit: ReturnType<typeof vi.fn>;
  let terminal: { options: { fontSize: number }; rows: number; refresh: ReturnType<typeof vi.fn> };
  let fitAddon: { fit: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    document.body.innerHTML = `
      <button id="btn-font-decrease"></button>
      <button id="btn-font-increase"></button>
    `;
    options = { fontSize: 12 };
    fit = vi.fn();
    terminal = {
      options,
      rows: 20,
      refresh: vi.fn(),
    };
    fitAddon = { fit };
    setupFontSizeButtons(
      () => terminal as never,
      () => fitAddon as never,
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("increases font size, refits, and posts updateFontSize", () => {
    document.getElementById("btn-font-increase")!.click();

    expect(options.fontSize).toBe(13);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "updateFontSize",
      fontSize: 13,
    });
  });

  it("shows a shared tooltip with the new size that auto-hides after 3s", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="font-size-host">
        <button id="btn-font-increase"></button>
        <div class="font-size-tooltip hidden" id="font-size-tooltip"></div>
        <button id="btn-font-decrease"></button>
      </div>
    `;
    options = { fontSize: 12 };
    terminal = { options, rows: 20, refresh: vi.fn() };
    setupFontSizeButtons(
      () => terminal as never,
      () => fitAddon as never,
    );

    document.getElementById("btn-font-increase")!.click();
    const tooltip = document.getElementById("font-size-tooltip")!;
    expect(tooltip.classList.contains("hidden")).toBe(false);
    expect(tooltip.textContent).toBe("13px");

    document.getElementById("btn-font-increase")!.click();
    expect(tooltip.textContent).toBe("14px");
    expect(tooltip.classList.contains("hidden")).toBe(false);

    vi.advanceTimersByTime(3000);
    expect(tooltip.classList.contains("hidden")).toBe(true);
    vi.useRealTimers();
  });

  it("labels the package default size as default", () => {
    document.body.innerHTML = `
      <div class="font-size-host">
        <button id="btn-font-increase"></button>
        <div class="font-size-tooltip hidden" id="font-size-tooltip"></div>
        <button id="btn-font-decrease"></button>
      </div>
    `;
    options = { fontSize: 11 };
    terminal = { options, rows: 20, refresh: vi.fn() };
    setupFontSizeButtons(
      () => terminal as never,
      () => fitAddon as never,
    );

    document.getElementById("btn-font-increase")!.click();
    const tooltip = document.getElementById("font-size-tooltip")!;
    expect(options.fontSize).toBe(12);
    expect(tooltip.textContent).toBe("12px (default)");
  });

  it("shows current size tooltip when already at bounds", () => {
    document.body.innerHTML = `
      <div class="font-size-host">
        <button id="btn-font-increase"></button>
        <div class="font-size-tooltip hidden" id="font-size-tooltip"></div>
        <button id="btn-font-decrease"></button>
      </div>
    `;
    options = { fontSize: 25 };
    terminal = { options, rows: 20, refresh: vi.fn() };
    setupFontSizeButtons(
      () => terminal as never,
      () => fitAddon as never,
    );

    document.getElementById("btn-font-increase")!.click();
    const tooltip = document.getElementById("font-size-tooltip")!;
    expect(tooltip.textContent).toBe("25px");
    expect(tooltip.classList.contains("hidden")).toBe(false);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("decreases font size and clamps at the minimum", () => {
    document.getElementById("btn-font-decrease")!.click();
    expect(options.fontSize).toBe(11);

    for (let i = 0; i < 10; i++) {
      document.getElementById("btn-font-decrease")!.click();
    }
    expect(options.fontSize).toBe(6);
  });

  it("clamps at the maximum and skips no-op posts", () => {
    options.fontSize = 25;
    document.getElementById("btn-font-increase")!.click();

    expect(options.fontSize).toBe(25);
    expect(mockPostMessage).not.toHaveBeenCalled();
  });
});

describe("setupSettingsButton resetFontSize", () => {
  let options: { fontSize: number };
  let terminal: { options: { fontSize: number }; rows: number; refresh: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="settings-host">
        <button id="btn-settings"></button>
        <div class="settings-dropdown hidden" id="dropdown-settings">
          <div class="settings-option" data-action="resetFontSize"></div>
          <div class="settings-option" data-action="keyboardShortcuts"></div>
          <div class="settings-option" data-action="settings"></div>
        </div>
      </div>
    `;
    options = { fontSize: 18 };
    terminal = {
      options,
      rows: 20,
      refresh: vi.fn(),
    };
    setupSettingsButton({
      getTerminal: () => terminal as never,
      getFitAddon: () => ({ fit: vi.fn() }) as never,
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("resets font size to the package default and posts updateFontSize", () => {
    document.querySelector<HTMLElement>('[data-action="resetFontSize"]')!.click();

    expect(options.fontSize).toBe(12);
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "updateFontSize",
      fontSize: 12,
    });
  });

  it("still posts the default when already at default", () => {
    options.fontSize = 12;
    document.querySelector<HTMLElement>('[data-action="resetFontSize"]')!.click();

    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "updateFontSize",
      fontSize: 12,
    });
  });
});
