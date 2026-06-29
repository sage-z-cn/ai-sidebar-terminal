import * as vscode from "vscode";
import { OutputChannelService } from "./OutputChannelService";
import { FileReferenceManager } from "./FileReferenceManager";
import type { IdeContextServer } from "./ideContext/IdeContextServer";
import type { EditorSelectionPayload } from "./ideContext/protocol";

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

      // Forward to OpenCode TUI when the editor-context WS is active.
      // Only forward when our own server is running — when Claude Code's
      // extension is serving the WS, it already pushes its own events and we
      // must stay out of the way to avoid duplicate/conflicting notifications.
      if (this.ideContextServer?.isRunning()) {
        const payload = this.buildSelectionPayload();
        if (payload) {
          this.ideContextServer.notifySelectionChanged(payload);
        }
      }
    }, this.debounceMs);
  }

  /**
   * Builds the JSON-RPC `selection_changed` payload for the current active
   * editor. Returns undefined when no editor is open. Line/character offsets
   * are 1-based to match OpenCode TUI's `offsetToPosition` convention.
   */
  private buildSelectionPayload(): EditorSelectionPayload | undefined {
    const editor = this.activeEditor;
    if (!editor) return undefined;

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

