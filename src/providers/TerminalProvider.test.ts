import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeApi from "vscode";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { InstanceStore } from "../services/InstanceStore";
import { OutputChannelService } from "../services/OutputChannelService";
import { PortManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "./TerminalProvider";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
    promises: {
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  promises: {
    writeFile: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  },
}));

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);
await vi.importActual<typeof nodePtyTypes>("../test/mocks/node-pty");

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("TerminalProvider", () => {
  let terminalManager: TerminalManager;
  let captureManager: OutputCaptureManager;
  let provider: TerminalProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
    terminalManager = new TerminalManager();
    captureManager = new OutputCaptureManager();
    vscode.workspace.workspaceFolders = undefined;
  });

  afterEach(() => {
    provider?.dispose();
    terminalManager.dispose();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
  });

  function mockConfiguration(options?: {
    autoStartOnOpen?: boolean;
    enableHttpApi?: boolean;
    defaultAiTool?: string;
    aiTools?: readonly unknown[];
    promptAiToolOnSession?: boolean;
    focusIndicatorMode?: string;
    focusIndicatorBorderWidth?: number;
  }) {
    const {
      autoStartOnOpen = false,
      enableHttpApi = false,
      defaultAiTool = "opencode",
      aiTools = [{ name: "opencode", label: "OpenCode", command: "opencode" }],
      promptAiToolOnSession = true,
      focusIndicatorMode = "off",
      focusIndicatorBorderWidth,
    } = options ?? {};

    const configuration = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "autoStartOnOpen") {
          return autoStartOnOpen;
        }
        if (key === "enableHttpApi") {
          return enableHttpApi;
        }
        if (key === "defaultAiTool") {
          return defaultAiTool;
        }
        if (key === "aiTools") {
          return aiTools;
        }
        if (key === "httpTimeout") {
          return 5000;
        }
        if (key === "logLevel") {
          return "error";
        }
        if (key === "promptAiToolOnSession") {
          return promptAiToolOnSession;
        }
        if (key === "focusIndicatorMode") {
          return focusIndicatorMode;
        }
        if (key === "focusIndicatorBorderWidth") {
          return focusIndicatorBorderWidth ?? defaultValue;
        }
        return defaultValue;
      }),
      update: vi.fn(),
    };

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
      configuration as any,
    );

    return configuration;
  }

  function createProvider(options?: {
    instanceStore?: InstanceStore;
  }): TerminalProvider {
    const context = new vscode.ExtensionContext();
    const portManager = PortManager.getInstance(options?.instanceStore);
    return new TerminalProvider(
      context as any,
      terminalManager,
      captureManager,
      portManager,
      options?.instanceStore,
    );
  }

  function resolveProvider(target: TerminalProvider) {
    const view = vscode.WebviewView() as any;
    target.resolveWebviewView(view, {} as any, {} as any);
    const messageHandler = vi.mocked(view.webview.onDidReceiveMessage).mock
      .calls[0]?.[0] as (message: any) => void;

    return { view, messageHandler };
  }

  async function flushAsyncStartup(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  function getTerminalConfigMessages(view: { webview: any }): any[] {
    return vi.mocked(view.webview.postMessage).mock.calls
      .filter((c: unknown[]) => c[0] && (c[0] as any).type === "terminalConfig")
      .map((c: unknown[]) => c[0] as any);
  }

  function getConfigurationChangeListener(): (event: {
    affectsConfiguration: (section: string) => boolean;
  }) => void {
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock
      .calls[0]?.[0];
    expect(listener).toBeTypeOf("function");
    return listener as (event: {
      affectsConfiguration: (section: string) => boolean;
    }) => void;
  }

  it("constructs without instance store and resolves a webview view", () => {
    mockConfiguration();
    provider = createProvider();

    const { view } = resolveProvider(provider);

    expect(view.webview.html).toBeDefined();
    expect(view.webview.onDidReceiveMessage).toBeDefined();
  });

  it("writes html containing terminal container to the resolved webview", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);

    expect(view.webview.html).toContain("terminal-container");
    expect(view.webview.html).toContain("webview.js");
  });

  it("does not start restorable disconnected process on webview view resolve", async () => {
    mockConfiguration({ autoStartOnOpen: false });
    const instanceStore = new InstanceStore();
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    provider = createProvider({ instanceStore });
    resolveProvider(provider);
    await flushAsyncStartup();

    expect((provider as any).isStarted()).toBe(false);
  });

  it("posts platformInfo with native backend type to the webview", () => {
    mockConfiguration();
    provider = createProvider();
    const { view, messageHandler } = resolveProvider(provider);

    messageHandler({ type: "ready", cols: 80, rows: 24 });

    const call = vi.mocked(view.webview.postMessage).mock.calls.find(
      (c: unknown[]) => c[0] && (c[0] as any).type === "platformInfo",
    );
    const message = call?.[0] as any;

    expect(message).toBeDefined();
    expect(message.activeBackend).toBe("native");
    expect(message.platform).toBeDefined();
  });

  it("routes launchAiTool messages through the provider path", async () => {
    mockConfiguration({ enableHttpApi: false });
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const launchSpy = vi.spyOn(provider, "launchAiTool").mockResolvedValue();

    messageHandler({
      type: "launchAiTool",
      sessionId: "default",
      tool: "codex",
      savePreference: true,
    });

    expect(launchSpy).toHaveBeenCalledWith("default", "codex", true);
  });

  it("routes restart messages through provider restart path", () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);
    const restartSpy = vi.fn();
    (provider as any).restart = restartSpy;

    messageHandler({ type: "requestRestart" });

    expect(restartSpy).toHaveBeenCalledTimes(1);
  });

  it("routes openSettings messages to open the settings", () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "openSettings" });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openSettings",
      "ai-sidebar-terminal.",
    );
  });

  it("routes openKeyboardShortcuts messages", () => {
    mockConfiguration();
    provider = createProvider();
    const { messageHandler } = resolveProvider(provider);

    messageHandler({ type: "openKeyboardShortcuts" });

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      "workbench.action.openGlobalKeybindings",
      "@ext:sagez.ai-sidebar-terminal",
    );
  });

  it("saves tool preference via config when saving is requested", async () => {
    mockConfiguration({ enableHttpApi: false });
    provider = createProvider();
    await provider.launchAiTool("default", "claude", true);

    expect(vscode.workspace.getConfiguration().update).toHaveBeenCalledWith(
      "defaultAiTool",
      "claude",
      expect.any(Number),
    );
  });

  it("posts default activeSession state with native backend when no tool is active", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);

    const messages = vi.mocked(view.webview.postMessage).mock.calls
      .filter((c: unknown[]) => c[0] && (c[0] as any).type === "activeSession")
      .map((c: unknown[]) => c[0] as any);

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].backend).toBe("native");
  });

  it("disposes cleanly and resets started state", () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);

    provider.dispose();

    expect((provider as any).isStarted()).toBe(false);
  });

  it("handles requestAiToolSelector by showing the tool selector", () => {
    mockConfiguration();
    provider = createProvider();
    const { view, messageHandler } = resolveProvider(provider);
    const previousMessages = vi.mocked(view.webview.postMessage).mock.calls.length;

    messageHandler({ type: "requestAiToolSelector" });
    const newMessages = vi.mocked(view.webview.postMessage).mock.calls.length;
    expect(newMessages).toBeGreaterThan(previousMessages);
  });

  it("ignores unknown message types without side effects", () => {
    mockConfiguration();
    provider = createProvider();
    const { view, messageHandler } = resolveProvider(provider);
    const previousMessages = vi.mocked(view.webview.postMessage).mock.calls.length;

    messageHandler({ type: "unknown-message-type" });

    expect(vi.mocked(view.webview.postMessage).mock.calls.length).toBe(previousMessages);
  });

  it("posts terminalConfig with default focus indicator settings", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);

    const messages = getTerminalConfigMessages(view);

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[messages.length - 1].focusIndicatorMode).toBe("off");
    expect(messages[messages.length - 1].focusIndicatorBorderWidth).toBe(2);
  });

  it("posts terminalConfig with custom focus indicator settings", () => {
    mockConfiguration({
      focusIndicatorMode: "fullBorder",
      focusIndicatorBorderWidth: 5,
    });
    provider = createProvider();
    const { view } = resolveProvider(provider);

    const messages = getTerminalConfigMessages(view);

    expect(messages[messages.length - 1].focusIndicatorMode).toBe("fullBorder");
    expect(messages[messages.length - 1].focusIndicatorBorderWidth).toBe(5);
  });

  it("clamps focus indicator border width to the minimum of 1", () => {
    mockConfiguration({ focusIndicatorBorderWidth: 0 });
    provider = createProvider();
    const { view } = resolveProvider(provider);

    const messages = getTerminalConfigMessages(view);

    expect(messages[messages.length - 1].focusIndicatorBorderWidth).toBe(1);
  });

  it("clamps focus indicator border width to the maximum of 8", () => {
    mockConfiguration({ focusIndicatorBorderWidth: 99 });
    provider = createProvider();
    const { view } = resolveProvider(provider);

    const messages = getTerminalConfigMessages(view);

    expect(messages[messages.length - 1].focusIndicatorBorderWidth).toBe(8);
  });

  it("registers a single configuration change listener", () => {
    mockConfiguration();
    provider = createProvider();
    resolveProvider(provider);
    resolveProvider(provider);

    const listenerCount = vi.mocked(
      vscode.workspace.onDidChangeConfiguration,
    ).mock.calls.length;

    expect(listenerCount).toBe(1);
  });

  it("reposts terminal config when focus indicator settings change", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    const previousCount = getTerminalConfigMessages(view).length;
    const listener = getConfigurationChangeListener();

    listener({
      affectsConfiguration: (section: string) =>
        section === "ai-sidebar-terminal.focusIndicatorMode",
    });

    expect(getTerminalConfigMessages(view).length).toBe(previousCount + 1);
  });

  it("reposts terminal config when focus indicator border width changes", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    const previousCount = getTerminalConfigMessages(view).length;
    const listener = getConfigurationChangeListener();

    listener({
      affectsConfiguration: (section: string) =>
        section === "ai-sidebar-terminal.focusIndicatorBorderWidth",
    });

    expect(getTerminalConfigMessages(view).length).toBe(previousCount + 1);
  });

  it("ignores configuration changes for unrelated settings", () => {
    mockConfiguration();
    provider = createProvider();
    const { view } = resolveProvider(provider);
    const previousCount = getTerminalConfigMessages(view).length;
    const listener = getConfigurationChangeListener();

    listener({
      affectsConfiguration: (section: string) =>
        section === "ai-sidebar-terminal.fontSize",
    });

    expect(getTerminalConfigMessages(view).length).toBe(previousCount);
  });

});
