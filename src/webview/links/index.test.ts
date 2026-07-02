import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLinkProvider } from "./index";
import { postMessage } from "../shared/vscode-api";

vi.mock("../shared/vscode-api", () => ({
  postMessage: vi.fn(),
}));

type ProvidedLink = {
  readonly decorations?: { underline: boolean; pointerCursor: boolean };
  readonly range?: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  readonly activate: (...args: unknown[]) => void;
};

const provideLinksForLine = (lineText: string) =>
  new Promise<ReadonlyArray<ProvidedLink> | undefined>((resolve) => {
    const getLine = vi.fn(() => ({
      translateToString: () => lineText,
    }));
    const terminal = {
      buffer: {
        active: {
          getLine,
        },
      },
    };

    createLinkProvider(terminal as never).provideLinks(1, (links) => {
      // xterm.js passes 1-based bufferLineNumber, our code converts to
      // 0-based for getLine: getLine(bufferLineNumber - 1) = getLine(0)
      expect(getLine).toHaveBeenCalledWith(0);
      resolve(links as unknown as ReadonlyArray<ProvidedLink> | undefined);
    });
  });

describe("createLinkProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links at-prefixed opencode paths with line and column suffix", async () => {
    const links = await provideLinksForLine("open @src/providers/MessageRouter.ts:120:5 now");

    expect(links).toHaveLength(1);
    links?.[0]?.activate();

    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "src/providers/MessageRouter.ts",
      line: 120,
      endLine: undefined,
      column: 5,
    });
  });

  it("links absolute file URLs and decodes encoded spaces", async () => {
    const links = await provideLinksForLine("see file:///workspace/My%20File.ts:12");

    expect(links).toHaveLength(1);
    links?.[0]?.activate();

    expect(postMessage).toHaveBeenCalledWith({
      type: "openFile",
      path: "/workspace/My File.ts",
      line: 12,
      endLine: undefined,
      column: undefined,
    });
  });

  it("does not link malformed paths or oversized terminal lines", async () => {
    const malformedLinks = await provideLinksForLine("see http://example.com/not-a-file.ts");
    const oversizedLinks = await provideLinksForLine("a".repeat(10001));

    expect(malformedLinks).toHaveLength(0);
    expect(oversizedLinks).toBeUndefined();
  });

  it("computes range in cell coordinates so CJK width does not shift the underline", async () => {
    // 8 CJK chars (each 2 cells) precede the path, so cell x must be
    // stringIndex + 8, not stringIndex.
    const links = await provideLinksForLine("这是终端链接里的 src/webview/links/index.ts 文件");

    expect(links).toHaveLength(1);
    const range = links?.[0]?.range;
    // "这是终端链接里的 " = 8 CJK chars (16 cells) + 1 space = 17 cells.
    // path starts at string index 9 -> cell 17 -> xterm 1-based x = 18.
    expect(range?.start).toEqual({ x: 18, y: 1 });
    // path "src/webview/links/index.ts" is 26 chars, all width 1 -> 26 cells.
    expect(range?.end).toEqual({ x: 17 + 26, y: 1 });

    links?.[0]?.activate();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "openFile", path: "src/webview/links/index.ts" }),
    );
  });

  it("treats fullwidth punctuation as token boundaries", async () => {
    // Fullwidth 。 must cut the token, so the opened path is just the file.
    const links = await provideLinksForLine(
      "代码在 src/webview/links/index.ts。我先读源码分析根因。",
    );

    expect(links).toHaveLength(1);
    links?.[0]?.activate();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/webview/links/index.ts" }),
    );

    // Fullwidth comma must also cut: ".json，30" should not glue together.
    const jsonLinks = await provideLinksForLine(
      "持久化到 .config/core-beat/holiday/{year}.json，30 天 TTL。",
    );
    jsonLinks?.[0]?.activate();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ path: ".config/core-beat/holiday/{year}.json" }),
    );
  });

  it("strips trailing ASCII/fullwidth punctuation even when CJK follows", async () => {
    // ASCII comma directly after the file, then CJK text (no space).
    const links = await provideLinksForLine(
      "代码在 src/webview/links/index.ts,可归为两条根因:",
    );

    expect(links).toHaveLength(1);
    const range = links?.[0]?.range;
    // underline must end exactly at the end of "index.ts", not the comma.
    const startCell = range?.start?.x ?? 0;
    const endCell = range?.end?.x ?? 0;
    expect(endCell - startCell + 1).toBe("src/webview/links/index.ts".length);

    links?.[0]?.activate();
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ path: "src/webview/links/index.ts" }),
    );
  });

  it("does not treat slash-joined plain words without an extension as a path", async () => {
    const links = await provideLinksForLine("区分 once/repeat/workday 三种类型");
    expect(links).toHaveLength(0);
  });

  it("does not treat localized/code snippets with a dot and slash as a path", async () => {
    // Contains "." and "/" but also CJK chars and "(", so not a path.
    const links = await provideLinksForLine('说明 ".不加(保护扩展名/相对路径" 的取舍');
    expect(links).toHaveLength(0);
  });
});
