import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeApi from "vscode";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { InstanceStore } from "../services/InstanceStore";
import { OutputChannelService } from "../services/OutputChannelService";
import { PortManager } from "../services/PortManager";
import type {
  OpenCodeUpdateService,
  OpenCodeUpdateStatus as UpdateServiceStatus,
} from "../services/OpenCodeUpdateService";
import { TerminalManager } from "../terminals/TerminalManager";
import { TerminalProvider } from "./TerminalProvider";

vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
    existsSync: vi.fn(() => false),
    promises: {
      writeFile: vi.fn(async () => undefined),
      unlink: vi.fn(async () => undefined),
    },
  },
  readFileSync: vi.fn(() => "<html><body>{{CSP_SOURCE}}</body></html>"),
  existsSync: vi.fn(() => false),
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
      focusIndicatorMode = "bottomBorder",
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
    updateService?: OpenCodeUpdateService;
  }): TerminalProvider {
    const context = new vscode.ExtensionContext();
    const portManager = PortManager.getInstance(options?.instanceStore);
    return new TerminalProvider(
      context as any,
      terminalManager,
      captureManager,
      portManager,
      options?.instanceStore,
      undefined,
      undefined,
      undefined,
      options?.updateService,
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
    expect(messages[messages.length - 1].focusIndicatorMode).toBe(
      "bottomBorder",
    );
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

  describe("OpenCode self-update UI bridge", () => {
    function createUpdateServiceFake() {
      const emitter = new vscode.EventEmitter<UpdateServiceStatus>();
      const service = {
        onDidChangeStatus: emitter.event,
        probeLocalVersion: vi.fn(async () => undefined),
        checkForUpdates: vi.fn(async () => ({
          ok: true,
          state: "upToDate" as const,
        })),
        startUpdate: vi.fn(async () => ({ ok: true })),
        abandonUpdate: vi.fn(),
        getUpgradeMethodDetails: vi.fn(async () => ({
          methods: ["curl", "npm"],
          defaultMethod: "npm",
          detectedMethod: "npm",
          lastUsedMethod: "curl",
        })),
        dispose: vi.fn(),
      };
      return {
        service: service as unknown as OpenCodeUpdateService,
        emitter,
      };
    }

    function getUpdateStatusPushes(view: { webview: any }): any[] {
      return vi.mocked(view.webview.postMessage).mock.calls
        .filter(
          (c: unknown[]) => c[0] && (c[0] as any).type === "openCodeUpdateStatus",
        )
        .map((c: unknown[]) => (c[0] as any).status);
    }

    function setup() {
      const fake = createUpdateServiceFake();
      provider = createProvider({ updateService: fake.service });
      const resolved = resolveProvider(provider);
      return { ...resolved, ...fake };
    }

    it("pushes available status with versions and enriched methods", async () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });

      let pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "available",
        step: "",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });

      await flushAsyncStartup();

      pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "available",
        methods: ["curl", "npm"],
        defaultMethod: "npm",
        detectedMethod: "npm",
        lastUsedMethod: "curl",
      });
    });

    it("pushes the locally probed version while still idle", async () => {
      mockConfiguration();
      const { view, service } = setup();
      (service.probeLocalVersion as any) = vi.fn(async () => "2.0.9");

      await provider.refreshOpenCodeLocalVersion();

      expect(service.probeLocalVersion).toHaveBeenCalledTimes(1);
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "idle",
        step: "",
        installedVersion: "2.0.9",
        currentVersion: "2.0.9",
      });
    });

    it("keeps the available state untouched by the local probe", async () => {
      mockConfiguration();
      const { view, emitter, service } = setup();
      (service.probeLocalVersion as any) = vi.fn(async () => "2.0.9");

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      await flushAsyncStartup();
      const pushesBefore = getUpdateStatusPushes(view).length;

      await provider.refreshOpenCodeLocalVersion();

      expect(getUpdateStatusPushes(view).length).toBe(pushesBefore);
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "available",
        currentVersion: "2.0.6",
      });
    });

    it("opens the method popover only for manual available events", async () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
        manual: true,
      });

      expect(getUpdateStatusPushes(view).at(-1).openMethodPicker).toBe(true);

      await flushAsyncStartup();

      // The enrichment follow-up must not carry the transient signal:
      // it would re-open an already-dismissed popover.
      const pushes = getUpdateStatusPushes(view);
      expect(pushes.length).toBeGreaterThan(1);
      expect(pushes.at(-1).openMethodPicker).toBeUndefined();
    });

    it("does not open the method popover for automatic available events", async () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });

      expect(getUpdateStatusPushes(view).at(-1).openMethodPicker).toBe(false);

      await flushAsyncStartup();

      expect(getUpdateStatusPushes(view).at(-1).openMethodPicker).toBeUndefined();
    });

    it("accumulates step history and keeps remediation inside updating", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({ state: "updating", step: "prepare-target" });
      emitter.fire({
        state: "updating",
        step: "prepare-local",
        targetVersion: "2.0.7",
      });
      emitter.fire({
        state: "updating",
        step: "execute",
        targetVersion: "2.0.7",
      });
      emitter.fire({ state: "updating", step: "remediate-trust" });

      let pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "updating",
        step: "remediate-trust",
        targetVersion: "2.0.7",
      });
      expect(pushes.at(-1).history).toEqual([
        { step: "prepare-target", ok: true, label: "" },
        { step: "prepare-local", ok: true, label: "" },
        { step: "execute", ok: true, label: "" },
      ]);

      emitter.fire({
        state: "failed",
        detail: "nvm trust failed: denied",
        targetVersion: "2.0.7",
        remediationCommands: [
          "nvm firewall trust module opencode",
          "nvm reshim",
        ],
      });

      pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "failed",
        step: "",
        detail: "nvm trust failed: denied",
        remediationCommands: [
          "nvm firewall trust module opencode",
          "nvm reshim",
        ],
        manualCommands: [
          "nvm firewall trust module opencode",
          "nvm reshim",
        ],
      });
      expect(pushes.at(-1).history).toEqual([
        { step: "prepare-target", ok: true, label: "" },
        { step: "prepare-local", ok: true, label: "" },
        { step: "execute", ok: true, label: "" },
        { step: "remediate-trust", ok: false, label: "" },
      ]);
    });

    it("pushes success with the installed and running versions", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      emitter.fire({ state: "updating", step: "prepare-target" });
      emitter.fire({
        state: "updating",
        step: "prepare-local",
        targetVersion: "2.0.7",
      });
      emitter.fire({ state: "updating", step: "execute", targetVersion: "2.0.7" });
      emitter.fire({ state: "updating", step: "verify" });
      emitter.fire({
        state: "updateSucceeded",
        installedVersion: "2.0.7",
        targetVersion: "2.0.7",
      });

      const pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "success",
        step: "",
        installedVersion: "2.0.7",
        runningVersion: "2.0.6",
      });
      expect(pushes.at(-1).history).toEqual([
        { step: "prepare-target", ok: true, label: "" },
        { step: "prepare-local", ok: true, label: "" },
        { step: "execute", ok: true, label: "" },
        { step: "verify", ok: true, label: "" },
      ]);
    });

    it("hides the UI for disabled and shows an up-to-date notice only on manual checks", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({ state: "disabled" });
      expect(getUpdateStatusPushes(view).at(-1)).toEqual({
        state: "idle",
        step: "",
        history: [],
      });

      emitter.fire({
        state: "upToDate",
        currentVersion: "2.0.6",
        latestVersion: "2.0.6",
        manual: true,
      });
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "idle",
        step: "",
        installedVersion: "2.0.6",
        latestVersion: "2.0.6",
        notice: "Already up to date: 2.0.6",
      });

      // Automatic checks stay silent: versions only, no notice card.
      emitter.fire({
        state: "upToDate",
        currentVersion: "2.0.6",
        latestVersion: "2.0.6",
        manual: false,
      });
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "idle",
        step: "",
        installedVersion: "2.0.6",
        latestVersion: "2.0.6",
        notice: undefined,
      });
    });

    it("keeps the current UI on idle and checking events", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({ state: "available", currentVersion: "2.0.6", latestVersion: "2.0.7" });
      const before = getUpdateStatusPushes(view).length;

      emitter.fire({ state: "checking" });
      emitter.fire({ state: "idle" });

      expect(getUpdateStatusPushes(view).length).toBe(before);
    });

    it("does not repeat the up-to-date notice on later pushes", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "upToDate",
        currentVersion: "2.0.6",
        latestVersion: "2.0.6",
        manual: true,
      });
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        notice: "Already up to date: 2.0.6",
      });

      // A later transition must not re-pop the hint card.
      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "available",
        notice: undefined,
      });
    });

    it("preserves manual commands when a restore event lacks them", () => {
      mockConfiguration();
      const { view, emitter } = setup();
      const commands = [
        "nvm firewall trust module opencode",
        "nvm reshim",
      ];

      emitter.fire({
        state: "failed",
        detail: "nvm trust failed: denied",
        targetVersion: "2.0.7",
        remediationCommands: commands,
      });
      emitter.fire({ state: "failed" });

      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "failed",
        detail: "nvm trust failed: denied",
        manualCommands: commands,
        remediationCommands: commands,
      });
    });

    it("hides the update UI with cleared version fields for non-opencode tools", async () => {
      mockConfiguration();
      const { view, emitter } = setup();
      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      await flushAsyncStartup();

      // A non-opencode active tool must force the UI hidden; setting the
      // field (not a getActiveTool spy) keeps the real operator-registry
      // judgment in play.
      (provider as unknown as { sessionRuntime: { activeTool?: unknown } })
        .sessionRuntime.activeTool = { name: "claude", label: "Claude" };

      emitter.fire({
        state: "upToDate",
        currentVersion: "2.0.7",
        latestVersion: "2.0.7",
        manual: false,
      });

      expect(getUpdateStatusPushes(view).at(-1)).toEqual({
        state: "idle",
        step: "",
        installedVersion: "",
        latestVersion: "",
        currentVersion: "",
      });
    });

    it("replies to requestOpenCodeUpdateStatus with the snapshot", async () => {
      mockConfiguration();
      const { view, emitter, messageHandler } = setup();
      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      await flushAsyncStartup();
      const before = getUpdateStatusPushes(view).length;

      await messageHandler({ type: "requestOpenCodeUpdateStatus" });

      const pushes = getUpdateStatusPushes(view);
      expect(pushes.length).toBe(before + 1);
      expect(pushes.at(-1)).toMatchObject({
        state: "available",
        currentVersion: "2.0.6",
      });
    });

    it("routes start, check, and abandon messages to the service", async () => {
      mockConfiguration();
      const { service, messageHandler } = setup();

      await messageHandler({ type: "startOpenCodeUpdate", method: "npm" });
      await flushAsyncStartup();
      await messageHandler({ type: "checkOpenCodeUpdates" });
      await flushAsyncStartup();
      messageHandler({ type: "abandonOpenCodeUpdate" });
      await flushAsyncStartup();

      expect(service.startUpdate).toHaveBeenCalledWith("npm");
      expect(service.checkForUpdates).toHaveBeenCalledWith({ manual: true });
      expect(service.abandonUpdate).toHaveBeenCalledTimes(1);
    });

    it("keeps the current state when the manual check fails", async () => {
      mockConfiguration();
      const { view, emitter, service, messageHandler } = setup();
      (service.checkForUpdates as any) = vi.fn(async () => ({
        ok: false,
        state: "idle",
        error: "github releases returned 404",
      }));

      emitter.fire({
        state: "failed",
        detail: "upgrade command failed",
        targetVersion: "2.0.7",
      });
      await messageHandler({ type: "checkOpenCodeUpdates" });
      await flushAsyncStartup();

      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "failed",
        step: "",
        detail: "upgrade command failed",
        notice:
          "Could not check for updates. Check your network connection and try again.",
      });
    });

    it("clears stale detail and manual commands on available and success", () => {
      mockConfiguration();
      const { view, emitter } = setup();

      emitter.fire({
        state: "failed",
        detail: "nvm trust failed",
        remediationCommands: ["nvm reshim"],
      });

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      let pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "available",
        detail: "",
        manualCommands: [],
        remediationCommands: [],
      });

      emitter.fire({
        state: "updating",
        step: "execute",
        detail: "opencode upgrade --method npm",
        targetVersion: "2.0.7",
      });
      emitter.fire({
        state: "updateSucceeded",
        installedVersion: "2.0.7",
        targetVersion: "2.0.7",
      });
      pushes = getUpdateStatusPushes(view);
      expect(pushes.at(-1)).toMatchObject({
        state: "success",
        detail: "",
        manualCommands: [],
        remediationCommands: [],
      });
    });

    it("enriches missing method metadata on the cold-start snapshot", async () => {
      mockConfiguration();
      const { view, emitter, messageHandler } = setup();

      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      await flushAsyncStartup();
      // Simulate a late webview whose snapshot lost the method metadata.
      (provider as any).updateUi.methods = undefined;

      await messageHandler({ type: "requestOpenCodeUpdateStatus" });
      await flushAsyncStartup();

      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "available",
        methods: ["curl", "npm"],
        defaultMethod: "npm",
      });
    });

    it("restarts and dismisses back to idle with the installed version", async () => {
      mockConfiguration();
      const { view, emitter, messageHandler } = setup();
      const restartSpy = vi.spyOn(provider, "restart").mockImplementation(() => undefined);
      emitter.fire({
        state: "available",
        currentVersion: "2.0.6",
        latestVersion: "2.0.7",
      });
      emitter.fire({ state: "updating", step: "prepare-target" });
      emitter.fire({ state: "updating", step: "execute", targetVersion: "2.0.7" });
      emitter.fire({ state: "updating", step: "verify" });
      emitter.fire({
        state: "updateSucceeded",
        installedVersion: "2.0.7",
        targetVersion: "2.0.7",
      });

      await messageHandler({ type: "restartAfterUpdate" });
      await flushAsyncStartup();

      expect(restartSpy).toHaveBeenCalledTimes(1);
      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "idle",
        step: "",
        installedVersion: "2.0.7",
        notice: undefined,
      });

      await messageHandler({ type: "dismissOpenCodeUpdate" });
      await flushAsyncStartup();

      expect(getUpdateStatusPushes(view).at(-1)).toMatchObject({
        state: "idle",
        step: "",
        installedVersion: "2.0.7",
      });
    });
  });

});
