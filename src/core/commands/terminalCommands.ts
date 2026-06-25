import * as vscode from "vscode";
import { l10n } from "../../i18n";
import type { TerminalProvider } from "../../providers/TerminalProvider";
import type { ContextSharingService } from "../../services/ContextSharingService";
import type { OutputChannelService } from "../../services/OutputChannelService";
import type { TerminalManager } from "../../terminals/TerminalManager";

let fileSendAccumulator: vscode.Uri[] = [];
let fileSendTimeout: NodeJS.Timeout | undefined;

/**
 * Argument shape VS Code passes to commands contributed to
 * `editor/title/context` (the editor tab right-click menu). Only `groupId`
 * is guaranteed; the rest is best-effort. VS Code's internal editor group
 * IDs are not exposed via the extension API, so we fall back to the active
 * text editor's document when we cannot resolve the exact tab.
 */
interface EditorCommandsContext {
  readonly groupId?: unknown;
  readonly editorIndex?: unknown;
}

function isEditorCommandsContext(value: unknown): value is EditorCommandsContext {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as EditorCommandsContext).groupId === "number"
  );
}

/**
 * Resolves file URIs from the heterogeneous argument shapes VS Code passes
 * to `ai-sidebar-terminal.sendToAiTerminal` across its menu locations:
 *
 * - `explorer/context`: `("ignored", [uri1, uri2])` — selected resources.
 * - Command palette / API: `(uri)` — a single URI passed directly.
 * - `editor/title/context`: `({ groupId, editorIndex })` — tab context. The
 *   internal groupId cannot be mapped to a `vscode.window.tabGroups` entry,
 *   so we resolve the active text editor's document as the best available
 *   target.
 *
 * The `editor/context` menu does not use this command (it invokes
 * `sendAtMention`, which carries selection line numbers); when this command
 * is invoked with no recognisable args it returns an empty array.
 *
 * Returns an empty array when no URI can be derived, which lets the caller
 * short-circuit cleanly.
 */
function extractUrisFromSendArgs(args: unknown[]): vscode.Uri[] {
  if (args.length > 0 && Array.isArray(args[args.length - 1])) {
    const last = args[args.length - 1] as unknown[];
    if (last.length > 0 && last.every((u) => u instanceof vscode.Uri)) {
      return last as vscode.Uri[];
    }
  }

  if (args.length > 0 && args[0] instanceof vscode.Uri) {
    return [args[0]];
  }

  if (args.length > 0 && isEditorCommandsContext(args[0])) {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    return activeUri ? [activeUri] : [];
  }

  return [];
}

export interface TerminalCommandDependencies {
  provider: TerminalProvider | undefined;
  terminalManager: TerminalManager | undefined;
  contextSharingService: ContextSharingService | undefined;
  outputChannel: OutputChannelService | undefined;
  getActiveTerminalId: () => string;
  sendTerminalCwd: () => void;
  sendPrompt: (prompt: string) => Promise<void>;
}

function focusSidebarIfConfigured(
  provider: TerminalProvider | undefined,
): void {
  const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
  if (config.get<boolean>("autoFocusOnSend", true)) {
    vscode.commands.executeCommand("ai-sidebar-terminal.focus");
    setTimeout(() => {
      provider?.focus();
    }, 100);
  }
}

export function registerTerminalCommands(
  deps: TerminalCommandDependencies,
): vscode.Disposable[] {
  const startCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.start",
    () => {
      deps.provider?.startOpenCode();
    },
  );

  const sendToTerminalCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.sendToTerminal",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return;
      }

      const selectedText = editor.document.getText(editor.selection);
      const terminalId = deps.getActiveTerminalId();
      deps.outputChannel?.info(
        `[DIAG:sendToTerminal] terminalId="${terminalId}" textLength=${selectedText.length}`,
      );
      void deps.sendPrompt(selectedText + "\n");
      focusSidebarIfConfigured(deps.provider);
    },
  );

  const sendAtMentionCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.sendAtMention",
    () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        deps.outputChannel?.warn("[DIAG:sendAtMention] skipped — editor missing");
        deps.sendTerminalCwd();
        return;
      }

      const fileRef = deps.provider?.formatEditorReference(editor);
      if (!fileRef) {
        deps.outputChannel?.warn(
          `[DIAG:sendAtMention] skipped — provider=${!!deps.provider}`,
        );
        deps.sendTerminalCwd();
        return;
      }

      const terminalId = deps.getActiveTerminalId();
      deps.outputChannel?.info(
        `[DIAG:sendAtMention] terminalId="${terminalId}" fileRef="${fileRef}"`,
      );
      void deps.sendPrompt(fileRef + " ");
      focusSidebarIfConfigured(deps.provider);
    },
  );

  const sendAllOpenFilesCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.sendAllOpenFiles",
    () => {
      const fileRefs: string[] = [];

      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (tab.input instanceof vscode.TabInputText) {
            const uri = tab.input.uri;
            if (!uri.scheme.startsWith("untitled") && deps.provider) {
              fileRefs.push(deps.provider.formatUriReference(uri));
            }
          }
        }
      }

      const openFiles = fileRefs.join(" ");
      if (openFiles) {
        const terminalId = deps.getActiveTerminalId();
        deps.outputChannel?.info(
          `[DIAG:sendAllOpenFiles] terminalId="${terminalId}" fileCount=${fileRefs.length} refs="${openFiles}"`,
        );
        void deps.sendPrompt(openFiles + " ");
        focusSidebarIfConfigured(deps.provider);
      }
    },
  );

  const sendToAiTerminalCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.sendToAiTerminal",
    (...args: unknown[]) => {
      if (!deps.contextSharingService) {
        return;
      }

      const uris = extractUrisFromSendArgs(args);
      if (uris.length === 0) {
        return;
      }

      fileSendAccumulator.push(...uris);

      if (fileSendTimeout) {
        clearTimeout(fileSendTimeout);
      }

      fileSendTimeout = setTimeout(() => {
        if (fileSendAccumulator.length === 0) {
          return;
        }

        const provider = deps.provider;
        if (!provider) {
          fileSendAccumulator = [];
          return;
        }

        const uniqueUris = [
          ...new Map(
            fileSendAccumulator.map((u: vscode.Uri) => [u.fsPath, u]),
          ).values(),
        ];

        const fileRefs = uniqueUris.map((u: vscode.Uri) =>
          provider.formatUriReference(u),
        );
        const allRefs = fileRefs.join(" ");

        const terminalId = deps.getActiveTerminalId();
        deps.outputChannel?.info(
          `[DIAG:sendToAiTerminal] terminalId="${terminalId}" fileCount=${uniqueUris.length} refs="${allRefs}"`,
        );
        void deps.sendPrompt(allRefs + " ");

        focusSidebarIfConfigured(deps.provider);
        fileSendAccumulator = [];
      }, 100);
    },
  );

  const pasteCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.paste",
    async () => {
      try {
        if (deps.provider) {
          deps.provider.requestPaste();
        }
      } catch (error) {
        deps.outputChannel?.error(
          `[TerminalProvider] Failed to paste: ${error instanceof Error ? error.message : String(error)}`,
        );
        vscode.window.showErrorMessage(l10n.t("Failed to paste from clipboard"));
      }
    },
  );

  const focusCommand = vscode.commands.registerCommand(
    "ai-sidebar-terminal.focus",
    () => {
      return vscode.commands.executeCommand(
        "workbench.view.focus",
        "ai-sidebar-terminal-view",
      );
    },
  );

  return [
    startCommand,
    sendToTerminalCommand,
    sendAtMentionCommand,
    sendAllOpenFilesCommand,
    sendToAiTerminalCommand,
    pasteCommand,
    focusCommand,
  ];
}

