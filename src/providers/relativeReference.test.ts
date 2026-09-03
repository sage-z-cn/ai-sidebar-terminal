import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as vscode from "vscode";
import {
  toAbsoluteReference,
  toRelativeReference,
} from "./relativeReference";

vi.mock("fs", () => ({
  statSync: vi.fn(),
}));

const workspaceRoot = /^D:[\\/]ws[\\/]/;

function relativePathMock(): void {
  vi.mocked(vscode.workspace.asRelativePath).mockImplementation(
    (pathOrUri: unknown) => {
      const value =
        typeof pathOrUri === "string"
          ? pathOrUri
          : ((pathOrUri as { fsPath?: string }).fsPath ?? "");
      return value.replace(workspaceRoot, "");
    },
  );
}

function statResult(isDirectory: boolean): fs.Stats {
  return { isDirectory: () => isDirectory } as unknown as fs.Stats;
}

describe("toRelativeReference", () => {
  beforeEach(() => {
    relativePathMock();
    vi.mocked(fs.statSync).mockReset();
  });

  it("returns a forward-slash relative path for files", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(false));
    expect(toRelativeReference("D:\\ws\\src\\file.ts")).toBe("src/file.ts");
  });

  it("appends a trailing slash for directories", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(toRelativeReference("D:\\ws\\src")).toBe("src/");
  });

  it("does not duplicate an existing trailing slash", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    vi.mocked(vscode.workspace.asRelativePath).mockReturnValueOnce("src/");
    expect(toRelativeReference("D:\\ws\\src")).toBe("src/");
  });

  it("treats unstattable paths as plain files", () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(toRelativeReference("D:\\ws\\src\\missing.ts")).toBe(
      "src/missing.ts",
    );
  });

  it("accepts a vscode.Uri input", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(
      toRelativeReference({ fsPath: "D:\\ws\\src\\webview" } as vscode.Uri),
    ).toBe("src/webview/");
  });
});

describe("toAbsoluteReference", () => {
  beforeEach(() => {
    vi.mocked(fs.statSync).mockReset();
  });

  it("returns a forward-slash absolute path for files", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(false));
    expect(toAbsoluteReference("D:\\ws\\src\\file.ts")).toBe(
      "D:/ws/src/file.ts",
    );
  });

  it("appends a trailing slash for directories", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(toAbsoluteReference("D:\\ws\\src")).toBe("D:/ws/src/");
  });

  it("does not duplicate an existing trailing slash", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(toAbsoluteReference("D:/ws/src/")).toBe("D:/ws/src/");
  });

  it("treats unstattable paths as plain files", () => {
    vi.mocked(fs.statSync).mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(toAbsoluteReference("D:\\ws\\src\\missing.ts")).toBe(
      "D:/ws/src/missing.ts",
    );
  });

  it("keeps forward-slash inputs unchanged", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(false));
    expect(toAbsoluteReference("D:/ws/src/file.ts")).toBe("D:/ws/src/file.ts");
  });

  it("normalizes a lowercase drive letter to uppercase", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(false));
    expect(toAbsoluteReference("d:/ws/src/file.ts")).toBe("D:/ws/src/file.ts");
  });

  it("normalizes a lowercase drive letter for directories", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(toAbsoluteReference("d:\\ws\\src")).toBe("D:/ws/src/");
  });

  it("accepts a vscode.Uri input", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(true));
    expect(
      toAbsoluteReference({ fsPath: "D:\\ws\\src\\webview" } as vscode.Uri),
    ).toBe("D:/ws/src/webview/");
  });

  it("does not run workspace-relative conversion", () => {
    vi.mocked(fs.statSync).mockReturnValue(statResult(false));
    toAbsoluteReference("D:\\ws\\src\\file.ts");
    expect(vscode.workspace.asRelativePath).not.toHaveBeenCalled();
  });
});
