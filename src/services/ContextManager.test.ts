import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextManager } from "./ContextManager";
import { FileReferenceManager } from "./FileReferenceManager";
import type { OutputChannelService } from "./OutputChannelService";
import type * as vscodeTypes from "../test/mocks/vscode";

type ManagerUri = Parameters<ContextManager["getDiagnostics"]>[0];

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

describe("ContextManager", () => {
  let onDidChangeActiveTextEditorListener:
    | ((editor: vscodeTypes.TextEditor | undefined) => void)
    | undefined;
  let onDidChangeTextEditorSelectionListener:
    | ((event: { textEditor: vscodeTypes.TextEditor }) => void)
    | undefined;
  let onDidChangeTextDocumentListener:
    | ((event: { document: vscodeTypes.TextDocument }) => void)
    | undefined;
  let onDidChangeDiagnosticsListener:
    | ((event: { uris: any[] }) => void)
    | undefined;

  const createOutputChannelServiceMock = () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  });

  const createEditor = (filePath: string, scheme = "file") => {
    const uri =
      scheme === "file"
        ? vscode.Uri.file(filePath)
        : ({ ...vscode.Uri.file(filePath), scheme } as vscodeTypes.Uri);
    const document = new vscode.TextDocument(uri, "const value = 1;");
    const selection = new vscode.Selection(0, 0, 0, 0);
    return new vscode.TextEditor(document, selection);
  };

  const asOutputChannel = (
    outputChannel: ReturnType<typeof createOutputChannelServiceMock>,
  ): OutputChannelService => outputChannel as unknown as OutputChannelService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "contextDebounceMs") {
          return 500;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    vi.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(
      (listener: any) => {
        onDidChangeActiveTextEditorListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(
      (listener: any) => {
        onDidChangeTextEditorSelectionListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockImplementation(
      (listener: any) => {
        onDidChangeTextDocumentListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );

    vi.mocked(vscode.languages.onDidChangeDiagnostics).mockImplementation(
      (listener: any) => {
        onDidChangeDiagnosticsListener = listener;
        return { dispose: vi.fn() } as any;
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces rapid context changes into a single update", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/context.ts");
    vscode.window.activeTextEditor = editor;

    onDidChangeActiveTextEditorListener?.(editor);
    onDidChangeTextEditorSelectionListener?.({ textEditor: editor });
    onDidChangeTextDocumentListener?.({ document: editor.document });

    vi.advanceTimersByTime(499);
    expect(outputChannel.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    vi.advanceTimersByTime(1);
    expect(outputChannel.debug).toHaveBeenCalledTimes(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();
  });

  it("tracks diagnostics for affected files", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    const trackedUri = vscode.Uri.file("/workspace/src/tracked.ts");
    const untrackedUri = vscode.Uri.file("/workspace/src/untracked.ts");
    const diagnostics = [
      {
        message: "Unexpected token",
        severity: vscode.DiagnosticSeverity.Error,
      },
    ];

    vi.mocked(vscode.languages.getDiagnostics).mockImplementation(
      (uri?: any) => {
        if (uri?.path === trackedUri.path) {
          return diagnostics as any;
        }
        return [];
      },
    );

    onDidChangeDiagnosticsListener?.({ uris: [trackedUri] as any });

    expect(manager.getDiagnostics(trackedUri as any)).toEqual(diagnostics);
    expect(manager.getDiagnostics(untrackedUri as any)).toEqual([]);

    manager.dispose();
  });

  it("disposes all registered event listeners", () => {
    const disposeActiveEditor = vi.fn();
    const disposeSelection = vi.fn();
    const disposeDocument = vi.fn();
    const disposeDiagnostics = vi.fn();

    vi.mocked(vscode.window.onDidChangeActiveTextEditor).mockImplementation(
      (listener: any) => {
        onDidChangeActiveTextEditorListener = listener;
        return { dispose: disposeActiveEditor } as any;
      },
    );
    vi.mocked(vscode.window.onDidChangeTextEditorSelection).mockImplementation(
      (listener: any) => {
        onDidChangeTextEditorSelectionListener = listener;
        return { dispose: disposeSelection } as any;
      },
    );
    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockImplementation(
      (listener: any) => {
        onDidChangeTextDocumentListener = listener;
        return { dispose: disposeDocument } as any;
      },
    );
    vi.mocked(vscode.languages.onDidChangeDiagnostics).mockImplementation(
      (listener: any) => {
        onDidChangeDiagnosticsListener = listener;
        return { dispose: disposeDiagnostics } as any;
      },
    );

    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    manager.dispose();

    expect(disposeActiveEditor).toHaveBeenCalledOnce();
    expect(disposeSelection).toHaveBeenCalledOnce();
    expect(disposeDocument).toHaveBeenCalledOnce();
    expect(disposeDiagnostics).toHaveBeenCalledOnce();
  });

  it("uses configured debounce delay", () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "contextDebounceMs") {
          return 1200;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    } as any);

    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/configured.ts");
    onDidChangeActiveTextEditorListener?.(editor);

    vi.advanceTimersByTime(1199);
    expect(outputChannel.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    vi.advanceTimersByTime(1);
    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();
  });

  it("logs lifecycle and update events through OutputChannelService", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(outputChannel as any);

    expect(outputChannel.info).toHaveBeenCalledWith(
      expect.stringContaining("ContextManager initialized"),
    );

    outputChannel.debug.mockClear();

    const editor = createEditor("/workspace/src/logging.ts");
    onDidChangeActiveTextEditorListener?.(editor);

    vi.advanceTimersByTime(500);

    expect(outputChannel.debug).toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();

    expect(outputChannel.info).toHaveBeenCalledWith(
      expect.stringContaining("ContextManager disposed"),
    );
  });

  it("logs file reference manager events", () => {
    const outputChannel = createOutputChannelServiceMock();
    const fileRefManager = new FileReferenceManager();
    const manager = new ContextManager(
      asOutputChannel(outputChannel),
      fileRefManager,
    );

    const reference = fileRefManager.addReference({
      id: "ref-1",
      path: "src/context.ts",
    });
    fileRefManager.removeReference(reference.id);
    fileRefManager.clearReferences();

    expect(outputChannel.info).toHaveBeenCalledWith(
      "File reference added: src/context.ts",
    );
    expect(outputChannel.info).toHaveBeenCalledWith(
      "File reference removed: ref-1",
    );
    expect(outputChannel.info).toHaveBeenCalledWith(
      "All file references cleared",
    );

    manager.dispose();
  });

  it("ignores document changes for non-active documents", () => {
    const outputChannel = createOutputChannelServiceMock();
    const activeEditor = createEditor("/workspace/src/active.ts");
    vscode.window.activeTextEditor = activeEditor;
    const manager = new ContextManager(asOutputChannel(outputChannel));

    outputChannel.debug.mockClear();
    const otherDocument = new vscode.TextDocument(
      vscode.Uri.file("/workspace/src/other.ts"),
      "const other = 1;",
    );
    onDidChangeTextDocumentListener?.({ document: otherDocument });
    vi.advanceTimersByTime(500);

    expect(outputChannel.debug).not.toHaveBeenCalledWith(
      expect.stringContaining("Context updated"),
    );

    manager.dispose();
  });

  it("logs none file and selection when active editor is cleared", () => {
    const outputChannel = createOutputChannelServiceMock();
    vscode.window.activeTextEditor = createEditor("/workspace/src/initial.ts");
    const manager = new ContextManager(asOutputChannel(outputChannel));

    outputChannel.debug.mockClear();
    onDidChangeActiveTextEditorListener?.(undefined);
    vi.advanceTimersByTime(500);

    expect(outputChannel.debug).toHaveBeenCalledWith(
      "Context updated (file: none, selection: none)",
    );

    manager.dispose();
  });

  it("keys diagnostics by path fallback and URI string fallback", () => {
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(asOutputChannel(outputChannel));
    const pathOnlyUri = {
      fsPath: "",
      path: "/workspace/src/path-only.ts",
      toString: () => "file:///workspace/src/path-only.ts",
    } as unknown as ManagerUri;
    const stringOnlyUri = {
      fsPath: "",
      path: "",
      toString: () => "untitled:context",
    } as unknown as ManagerUri;
    const pathDiagnostics = [
      { message: "path diagnostic", severity: vscode.DiagnosticSeverity.Warning },
    ];
    const stringDiagnostics = [
      { message: "string diagnostic", severity: vscode.DiagnosticSeverity.Hint },
    ];

    vi.mocked(vscode.languages.getDiagnostics).mockImplementation(
      (uri?: ManagerUri) => {
        if (uri === pathOnlyUri) {
          return pathDiagnostics;
        }

        if (uri === stringOnlyUri) {
          return stringDiagnostics;
        }

        return [];
      },
    );

    onDidChangeDiagnosticsListener?.({ uris: [pathOnlyUri, stringOnlyUri] });

    expect(manager.getDiagnostics(pathOnlyUri)).toEqual(pathDiagnostics);
    expect(manager.getDiagnostics(stringOnlyUri)).toEqual(stringDiagnostics);

    manager.dispose();
  });

  it("pushes the already-open editor snapshot when the IDE server is attached", () => {
    const outputChannel = createOutputChannelServiceMock();
    const active = createEditor("/workspace/src/already-open.ts");
    vscode.window.activeTextEditor = active;
    const manager = new ContextManager(asOutputChannel(outputChannel));

    const notifySelectionChanged = vi.fn();
    let snapshotProvider: (() => any) | undefined;
    const server = {
      isRunning: () => false,
      getConnectedClientCount: () => 0,
      getReadyClientCount: () => 0,
      notifySelectionChanged,
      setSelectionSnapshotProvider: (fn: () => any) => {
        snapshotProvider = fn;
      },
    };

    manager.setIdeContextServer(server as any);

    expect(notifySelectionChanged).toHaveBeenCalledTimes(1);
    expect(notifySelectionChanged.mock.calls[0][0].filePath).toBe(
      "/workspace/src/already-open.ts",
    );
    expect(snapshotProvider?.().filePath).toBe(
      "/workspace/src/already-open.ts",
    );

    manager.dispose();
  });

  it("skips Output panel documents so they do not overwrite file context", () => {
    vscode.window.activeTextEditor = undefined;
    const outputChannel = createOutputChannelServiceMock();
    const manager = new ContextManager(asOutputChannel(outputChannel));
    const notifySelectionChanged = vi.fn();
    const server = {
      isRunning: () => true,
      getConnectedClientCount: () => 1,
      getReadyClientCount: () => 1,
      notifySelectionChanged,
      setSelectionSnapshotProvider: vi.fn(),
    };
    manager.setIdeContextServer(server as any);
    notifySelectionChanged.mockClear();

    outputChannel.info.mockClear();
    outputChannel.warn.mockClear();

    const outputEditor = createEditor(
      "sagez.ai-sidebar-terminal.AI Sidebar Terminal.log",
      "output",
    );
    onDidChangeActiveTextEditorListener?.(outputEditor);
    vi.advanceTimersByTime(500);

    expect(notifySelectionChanged).not.toHaveBeenCalled();

    const fileEditor = createEditor("/workspace/src/real.ts");
    onDidChangeActiveTextEditorListener?.(fileEditor);
    vi.advanceTimersByTime(500);

    expect(notifySelectionChanged).toHaveBeenCalledTimes(1);
    expect(notifySelectionChanged.mock.calls[0][0].filePath).toBe(
      "/workspace/src/real.ts",
    );

    manager.dispose();
  });

  it("does not seed the IDE server snapshot from non-file documents", () => {
    const outputChannel = createOutputChannelServiceMock();
    const outputEditor = createEditor(
      "sagez.ai-sidebar-terminal.AI Sidebar Terminal.log",
      "output",
    );
    vscode.window.activeTextEditor = outputEditor;
    const manager = new ContextManager(asOutputChannel(outputChannel));

    const notifySelectionChanged = vi.fn();
    let snapshotProvider: (() => any) | undefined;
    const server = {
      isRunning: () => true,
      getConnectedClientCount: () => 1,
      getReadyClientCount: () => 1,
      notifySelectionChanged,
      setSelectionSnapshotProvider: (fn: () => any) => {
        snapshotProvider = fn;
      },
    };

    manager.setIdeContextServer(server as any);

    // Neither the attach-time push nor the snapshot provider (which the WS
    // server pulls at TUI-connect time via ensureLastSelection) may expose
    // the Output panel document as file context.
    expect(notifySelectionChanged).not.toHaveBeenCalled();
    expect(snapshotProvider?.()).toBeUndefined();

    manager.dispose();
  });
});
