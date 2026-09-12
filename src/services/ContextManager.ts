import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";
import { FileReferenceManager } from "./FileReferenceManager";
import type { IdeContextServer } from "./ideContext/IdeContextServer";
import type { EditorSelectionPayload } from "./ideContext/protocol";

/**
 * URI schemes worth sharing with OpenCode as "current file".
 * The Output panel (scheme `output`), debug console, and other virtual
 * documents are not real workspace files — forwarding them would overwrite
 * a useful file context with `*.log` noise.
 */
const FORWARDABLE_SCHEMES = new Set([
  "file",
  "vscode-remote",
  "vscode-vfs",
  "vscode-notebook-cell",
]);

export class ContextManager implements vscode.Disposable {
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly outputChannel: OutputChannelService;
  private readonly diagnostics: Map<string, vscode.Diagnostic[]> = new Map();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debounceMs: number;

  private activeEditor: vscode.TextEditor | undefined;
  private activeSelection: vscode.Selection | undefined;
  /**
   * Optional editor-context WS server. When attached and running, every
   * editor/selection change is forwarded so OpenCode TUI can render the
   * active file below its prompt input.
   */
  private ideContextServer?: IdeContextServer;

  constructor(
    outputChannel: OutputChannelService,
    private readonly fileRefManager?: FileReferenceManager,
  ) {
    this.outputChannel = outputChannel;

    const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
    this.debounceMs = config.get<number>("contextDebounceMs", 500);

    this.activeEditor = vscode.window.activeTextEditor;
    this.activeSelection = this.activeEditor?.selection;

    this.setupEventListeners();

    if (this.fileRefManager) {
      this.setupFileReferenceListeners();
    }
    this.outputChannel.info(
      `ContextManager initialized (debounce: ${this.debounceMs}ms)`,
    );
  }

  /**
   * Attaches (or detaches with `undefined`) the editor-context WS server.
   * After attaching, every editor tab/selection change is pushed to OpenCode
   * TUI via `notifySelectionChanged`. Safe to call again with a new server.
   */
  public setIdeContextServer(server?: IdeContextServer): void {
    this.ideContextServer = server;
    this.outputChannel.info(
      server
        ? "[IdeContext] Attached IdeContextServer for editor → TUI forwarding"
        : "[IdeContext] Detached IdeContextServer; editor events will not be forwarded",
    );
    if (!server) return;

    // Let the WS server pull the active editor if a TUI connects before any
    // selection event (file already open at activation / session start).
    server.setSelectionSnapshotProvider(() => this.buildSelectionPayload());
    // Seed lastSelection immediately so connect-time replay has something.
    this.pushCurrentSelection();
  }

  /**
   * Pushes the active editor file/selection to the IDE context server now.
   * Safe when WS is not running — the server caches it for replay on connect.
   */
  public pushCurrentSelection(): void {
    if (!this.ideContextServer) return;

    const payload = this.buildSelectionPayload();
    if (!payload) return;

    this.ideContextServer.notifySelectionChanged(payload);
    this.outputChannel.info(
      `[IdeContext] Pushed current editor snapshot file=${payload.filePath}`,
    );
  }

  private setupEventListeners(): void {
    const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        this.activeEditor = editor;
        this.activeSelection = editor?.selection;
        this.handleContextChange();
      },
    );

    const selectionDisposable = vscode.window.onDidChangeTextEditorSelection(
      (event) => {
        this.activeEditor = event.textEditor;
        this.activeSelection = event.textEditor.selection;
        this.handleContextChange();
      },
    );

    const documentDisposable = vscode.workspace.onDidChangeTextDocument(
      (event) => {
        if (
          this.activeEditor &&
          this.getUriKey(this.activeEditor.document.uri) ===
            this.getUriKey(event.document.uri)
        ) {
          this.handleContextChange();
        }
      },
    );

    const diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics(
      (event) => {
        event.uris.forEach((uri) => {
          this.diagnostics.set(
            this.getUriKey(uri),
            vscode.languages.getDiagnostics(uri),
          );
        });
        this.outputChannel.debug(
          `Diagnostics updated for ${event.uris.length} file(s)`,
        );
      },
    );

    this.disposables.push(
      activeEditorDisposable,
      selectionDisposable,
      documentDisposable,
      diagnosticsDisposable,
    );
  }

  private setupFileReferenceListeners(): void {
    this.disposables.push(
      this.fileRefManager!.onDidAddReference((ref) => {
        this.outputChannel.info(`File reference added: ${ref.path}`);
      }),
      this.fileRefManager!.onDidRemoveReference((id) => {
        this.outputChannel.info(`File reference removed: ${id}`);
      }),
      this.fileRefManager!.onDidClearReferences(() => {
        this.outputChannel.info("All file references cleared");
      }),
    );
  }

  private handleContextChange(): void {
    this.debouncedUpdate();
  }

  private debouncedUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      const filePath = this.activeEditor?.document.uri.fsPath ?? "none";
      const selectionText = this.activeSelection
        ? `L${this.activeSelection.start.line + 1}-L${this.activeSelection.end.line + 1}`
        : "none";

      this.outputChannel.debug(
        `Context updated (file: ${filePath}, selection: ${selectionText})`,
      );

      // Forward to OpenCode TUI when the editor-context WS is attached.
      // When our server is deferred (Claude Code owns the WS), the payload
      // is only cached, never sent. Otherwise always notify: the server
      // caches lastSelection even when OpenCode has not connected yet and
      // replays it on connect, so early selection changes during TUI startup
      // are not lost.
      if (!this.ideContextServer) {
        return;
      }

      const payload = this.buildSelectionPayload();
      if (!payload) {
        return;
      }

      const running = this.ideContextServer.isRunning();
      const connectedClients = this.ideContextServer.getConnectedClientCount();
      const readyClients = this.ideContextServer.getReadyClientCount();
      if (!running) {
        this.outputChannel.debug(
          `[IdeContext] Cached selection_changed (WS not running yet) file=${payload.filePath}`,
        );
      } else if (connectedClients === 0) {
        this.outputChannel.debug(
          `[IdeContext] Cached selection_changed (0 connected TUI sockets; will replay on connect) file=${payload.filePath}`,
        );
      }

      this.ideContextServer.notifySelectionChanged(payload);
      const range = payload.ranges[0];
      this.outputChannel.debug(
        `[IdeContext] Forwarded selection_changed file=${payload.filePath} ` +
          `range=L${range?.selection.start.line}:C${range?.selection.start.character}-L${range?.selection.end.line}:C${range?.selection.end.character} ` +
          `textLen=${range?.text.length ?? 0} running=${running} connected=${connectedClients} ready=${readyClients}`,
      );
    }, this.debounceMs);
  }

  /**
   * Builds the JSON-RPC `selection_changed` payload for the current active
   * editor. Returns undefined when no editor is open or the document's URI
   * scheme is not forwardable (Output panel and other virtual documents are
   * kept out of the TUI file context). Line/character offsets are 1-based to
   * match OpenCode TUI's `offsetToPosition` convention.
   */
  private buildSelectionPayload(): EditorSelectionPayload | undefined {
    const editor = this.activeEditor;
    if (!editor) return undefined;

    const scheme = editor.document.uri.scheme;
    if (!FORWARDABLE_SCHEMES.has(scheme)) {
      this.outputChannel.debug(
        `[IdeContext] Skip selection payload: non-file document (scheme=${scheme})`,
      );
      return undefined;
    }

    const filePath = editor.document.uri.fsPath;
    const sel = editor.selection;
    const text = sel.isEmpty ? "" : editor.document.getText(sel);

    return {
      filePath,
      source: "websocket",
      ranges: [
        {
          text,
          selection: {
            start: {
              line: sel.start.line + 1,
              character: sel.start.character + 1,
            },
            end: {
              line: sel.end.line + 1,
              character: sel.end.character + 1,
            },
          },
        },
      ],
    };
  }

  public getDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
    return this.diagnostics.get(this.getUriKey(uri)) ?? [];
  }

  public dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;

    this.outputChannel.info("ContextManager disposed");
  }

  private getUriKey(uri: vscode.Uri): string {
    return uri.fsPath || uri.path || uri.toString();
  }
}

