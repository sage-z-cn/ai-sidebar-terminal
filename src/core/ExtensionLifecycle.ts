import * as vscode from "vscode";
import { l10n } from "../i18n";
import { TerminalProvider } from "../providers/TerminalProvider";
import { OpenCodeCodeActionProvider } from "../providers/CodeActionProvider";
import { TerminalManager } from "../terminals/TerminalManager";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { ContextManager } from "../services/ContextManager";
import { OutputChannelService } from "../services/OutputChannelService";
import { InstanceDiscoveryService } from "../services/InstanceDiscoveryService";
import { OpenCodeApiClient } from "../services/OpenCodeApiClient";
import { InstanceStore } from "../services/InstanceStore";
import { InstanceRegistry } from "../services/InstanceRegistry";
import { InstanceQuickPick } from "../services/InstanceQuickPick";
import { InstanceController } from "../services/InstanceController";
import { NativeTerminalManager } from "../services/NativeTerminalManager";
import { PortManager } from "../services/PortManager";
import { ConnectionResolver } from "../services/ConnectionResolver";
import {
  TerminalBackendRegistry,
} from "../services/terminalBackends";
import {
  registerCommands as registerAllCommands,
  type RegisterCommandDependencies,
} from "./commands";

/**
 * Manages extension activation, service initialization, and cleanup.
 */
export class ExtensionLifecycle {
  private terminalManager: TerminalManager | undefined;
  private tuiProvider: TerminalProvider | undefined;
  private captureManager: OutputCaptureManager | undefined;
  private contextSharingService: ContextSharingService | undefined;
  private outputChannelService: OutputChannelService | undefined;
  private contextManager: ContextManager | undefined;
  private instanceDiscoveryService: InstanceDiscoveryService | undefined;
  private codeActionProvider: OpenCodeCodeActionProvider | undefined;
  private instanceStore: InstanceStore | undefined;
  private instanceRegistry: InstanceRegistry | undefined;
  private instanceQuickPick: InstanceQuickPick | undefined;
  private instanceController: InstanceController | undefined;
  private portManager: PortManager | undefined;
  private backendRegistry: TerminalBackendRegistry | undefined;
  private activated = false;
  private tuiProviderRegistration: vscode.Disposable | undefined;
  private context?: vscode.ExtensionContext;

  private static readonly TERMINAL_ID = "ai-sidebar-terminal-main";

  /** Returns the terminal ID for the active instance, falling back to the static default. */
  private getActiveTerminalId(): string {
    try {
      const active = this.instanceStore?.getActive();
      if (active?.runtime.terminalKey) {
        this.outputChannelService?.info(
          `[DIAG:getActiveTerminalId] resolved terminalKey="${active.runtime.terminalKey}" for instance="${active.config.id}"`,
        );
        return active.runtime.terminalKey;
      }
      if (active) {
        this.outputChannelService?.warn(
          `[DIAG:getActiveTerminalId] NO terminalKey for instance="${active.config.id}", falling back to config.id="${active.config.id}"`,
        );
        return active.config.id;
      }
      this.outputChannelService?.warn(
        `[DIAG:getActiveTerminalId] NO active instance, falling back to TERMINAL_ID="${ExtensionLifecycle.TERMINAL_ID}"`,
      );
      return ExtensionLifecycle.TERMINAL_ID;
    } catch (err) {
      this.outputChannelService?.error(
        `[DIAG:getActiveTerminalId] ERROR: ${err instanceof Error ? err.message : String(err)}`,
      );
      return ExtensionLifecycle.TERMINAL_ID;
    }
  }

  async activate(context: vscode.ExtensionContext): Promise<void> {
    this.context = context;
    const logger = OutputChannelService.getInstance();
    if (this.activated) {
      logger.warn(
        "[ExtensionLifecycle] activate() called while already active - skipping to prevent double provider registration",
      );
      return;
    }
    this.activated = true;
    logger.info("Initializing AI Sidebar Terminal...");

    // One-time setup on fresh install: auto-enable sendKeybindingsToShell
    // so Ctrl+P / Ctrl+other keys go to the sidebar opencode terminal immediately.
    await this.ensureSendKeybindingsToShellDefault();

    try {
      this.terminalManager = new TerminalManager();

      this.captureManager = new OutputCaptureManager();
      this.contextSharingService = new ContextSharingService();
      this.outputChannelService = logger;
      this.contextManager = new ContextManager(this.outputChannelService);
      this.instanceDiscoveryService = new InstanceDiscoveryService();

      this.instanceStore = new InstanceStore();
      this.portManager = PortManager.getInstance(this.instanceStore);

      this.backendRegistry = new TerminalBackendRegistry();
      const nativeTerminalManager = new NativeTerminalManager(logger);
      this.instanceRegistry = new InstanceRegistry(context);
      this.instanceRegistry.hydrate(this.instanceStore);

      context.subscriptions.push(this.contextManager);
      context.subscriptions.push(this.instanceDiscoveryService);
      this.instanceQuickPick = new InstanceQuickPick(
        this.instanceStore,
        this.instanceDiscoveryService,
      );

      const connectionResolver = new ConnectionResolver(
        this.instanceStore,
        this.instanceDiscoveryService,
        undefined,
        logger,
      );
      this.instanceController = new InstanceController(
        this.terminalManager,
        this.instanceStore,
        this.portManager,
        logger,
        connectionResolver,
      );

      context.subscriptions.push(
        vscode.window.onDidCloseTerminal((terminal) => {
          this.captureManager?.cleanup(terminal);
        }),
      );

      this.tuiProvider = new TerminalProvider(
        context,
        this.terminalManager,
        this.captureManager,
        this.portManager,
        this.instanceStore,
        this.backendRegistry,
        nativeTerminalManager,
      );

      this.tuiProviderRegistration?.dispose();
      this.tuiProviderRegistration = undefined;
      try {
        const providerRegistration = vscode.window.registerWebviewViewProvider(
          TerminalProvider.viewType,
          this.tuiProvider,
          {
            webviewOptions: {
              retainContextWhenHidden: true,
            },
          },
        );
        this.tuiProviderRegistration = providerRegistration;
        context.subscriptions.push(providerRegistration);
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes("already registered")
        ) {
          logger.warn(
            `[ExtensionLifecycle] ${TerminalProvider.viewType} provider already registered — prior activation still active. Terminal will attach on next view reveal.`,
          );
        } else {
          throw err;
        }
      }

      this.registerCommands(context);

      this.codeActionProvider = new OpenCodeCodeActionProvider(
        this.contextManager,
        (prompt) => this.sendPromptToOpenCode(prompt),
      );

      const codeActionRegistration =
        vscode.languages.registerCodeActionsProvider(
          "*",
          this.codeActionProvider,
          {
            providedCodeActionKinds:
              OpenCodeCodeActionProvider.providedCodeActionKinds,
          },
        );
      const explainAndFixCommand = this.codeActionProvider.registerCommand();
      context.subscriptions.push(codeActionRegistration, explainAndFixCommand);

      // Expose that the extension is fully active so editor/title buttons
      // only appear after commands are registered. This prevents
      // "command not found" errors.
      await vscode.commands.executeCommand("setContext", "ai-sidebar-terminal.active", true);

      logger.info("AI Sidebar Terminal activated successfully");
    } catch (error) {
      logger.error(
        `Failed to activate AI Sidebar Terminal: ${error instanceof Error ? error.message : String(error)}`,
      );
      vscode.window.showErrorMessage(
        l10n.t("Failed to activate AI Sidebar Terminal: {error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  private getCommandDependencies(): RegisterCommandDependencies {
    const self = this;
    return {
      get provider() {
        return self.tuiProvider;
      },
      get terminalManager() {
        return self.terminalManager;
      },
      get contextSharingService() {
        return self.contextSharingService;
      },
      get contextManager() {
        return self.contextManager;
      },
      get outputChannel() {
        return self.outputChannelService;
      },
      getActiveTerminalId: () => this.getActiveTerminalId(),
      sendTerminalCwd: () => this.sendTerminalCwd(),
      sendPrompt: (prompt: string) =>
        this.tuiProvider?.sendPrompt(prompt) ?? Promise.resolve(),
    };
  }

  private registerCommands(context: vscode.ExtensionContext): void {
    registerAllCommands(context, this.getCommandDependencies());
  }

  private async sendPromptToOpenCode(prompt: string): Promise<void> {
    if (!this.tuiProvider || !this.terminalManager) {
      throw new Error("OpenCode provider is not initialized");
    }

    if (!this.terminalManager.getTerminal(this.getActiveTerminalId())) {
      const sentByDiscovery =
        await this.trySendPromptViaDiscoveredInstance(prompt);
      if (sentByDiscovery) {
        return;
      }

      await this.tuiProvider.startOpenCode();
    }

    const apiClient = this.tuiProvider.getApiClient();
    if (apiClient && this.tuiProvider.isHttpAvailable()) {
      try {
        await apiClient.appendPrompt(prompt);
      } catch (error) {
        this.outputChannelService?.warn(
          `Failed to send prompt via HTTP API, falling back to terminal input: ${error instanceof Error ? error.message : String(error)}`,
        );
        this.terminalManager.writeToTerminal(
          this.getActiveTerminalId(),
          `${prompt}\n`,
        );
      }
    } else {
      this.terminalManager.writeToTerminal(
        this.getActiveTerminalId(),
        `${prompt}\n`,
      );
    }

    const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("ai-sidebar-terminal.focus");
      setTimeout(() => {
        if (typeof this.tuiProvider?.focus === "function") {
          this.tuiProvider.focus();
        }
      }, 100);
    }
  }

  private async trySendPromptViaDiscoveredInstance(
    prompt: string,
  ): Promise<boolean> {
    if (!this.instanceDiscoveryService) {
      return false;
    }

    try {
      const discovered =
        await this.instanceDiscoveryService.discoverInstances();
      const primary = discovered[0];
      if (!primary) {
        return false;
      }

      const client = new OpenCodeApiClient(
        primary.port,
        3,
        200,
        3000,
        // OpenCode >=1.x requires x-opencode-directory on instance-scoped
        // routes like /tui/append-prompt. Fall back to workspace folder, or
        // omit (server uses its own cwd) when no folder is open.
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      );
      await client.appendPrompt(prompt);
      this.outputChannelService?.info(
        `Sent prompt via discovered OpenCode instance on port ${primary.port}`,
      );
      return true;
    } catch (error) {
      this.outputChannelService?.warn(
        `Failed to send prompt via discovered instance: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private sendTerminalCwd(): void {
    const activeTerminal = vscode.window.activeTerminal;
    if (!activeTerminal) {
      vscode.window.showWarningMessage(l10n.t("No active terminal"));
      return;
    }

    const cwd = activeTerminal.shellIntegration?.cwd?.fsPath;
    if (!cwd) {
      vscode.window.showWarningMessage(
        l10n.t(
          "Could not determine terminal working directory. Make sure shell integration is enabled.",
        ),
      );
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    const reference =
      workspaceFolders && workspaceFolders.length > 0
        ? `@${vscode.workspace.asRelativePath(cwd, false)}`
        : `@${cwd}`;

    this.terminalManager?.writeToTerminal(
      this.getActiveTerminalId(),
      reference + " ",
    );

    const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
    if (config.get<boolean>("autoFocusOnSend", true)) {
      vscode.commands.executeCommand("ai-sidebar-terminal.focus");
      setTimeout(() => {
        if (typeof this.tuiProvider?.focus === "function") {
          this.tuiProvider.focus();
        }
      }, 100);
    }
  }

  async deactivate(): Promise<void> {
    this.outputChannelService?.info("Deactivating AI Sidebar Terminal...");
    this.activated = false;

    if (this.tuiProviderRegistration) {
      this.tuiProviderRegistration.dispose();
      this.tuiProviderRegistration = undefined;
    }

    if (this.tuiProvider) {
      this.tuiProvider.dispose();
      this.tuiProvider = undefined;
    }

    if (this.terminalManager) {
      this.terminalManager.dispose();
      this.terminalManager = undefined;
    }

    const logger = this.outputChannelService;

    if (this.outputChannelService) {
      this.outputChannelService.dispose();
      this.outputChannelService = undefined;
      OutputChannelService.resetInstance();
    }

    if (this.contextManager) {
      this.contextManager.dispose();
      this.contextManager = undefined;
    }

    if (this.instanceDiscoveryService) {
      this.instanceDiscoveryService.dispose();
      this.instanceDiscoveryService = undefined;
    }

    if (this.instanceRegistry) {
      this.instanceRegistry.dispose();
      this.instanceRegistry = undefined;
    }

    if (this.instanceStore) {
      this.instanceStore = undefined;
    }

    this.codeActionProvider = undefined;

    this.captureManager = undefined;
    this.contextSharingService = undefined;

    // Clear the context key so editor/title buttons disappear cleanly
    try {
      await vscode.commands.executeCommand("setContext", "ai-sidebar-terminal.active", false);
    } catch {
      // intentionally empty: setContext during deactivation is best-effort
    }

    logger?.info("AI Sidebar Terminal deactivated");
  }

  /**
   * On first installation / activation, automatically enable
   * `sendKeybindingsToShell` so that Ctrl+P and other TUI shortcuts
   * work immediately in the sidebar terminal without the user having
   * to manually edit settings.
   */
  private async ensureSendKeybindingsToShellDefault(): Promise<void> {
    if (!this.context) return;

    const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
    const inspect = config.inspect<boolean>("sendKeybindingsToShell");

    const userHasExplicitValue =
      inspect?.globalValue !== undefined ||
      inspect?.workspaceValue !== undefined ||
      inspect?.workspaceFolderValue !== undefined;

    if (userHasExplicitValue) {
      return;
    }

    const alreadyAutoEnabled = this.context.globalState.get<boolean>(
      "ai-sidebar-terminal.hasAutoEnabledKeybindings",
      false,
    );

    if (alreadyAutoEnabled) {
      return;
    }

    try {
      await config.update(
        "sendKeybindingsToShell",
        true,
        vscode.ConfigurationTarget.Global,
      );
      await this.context.globalState.update(
        "ai-sidebar-terminal.hasAutoEnabledKeybindings",
        true,
      );

      this.outputChannelService?.info(
        "[ExtensionLifecycle] Automatically enabled 'sendKeybindingsToShell: true' on first install so Ctrl+P / TUI keys work in the sidebar terminal out of the box.",
      );
    } catch (err) {
      this.outputChannelService?.warn(
        `[ExtensionLifecycle] Failed to auto-enable sendKeybindingsToShell: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
