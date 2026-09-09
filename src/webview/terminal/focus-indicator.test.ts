// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFocusIndicator } from "./focus-indicator";

const dispatchWindowEvent = (type: string): void => {
  window.dispatchEvent(new Event(type));
};

const dispatchVisibilityChange = (): void => {
  document.dispatchEvent(new Event("visibilitychange"));
};

const setHasFocus = (value: boolean): void => {
  vi.mocked(document.hasFocus).mockReturnValue(value);
};

const getOverlay = (): HTMLDivElement => {
  const overlay = document.querySelector<HTMLDivElement>(
    ".focus-indicator-overlay",
  );
  expect(overlay).not.toBeNull();
  return overlay as HTMLDivElement;
};

describe("createFocusIndicator", () => {
  beforeEach(() => {
    document.body.className = "";
    document.body.removeAttribute("style");
    document
      .querySelectorAll(".focus-indicator-overlay")
      .forEach((element) => element.remove());
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts a dedicated overlay element on the body", () => {
    const indicator = createFocusIndicator();

    const overlay = getOverlay();
    expect(overlay.parentElement).toBe(document.body);

    indicator.dispose();
  });

  it("applies mode class and width variable on the overlay", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    indicator.update("bottomBorder", 3);

    expect(overlay.classList.contains("focus-indicator-bottom")).toBe(true);
    expect(
      overlay.style.getPropertyValue("--focus-indicator-width"),
    ).toBe("3px");

    indicator.update("fullBorder", 5);

    expect(overlay.classList.contains("focus-indicator-bottom")).toBe(false);
    expect(overlay.classList.contains("focus-indicator-full")).toBe(true);
    expect(
      overlay.style.getPropertyValue("--focus-indicator-width"),
    ).toBe("5px");

    indicator.dispose();
  });

  it("syncs focused state from document.hasFocus on update", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    setHasFocus(true);
    indicator.update("fullBorder", 2);
    expect(overlay.classList.contains("focused")).toBe(true);

    setHasFocus(false);
    indicator.update("fullBorder", 2);
    expect(overlay.classList.contains("focused")).toBe(false);

    indicator.dispose();
  });

  it("toggles focused class on window focus and blur events", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    indicator.update("bottomBorder", 2);

    dispatchWindowEvent("focus");
    expect(overlay.classList.contains("focused")).toBe(true);

    dispatchWindowEvent("blur");
    expect(overlay.classList.contains("focused")).toBe(false);

    indicator.dispose();
  });

  it("resyncs focused state on pageshow and visibilitychange", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    indicator.update("fullBorder", 2);
    expect(overlay.classList.contains("focused")).toBe(false);

    setHasFocus(true);
    dispatchWindowEvent("pageshow");
    expect(overlay.classList.contains("focused")).toBe(true);

    setHasFocus(false);
    dispatchVisibilityChange();
    expect(overlay.classList.contains("focused")).toBe(false);

    indicator.dispose();
  });

  it("removes classes, variable, and listeners when switched to off", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    indicator.update("bottomBorder", 4);
    dispatchWindowEvent("focus");
    expect(overlay.classList.contains("focused")).toBe(true);

    indicator.update("off", 4);

    expect(overlay.classList.contains("focused")).toBe(false);
    expect(overlay.classList.contains("focus-indicator-bottom")).toBe(false);
    expect(
      overlay.style.getPropertyValue("--focus-indicator-width"),
    ).toBe("");

    // Listeners must be detached: further events are ignored.
    dispatchWindowEvent("focus");
    setHasFocus(true);
    dispatchWindowEvent("pageshow");
    dispatchVisibilityChange();
    expect(overlay.classList.contains("focused")).toBe(false);

    indicator.dispose();
  });

  it("clears all state and removes the overlay on dispose", () => {
    const indicator = createFocusIndicator();
    const overlay = getOverlay();

    indicator.update("fullBorder", 6);
    dispatchWindowEvent("focus");

    indicator.dispose();

    expect(overlay.classList.contains("focused")).toBe(false);
    expect(overlay.classList.contains("focus-indicator-full")).toBe(false);
    expect(
      overlay.style.getPropertyValue("--focus-indicator-width"),
    ).toBe("");
    expect(document.querySelector(".focus-indicator-overlay")).toBeNull();

    dispatchWindowEvent("focus");
    dispatchWindowEvent("blur");
    expect(overlay.classList.contains("focused")).toBe(false);
  });
});
