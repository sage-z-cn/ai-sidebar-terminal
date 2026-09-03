
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import * as vscode from "vscode";
import { l10n } from "../i18n";
import { ContextSharingService } from "../services/ContextSharingService";
import { InstanceId, InstanceStore } from "../services/InstanceStore";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { TerminalManager } from "../terminals/TerminalManager";
import {
  ALLOWED_IMAGE_TYPES,
  DroppedBlobFile,
  MAX_IMAGE_SIZE,
  WebviewMessage,
} from "../types";
import type { TerminalBackendType } from "../types";
import {
  createSelection,
  fuzzyMatchFile,
  openFileInEditor,
} from "./openFile";
import { toRelativeReference } from "./relativeReference";

export interface MessageRouterProviderBridge {
  startOpenCode(): Promise<void>;
  restart(): void;
  openSettings(): void;
  openKeyboardShortcuts(): void;
  toggleEditorAttachment(): Promise<void>;
  pasteText(text: string): void;
  getActiveInstanceId(): InstanceId;
  getActiveTerminalId(): string;
  setLastKnownTerminalSize(cols: number, rows: number): void;
  getLastKnownTerminalSize(): { cols: number; rows: number };
  isStarted(): boolean;
  resizeActiveTerminal(cols: number, rows: number): void;
  postWebviewMessage(message: unknown): void;
  formatDroppedFiles(paths: string[], useAtSyntax: boolean): string;
  formatPastedImage(tempPath: string): string | undefined;
  launchAiTool(
    sessionId: string,
    toolName: string,
    savePreference: boolean,
  ): Promise<void>;
  showAiToolSelector(
    sessionId: string,
    sessionName: string,
    forceShow?: boolean,
  ): Promise<void>;
}

export class MessageRouter {
  public constructor(
    private readonly provider: MessageRouterProviderBridge,
    private readonly context: vscode.ExtensionContext,
    private readonly terminalManager: TerminalManager,
    private readonly captureManager: OutputCaptureManager,
    _apiClient: OpenCodeApiClient | undefined,
    _contextSharingService: ContextSharingService,
    private readonly logger: OutputChannelService,
    _instanceStore: InstanceStore | undefined,
  ) {}

  public async handleMessage(rawMessage: unknown): Promise<void> {
    if (!rawMessage || typeof rawMessage !== "object") {
      return;
    }

    const message = rawMessage as WebviewMessage;
    switch (message.type) {
      case "terminalInput":
        this.handleTerminalInput(message.data);
        break;
      case "terminalResize":
        this.handleTerminalResize(message.cols, message.rows);
        break;
      case "ready":
        this.handleReady(message.cols, message.rows);
        break;
      case "filesDropped":
        await this.handleFilesDropped(
          message.files ?? [],
          message.shiftKey ?? false,
          message.dropCell,
          message.blobFiles,
        );
        break;
      case "openUrl":
        if (typeof message.url === "string") {
          void vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        break;
      case "openFile":
        if (typeof message.path === "string") {
          void this.handleOpenFile(
            message.path,
            message.line,
            message.endLine,
            message.column,
          );
        }
        break;
      case "listTerminals":
        void this.handleListTerminals();
        break;
      case "setClipboard":
        if (typeof message.text === "string") {
          void this.handleSetClipboard(message.text);
        }
        break;
      case "triggerPaste":
        void this.handlePaste();
        break;
      case "imagePasted":
        if (typeof message.data === "string") {
          void this.handleImagePasted(message.data);
        }
        break;
      case "launchAiTool":
        void this.provider.launchAiTool(
          message.sessionId,
          message.tool,
          message.savePreference,
        );
        break;
      case "requestAiToolSelector": {
        const sessionId = this.provider.getActiveInstanceId();
        void this.provider.showAiToolSelector(sessionId, sessionId, true);
        break;
      }
      case "toggleEditorAttachment":
        await this.provider.toggleEditorAttachment();
        break;
      case "requestRestart":
        this.provider.restart();
        break;
      case "openSettings":
        this.provider.openSettings();
        break;
      case "openKeyboardShortcuts":
        this.provider.openKeyboardShortcuts();
        break;
      default:
        break;
    }
  }

  public handleTerminalInput(data: string | undefined): void {
    if (typeof data !== "string") {
      return;
    }

    this.terminalManager.writeToTerminal(this.provider.getActiveTerminalId(), data);
  }

  public handleTerminalResize(
    cols: number | undefined,
    rows: number | undefined,
  ): void {
    if (typeof cols !== "number" || typeof rows !== "number") {
      return;
    }

    this.provider.setLastKnownTerminalSize(cols, rows);
    this.terminalManager.resizeTerminal(
      this.provider.getActiveTerminalId(),
      cols,
      rows,
    );
  }

  public handleReady(
    cols: number | undefined,
    rows: number | undefined,
  ): void {
    if (typeof cols === "number" && typeof rows === "number") {
      this.provider.setLastKnownTerminalSize(cols, rows);
    }

    if (!this.provider.isStarted()) {
      void this.provider.startOpenCode();
    } else {
      const size = this.provider.getLastKnownTerminalSize();
      if (size.cols && size.rows) {
        this.provider.resizeActiveTerminal(size.cols, size.rows);
      }
    }

    this.provider.postWebviewMessage({
      type: "platformInfo",
      platform: process.platform,
      activeBackend: "native" as TerminalBackendType,
    });
  }

  public async handleOpenFile(
    filePath: string,
    line?: number,
    endLine?: number,
    column?: number,
  ): Promise<void> {
    await openFileInEditor(filePath, line, endLine, column, (message) => {
      this.logger.error(message);
    });
  }

  public async handleFilesDropped(
    files: string[],
    shiftKey: boolean,
    dropCell?: { col: number; row: number },
    blobFiles?: DroppedBlobFile[],
  ): Promise<void> {
    this.logger.info(
      `[PROVIDER] handleFilesDropped - files: ${JSON.stringify(files)} shiftKey: ${shiftKey} dropCell: ${JSON.stringify(dropCell)}`,
    );

    const normalizedFiles = files.map((file) => {
      if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(file)) {
        try {
          return vscode.Uri.parse(file).fsPath;
        } catch {
        }
      }
      return file;
    });

    let dedupedFiles = [
      ...new Set(normalizedFiles.map((p) => path.normalize(p))),
    ];

    if (dedupedFiles.length === 0 && blobFiles && blobFiles.length > 0) {
      const materializedBlobPaths =
        await this.materializeDroppedBlobFiles(blobFiles);
      dedupedFiles = [
        ...new Set(materializedBlobPaths.map((p) => path.normalize(p))),
      ];
    }

    if (dedupedFiles.length === 0) {
      this.logger.warn("[PROVIDER] No usable dropped file paths were resolved");
      return;
    }

    const terminalId = this.provider.getActiveTerminalId();

    if (shiftKey) {
      const fileRefs = this.provider.formatDroppedFiles(
        dedupedFiles.map(toRelativeReference),
        true,
      );
      this.logger.info(`[PROVIDER] Writing with @: ${fileRefs}`);

      this.terminalManager.writeToTerminal(terminalId, fileRefs + " ");
    } else {
      const filePaths = this.provider.formatDroppedFiles(
        dedupedFiles.map(toRelativeReference),
        false,
      );
      this.logger.info(`[PROVIDER] Writing without @: ${filePaths}`);
      this.terminalManager.writeToTerminal(terminalId, filePaths + " ");
    }
  }

  public async handlePaste(): Promise<void> {
    try {
      const text = await vscode.env.clipboard.readText();
      if (text) {
        this.provider.pasteText(text);
        return;
      }
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // No text in clipboard — delegate to webview for image detection.
    // The webview will try navigator.clipboard.read() and send
    // imagePasted if an image is found.  We do NOT fall back to
    // triggerPaste from the webview to avoid an infinite loop.
    this.provider.postWebviewMessage({ type: "requestPaste" });
  }

  public async handleSetClipboard(text: string): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(text);
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to write clipboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async handleImagePasted(data: string): Promise<void> {
    try {
      const parsedDataUrl = this.parseDataUrl(data);
      if (!parsedDataUrl) {
        this.logger.error("[TerminalProvider] Invalid image data URL format");
        return;
      }

      const { mimeType, buffer } = parsedDataUrl;
      if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
        this.logger.error(
          `[TerminalProvider] Unsupported image type: ${mimeType}`,
        );
        return;
      }

      if (buffer.length > MAX_IMAGE_SIZE) {
        this.logger.error("[TerminalProvider] Image exceeds 10MB size limit");
        return;
      }

      const extension = mimeType.split("/")[1];
      const tmpPath = await this.writeSecureTempFile(
        `opencode-clipboard-${randomUUID()}.${extension}`,
        buffer,
      );

      const formattedImage = this.provider.formatPastedImage(tmpPath);
      if (formattedImage) {
        this.provider.pasteText(formattedImage);
      }

      this.scheduleTempFileCleanup(tmpPath);
    } catch (error) {
      this.logger.error(
        `[TerminalProvider] Failed to handle pasted image: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parseDataUrl(
    data: string,
  ): { mimeType: string; buffer: Buffer } | undefined {
    const base64Match = data.match(
      /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/,
    );
    if (!base64Match) {
      return undefined;
    }

    return {
      mimeType: base64Match[1],
      buffer: Buffer.from(base64Match[2], "base64"),
    };
  }

  private sanitizeDroppedBlobFileName(name: string): string {
    const baseName = name.split(/[\\/]/).pop()?.trim() || "dropped-file";
    const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return sanitized.length > 0 ? sanitized : "dropped-file";
  }

  private async writeSecureTempFile(
    fileName: string,
    buffer: Buffer,
  ): Promise<string> {
    const tmpPath = path.join(os.tmpdir(), fileName);
    await fs.promises.writeFile(tmpPath, buffer, {
      flag: "wx",
      mode: 0o600,
    });
    return tmpPath;
  }

  private scheduleTempFileCleanup(tmpPath: string): void {
    setTimeout(
      async () => {
        try {
          await fs.promises.unlink(tmpPath);
          this.logger.debug(
            `[TerminalProvider] Cleaned up temp file: ${tmpPath}`,
          );
        } catch (err) {
          this.logger.warn(
            `[TerminalProvider] Failed to cleanup temp file: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
      5 * 60 * 1000,
    );
  }

  private async materializeDroppedBlobFiles(
    blobFiles: DroppedBlobFile[],
  ): Promise<string[]> {
    const materializedPaths: string[] = [];

    for (const blobFile of blobFiles) {
      try {
        const parsedDataUrl = this.parseDataUrl(blobFile.data);
        if (!parsedDataUrl) {
          this.logger.error(
            `[TerminalProvider] Invalid dropped blob data URL for ${blobFile.name}`,
          );
          continue;
        }

        if (parsedDataUrl.buffer.length > MAX_IMAGE_SIZE) {
          this.logger.error(
            `[TerminalProvider] Dropped file exceeds 10MB size limit: ${blobFile.name}`,
          );
          continue;
        }

        const safeName = this.sanitizeDroppedBlobFileName(blobFile.name);
        const tmpPath = await this.writeSecureTempFile(
          `opencode-drop-${randomUUID()}-${safeName}`,
          parsedDataUrl.buffer,
        );
        this.scheduleTempFileCleanup(tmpPath);
        materializedPaths.push(tmpPath);
      } catch (error) {
        this.logger.error(
          `[TerminalProvider] Failed to materialize dropped blob ${blobFile.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return materializedPaths;
  }

  public async handleListTerminals(): Promise<void> {
    const terminals = await this.getTerminalEntries();
    this.provider.postWebviewMessage({
      type: "terminalList",
      terminals,
    });
  }

  public async sendCommandToTerminal(
    terminal: vscode.Terminal,
    command: string,
  ): Promise<void> {
    const configKey = "ai-sidebar-terminal.allowTerminalCommands";
    const allowed = this.context.globalState.get<boolean>(configKey);

    if (allowed) {
      terminal.sendText(command);
      return;
    }

    const result = await vscode.window.showInformationMessage(
      l10n.t("Allow OpenCode to send commands to external terminals?"),
      l10n.t("Yes"),
      l10n.t("Yes, don't ask again"),
      l10n.t("No"),
    );

    if (result === l10n.t("Yes")) {
      terminal.sendText(command);
      return;
    }

    if (result === l10n.t("Yes, don't ask again")) {
      await this.context.globalState.update(configKey, true);
      terminal.sendText(command);
    }
  }

  public startTerminalCapture(
    terminal: vscode.Terminal,
    terminalName: string,
  ): void {
    const result = this.captureManager.startCapture(terminal);
    if (result.success) {
      void vscode.window.showInformationMessage(
        l10n.t("Started capturing terminal: {terminalName}", { terminalName }),
      );
      return;
    }

    void vscode.window.showErrorMessage(
      l10n.t("Failed to start capture: {error}", { error: result.error ?? "Unknown error" }),
    );
  }

  public async getTerminalEntries(): Promise<
    Array<{ name: string; cwd: string }>
  > {
    const entries: Array<{ name: string; cwd: string }> = [];

    for (const terminal of vscode.window.terminals) {
      if (terminal.name === "Open Sidebar Terminal") {
        continue;
      }

      let cwd = "";
      try {
        cwd = terminal.shellIntegration?.cwd?.fsPath ?? "";
      } catch {
        cwd = "";
      }

      entries.push({
        name: terminal.name,
        cwd,
      });
    }

    return entries;
  }

  public createSelection(
    line?: number,
    endLine?: number,
    column?: number,
  ): vscode.Range | undefined {
    return createSelection(line, endLine, column);
  }

  public async fuzzyMatchFile(filePath: string): Promise<vscode.Uri | null> {
    return fuzzyMatchFile(filePath, (message) => {
      this.logger.error(message);
    });
  }
}
