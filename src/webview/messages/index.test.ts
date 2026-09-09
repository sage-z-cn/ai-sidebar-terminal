// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageHandler } from "./index";

const mockHandlePasteWithImageSupport = vi.hoisted(() => vi.fn());

vi.mock("../clipboard", () => ({
  handlePasteWithImageSupport: mockHandlePasteWithImageSupport,
}));

describe("createMessageHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes requestPaste messages through image-aware paste handling", () => {
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
      onPlatformInfo: vi.fn(),
    });

    handler.handleEvent(
      new MessageEvent("message", { data: { type: "requestPaste" } }),
    );

    expect(mockHandlePasteWithImageSupport).toHaveBeenCalledTimes(1);
  });

  it("forwards terminalConfig focus indicator fields to onFocusIndicatorConfig", () => {
    const onFocusIndicatorConfig = vi.fn();
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
      onPlatformInfo: vi.fn(),
      onFocusIndicatorConfig,
    });

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 14,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
          focusIndicatorMode: "fullBorder",
          focusIndicatorBorderWidth: 4,
        },
      }),
    );

    expect(onFocusIndicatorConfig).toHaveBeenCalledWith("fullBorder", 4);
  });

  it("falls back to off/2 when focus indicator fields are missing", () => {
    const onFocusIndicatorConfig = vi.fn();
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
      onPlatformInfo: vi.fn(),
      onFocusIndicatorConfig,
    });

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 14,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
        },
      }),
    );

    expect(onFocusIndicatorConfig).toHaveBeenCalledWith("off", 2);
  });

  it("skips xterm option updates and refit when terminal fields are unchanged", () => {
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
    });
    const fit = vi.fn();
    handler.terminal = {
      options: {
        fontSize: 14,
        fontFamily: "monospace",
        cursorBlink: true,
        cursorStyle: "block",
      },
      refresh: vi.fn(),
      rows: 10,
    } as any;
    handler.fitAddon = { fit } as any;

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 14,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
          focusIndicatorMode: "bottomBorder",
          focusIndicatorBorderWidth: 3,
        },
      }),
    );

    expect(fit).not.toHaveBeenCalled();
    expect(handler.terminal?.options.fontSize).toBe(14);
  });

  it("updates xterm options and refits when terminal fields change", () => {
    const handler = createMessageHandler({
      onActiveSession: vi.fn(),
      onShowAiToolSelector: vi.fn(),
    });
    const fit = vi.fn();
    handler.terminal = {
      options: {
        fontSize: 14,
        fontFamily: "monospace",
        cursorBlink: true,
        cursorStyle: "block",
      },
      refresh: vi.fn(),
      rows: 10,
    } as any;
    handler.fitAddon = { fit } as any;

    handler.handleEvent(
      new MessageEvent("message", {
        data: {
          type: "terminalConfig",
          fontSize: 16,
          fontFamily: "monospace",
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
        },
      }),
    );

    expect(handler.terminal?.options.fontSize).toBe(16);
    expect(fit).toHaveBeenCalledTimes(1);
  });
});
