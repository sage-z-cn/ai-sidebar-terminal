// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { fitFullWidth, proposeFullWidthCols } from "./fit";

function makeTerminal(options: {
  cols: number;
  rows: number;
  parentWidth: number;
  cellWidth: number;
  padLeft?: number;
  padRight?: number;
}): Terminal {
  const parent = document.createElement("div");
  parent.style.width = `${options.parentWidth}px`;
  parent.style.paddingLeft = "0px";
  parent.style.paddingRight = "0px";

  const element = document.createElement("div");
  element.style.paddingLeft = `${options.padLeft ?? 0}px`;
  element.style.paddingRight = `${options.padRight ?? 0}px`;
  parent.appendChild(element);
  document.body.appendChild(parent);

  const resize = vi.fn();
  const terminal = {
    cols: options.cols,
    rows: options.rows,
    element,
    resize,
    _core: {
      _renderService: {
        dimensions: { css: { cell: { width: options.cellWidth, height: 16 } } },
        clear: vi.fn(),
      },
    },
  } as unknown as Terminal & { resize: ReturnType<typeof vi.fn> };

  return terminal;
}

function makeFitAddon(
  proposal: { cols: number; rows: number } | undefined,
): FitAddon {
  return {
    proposeDimensions: () => proposal,
    fit: vi.fn(),
  } as unknown as FitAddon;
}

describe("proposeFullWidthCols", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns full-width columns without the 14px scrollbar gutter", () => {
    // 200px / 10px cell = 20 cols; FitAddon would return ~18 (200-14)/10
    const terminal = makeTerminal({
      cols: 18,
      rows: 10,
      parentWidth: 200,
      cellWidth: 10,
    });
    const fitAddon = makeFitAddon({ cols: 18, rows: 10 });

    expect(proposeFullWidthCols(terminal, fitAddon)).toBe(20);
  });

  it("subtracts element horizontal padding", () => {
    const terminal = makeTerminal({
      cols: 18,
      rows: 10,
      parentWidth: 220,
      cellWidth: 10,
      padLeft: 5,
      padRight: 5,
    });
    const fitAddon = makeFitAddon({ cols: 18, rows: 10 });

    expect(proposeFullWidthCols(terminal, fitAddon)).toBe(21);
  });

  it("falls back to FitAddon dims when cell metrics are missing", () => {
    const terminal = makeTerminal({
      cols: 12,
      rows: 8,
      parentWidth: 200,
      cellWidth: 0,
    });
    const fitAddon = makeFitAddon({ cols: 12, rows: 8 });

    expect(proposeFullWidthCols(terminal, fitAddon)).toBe(12);
  });

  it("returns null when FitAddon cannot propose dimensions", () => {
    const terminal = makeTerminal({
      cols: 12,
      rows: 8,
      parentWidth: 200,
      cellWidth: 10,
    });
    const fitAddon = makeFitAddon(undefined);

    expect(proposeFullWidthCols(terminal, fitAddon)).toBeNull();
  });
});

describe("fitFullWidth", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("resizes once to full-width cols without calling fit()", () => {
    const terminal = makeTerminal({
      cols: 18,
      rows: 10,
      parentWidth: 200,
      cellWidth: 10,
    }) as Terminal & { resize: ReturnType<typeof vi.fn> };
    const fitAddon = makeFitAddon({ cols: 18, rows: 10 });

    fitFullWidth(terminal, fitAddon);

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(terminal.resize).toHaveBeenCalledTimes(1);
    expect(terminal.resize).toHaveBeenCalledWith(20, 10);
  });

  it("is a no-op when full width already matches current dims", () => {
    // FitAddon proposes 18 (14px gutter); the terminal already sits at the
    // full-width 20. Nothing may resize and fit() must not be called.
    const terminal = makeTerminal({
      cols: 20,
      rows: 10,
      parentWidth: 200,
      cellWidth: 10,
    }) as Terminal & { resize: ReturnType<typeof vi.fn> };
    const fitAddon = makeFitAddon({ cols: 18, rows: 10 });

    fitFullWidth(terminal, fitAddon);

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(terminal.resize).not.toHaveBeenCalled();
  });

  it("resizes when only rows change", () => {
    const terminal = makeTerminal({
      cols: 20,
      rows: 8,
      parentWidth: 200,
      cellWidth: 10,
    }) as Terminal & { resize: ReturnType<typeof vi.fn> };
    const fitAddon = makeFitAddon({ cols: 18, rows: 10 });

    fitFullWidth(terminal, fitAddon);

    expect(terminal.resize).toHaveBeenCalledTimes(1);
    expect(terminal.resize).toHaveBeenCalledWith(20, 10);
  });

  it("falls back to FitAddon dims when cell metrics are missing", () => {
    const terminal = makeTerminal({
      cols: 10,
      rows: 10,
      parentWidth: 200,
      cellWidth: 0,
    }) as Terminal & { resize: ReturnType<typeof vi.fn> };
    const fitAddon = makeFitAddon({ cols: 12, rows: 10 });

    fitFullWidth(terminal, fitAddon);

    expect(terminal.resize).toHaveBeenCalledTimes(1);
    expect(terminal.resize).toHaveBeenCalledWith(12, 10);
  });

  it("returns early when FitAddon cannot propose dimensions", () => {
    const terminal = makeTerminal({
      cols: 20,
      rows: 10,
      parentWidth: 200,
      cellWidth: 10,
    }) as Terminal & { resize: ReturnType<typeof vi.fn> };
    const fitAddon = makeFitAddon(undefined);

    expect(() => fitFullWidth(terminal, fitAddon)).not.toThrow();
    expect(terminal.resize).not.toHaveBeenCalled();
  });
});
