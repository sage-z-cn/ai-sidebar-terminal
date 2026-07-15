import type { Terminal } from "@xterm/xterm";
import { postMessage } from "../shared/vscode-api";

interface Link {
  text: string;
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  decorations: { underline: boolean; pointerCursor: boolean };
  activate: (event: MouseEvent, text: string) => void;
  hover?: (event: MouseEvent, text: string) => void;
  leave?: (event: MouseEvent, text: string) => void;
  dispose?: () => void;
}

const MAX_LINE_LENGTH = 10000;

type ParsedFileReference = {
  readonly path: string;
  readonly line?: number;
  readonly endLine?: number;
  readonly column?: number;
};

type CandidateReference = {
  readonly text: string;
  readonly startIndex: number;
};

const isTokenBoundary = (char: string): boolean => {
  if (char === "") return false;
  if (/\s/.test(char) || char === "\"" || char === "'") return true;

  // Common prose punctuation that never starts/continues a path token.
  // NOTE: ":" and "." are intentionally NOT boundaries — they are needed for
  // drive letters (C:), line:col suffixes (file.ts:120:5), extensions, and
  // relative paths (./, ../). They are handled by trailing-punctuation strip.
  if (",;!?".includes(char)) return true;

  // Treat CJK / fullwidth punctuation as boundaries so paths are not glued
  // to surrounding localized text (e.g. "index.ts。我先" / "file.json，30").
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0xff01 && code <= 0xff60) return true; // Fullwidth ASCII variants
  if (code >= 0xffe0 && code <= 0xffe6) return true; // Fullwidth signs
  if (code >= 0x3000 && code <= 0x303f) return true; // CJK Symbols and Punctuation
  if (code >= 0xfe30 && code <= 0xfe4f) return true; // CJK Compatibility Forms
  return false;
};

// Approximate xterm cell width for a codepoint. CJK / fullwidth / emoji
// characters occupy 2 cells; combining/control chars occupy 0; the rest 1.
const getCellWidth = (code: number): number => {
  if (code < 0x20 || code === 0x7f) return 0;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
};

// Trailing punctuation that may legitimately appear right after a path in
// prose (ASCII + CJK/fullwidth) but is never part of the path itself.
// Stripped after tokenization so the opened path and underline end exactly
// on the last path character.
const TRAILING_PUNCTUATION = new Set([
  ",", ".", ";", "!", "?", ")", "]", "}",
  "\u3001", "\u3002",           // 、 。
  "\uff0c", "\uff0e", "\uff1b", "\uff01", "\uff1f", "\uff09", "\uff3d", // ， ． ； ！ ？ ） ］
  "\u300b", "\u300d", "\u300f", "\u3011", "\u3017", // 》 」 』 】 〗
]);

const stripTrailingPunctuation = (text: string): string => {
  let end = text.length;
  while (end > 0 && TRAILING_PUNCTUATION.has(text[end - 1] ?? "")) {
    end--;
  }
  return end === text.length ? text : text.slice(0, end);
};

// Build a map from string index -> starting cell x for every char position,
// plus the total cell width at the end. Used to convert string offsets
// (returned by the tokenizer) into xterm cell coordinates.
const buildCellOffsets = (lineText: string): number[] => {
  const offsets: number[] = [];
  let cell = 0;
  for (const ch of lineText) {
    offsets.push(cell);
    cell += getCellWidth(ch.codePointAt(0) ?? 0);
  }
  offsets.push(cell);
  return offsets;
};

const collectCandidateReferences = (
  lineText: string,
): ReadonlyArray<CandidateReference> => {
  const candidates: CandidateReference[] = [];
  let index = 0;

  while (index < lineText.length) {
    while (index < lineText.length && isTokenBoundary(lineText[index] ?? "")) {
      index++;
    }

    const startIndex = index;
    while (index < lineText.length && !isTokenBoundary(lineText[index] ?? "")) {
      index++;
    }

    if (index > startIndex) {
      candidates.push({
        text: lineText.slice(startIndex, index),
        startIndex,
      });
    }
  }

  return candidates;
};

const SINGLE_FILE_RE =
  /^[A-Za-z0-9_.-]+\.(?:c|cc|cpp|cs|css|cts|env|fish|go|h|hpp|html|java|js|json|jsx|kt|lock|lua|md|mjs|mts|php|py|rb|rs|scss|sh|swift|toml|ts|tsx|txt|yaml|yml|zsh)(?::\d+(?::\d+)?)?(?:#L\d+(?:-L?\d+)?)?$/i;

const isLikelyFileReference = (candidate: string): boolean => {
  const withoutAtPrefix = candidate.startsWith("@")
    ? candidate.slice(1)
    : candidate;

  // The first character must be a plausible path-start character to
  // avoid false positives when CJK text is adjacent to a file path
  // without a space separator (e.g. "因为some/path.ts").
  if (!/^[a-zA-Z0-9_\-\.\/\\~]/.test(withoutAtPrefix)) {
    return false;
  }

  // Reject label:path patterns where a non-drive-letter word precedes
  // a slash-containing path (e.g. "Error:src/file.ts", "git:some/branch").
  const colonIdx = withoutAtPrefix.indexOf(":");
  if (colonIdx > 0) {
    const beforeColon = withoutAtPrefix.slice(0, colonIdx);
    const afterColon = withoutAtPrefix.slice(colonIdx + 1);
    if (
      !/^[A-Za-z]$/.test(beforeColon) &&
      !withoutAtPrefix.startsWith("file://") &&
      afterColon.includes("/")
    ) {
      return false;
    }
  }

  return (
    withoutAtPrefix.startsWith("file://") ||
    withoutAtPrefix.startsWith("/") ||
    withoutAtPrefix.startsWith("./") ||
    withoutAtPrefix.startsWith("../") ||
    /^[A-Za-z]:\\/.test(withoutAtPrefix) ||
    SINGLE_FILE_RE.test(withoutAtPrefix) ||
    // Bare relative path fallback (e.g. "src/webview/links/index.ts" or
    // Windows-style "liveai-server\src\main\java\...\PptExtractor.java").
    // Require a path separator ("/" or "\"), a ".", AND restrict to ASCII
    // path chars so localized text or code snippets are not misread.
    (!/^[a-z][a-z0-9+\-.]*:\/\//i.test(withoutAtPrefix) &&
      (withoutAtPrefix.includes("/") || withoutAtPrefix.includes("\\")) &&
      withoutAtPrefix.includes(".") &&
      /^[@A-Za-z0-9._\-/\\~:{}]+$/.test(withoutAtPrefix))
  );
};

const parsePositiveInteger = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const extractHashLineSuffix = (
  reference: string,
): { readonly reference: string; readonly line?: number; readonly endLine?: number } => {
  const match = /^(.*)#L(\d+)(?:-L?(\d+))?$/.exec(reference);
  if (!match) {
    return { reference };
  }

  return {
    reference: match[1] ?? reference,
    line: parsePositiveInteger(match[2]),
    endLine: parsePositiveInteger(match[3]),
  };
};

const extractColonSuffix = (
  reference: string,
): { readonly reference: string; readonly line?: number; readonly column?: number } => {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(reference);
  if (!match) {
    return { reference };
  }

  return {
    reference: match[1] ?? reference,
    line: parsePositiveInteger(match[2]),
    column: parsePositiveInteger(match[3]),
  };
};

const parseFileReference = (candidate: string): ParsedFileReference | null => {
  const withoutAtPrefix = candidate.startsWith("@")
    ? candidate.slice(1)
    : candidate;
  const hashSuffix = extractHashLineSuffix(withoutAtPrefix);
  const colonSuffix = extractColonSuffix(hashSuffix.reference);
  let path = colonSuffix.reference;

  if (!path) {
    return null;
  }

  if (path.startsWith("file://")) {
    try {
      const url = new URL(path);
      path = decodeURIComponent(url.pathname);
      if (url.hostname && !url.pathname.startsWith("/")) {
        path = `${url.hostname}:${path}`;
      }
    } catch {
      return null;
    }
  }

  return {
    path,
    line: hashSuffix.line ?? colonSuffix.line,
    endLine: hashSuffix.endLine,
    column: colonSuffix.column,
  };
};

export function createLinkProvider(terminal: Terminal) {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: Link[] | undefined) => void,
    ) {
      // xterm.js passes 1-based bufferLineNumber; getLine expects 0-based.
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const lineText = line.translateToString(true);
      if (lineText.length > MAX_LINE_LENGTH) {
        callback(undefined);
        return;
      }

      // Convert string indices to terminal cell x coordinates so wide chars
      // (CJK / fullwidth / emoji, each 2 cells) don't shift the underline.
      const cellOffsets = buildCellOffsets(lineText);

      const links: Link[] = [];
      for (const candidate of collectCandidateReferences(lineText)) {
        // Strip trailing prose punctuation so it is not glued onto the opened
        // path or underline (e.g. "index.ts," / "file.json，30" / "index.ts。").
        const trimmedText = stripTrailingPunctuation(candidate.text);
        if (!trimmedText || !isLikelyFileReference(trimmedText)) continue;

        const parsedReference = parseFileReference(trimmedText);
        if (!parsedReference) continue;

        const startCell = cellOffsets[candidate.startIndex] ?? 0;
        const endCell =
          cellOffsets[candidate.startIndex + trimmedText.length] ?? startCell;

        links.push({
          text: trimmedText,
          range: {
            start: { x: startCell + 1, y: bufferLineNumber },
            end: { x: endCell, y: bufferLineNumber },
          },
          decorations: { underline: true, pointerCursor: true },
          activate: (_event: MouseEvent, _text: string) => {
            postMessage({
              type: "openFile",
              path: parsedReference.path,
              line: parsedReference.line,
              endLine: parsedReference.endLine,
              column: parsedReference.column,
            });
          },
        });
      }

      callback(links);
    },
  };
}
