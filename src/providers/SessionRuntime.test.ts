import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscodeApi from "vscode";
import type * as nodePtyTypes from "../test/mocks/node-pty";
import type * as vscodeTypes from "../test/mocks/vscode";
import { OutputCaptureManager } from "../services/OutputCaptureManager";
import { InstanceStore } from "../services/InstanceStore";
import { OutputChannelService } from "../services/OutputChannelService";
import { PortManager } from "../services/PortManager";
import { TerminalManager } from "../terminals/TerminalManager";
import { ContextSharingService } from "../services/ContextSharingService";
import { AiToolOperatorRegistry } from "../services/aiTools/AiToolOperatorRegistry";
import { NativeTerminalManager } from "../services/NativeTerminalManager";
import { TerminalBackendRegistry } from "../services/terminalBackends";
import type { IdeContextServer } from "../services/ideContext/IdeContextServer";
import { SessionRuntime } from "./SessionRuntime";

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

describe("SessionRuntime (native-only)", () => {
  let terminalManager: TerminalManager;
  let captureManager: OutputCaptureManager;
  let portManager: PortManager;
  let instanceStore: InstanceStore;
  let logger: OutputChannelService;
  let contextSharingService: ContextSharingService;
  let aiToolRegistry: AiToolOperatorRegistry;
  let backendRegistry: TerminalBackendRegistry;
  let nativeTerminalManager: NativeTerminalManager;
  let mockPostMessage: ReturnType<typeof vi.fn>;
  let mockOnActiveInstanceChanged: ReturnType<typeof vi.fn>;
  let mockRequestStartOpenCode: ReturnType<typeof vi.fn>;
  let mockShowAiToolSelector: ReturnType<typeof vi.fn>;
  let sessionRuntime: SessionRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();

    terminalManager = new TerminalManager();
    captureManager = new OutputCaptureManager();
    instanceStore = new InstanceStore();
    logger = OutputChannelService.getInstance();
    contextSharingService = new ContextSharingService();
    aiToolRegistry = new AiToolOperatorRegistry();
    backendRegistry = new TerminalBackendRegistry();
    nativeTerminalManager = new NativeTerminalManager(logger);
    portManager = PortManager.getInstance(instanceStore);

    mockPostMessage = vi.fn((_msg: unknown) => {});
    mockOnActiveInstanceChanged = vi.fn((_id: string) => {});
    mockRequestStartOpenCode = vi.fn(async (): Promise<void> => {});
    mockShowAiToolSelector = vi.fn((_sid: string, _sn: string, _force?: boolean) => {});

    const configuration = {
      get: vi.fn((key: string, defaultValue?: unknown) => {
        if (key === "enableHttpApi") return false;
        if (key === "aiTools") return [{ name: "opencode", label: "OpenCode" }];
        if (key === "logLevel") return "error";
        if (key === "httpTimeout") return 5000;
        return defaultValue;
      }),
      update: vi.fn(),
    };
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration as any);

    vscode.workspace.workspaceFolders = undefined;
  });

  afterEach(() => {
    sessionRuntime?.dispose?.();
    terminalManager.dispose();
    OutputChannelService.resetInstance();
    PortManager.resetInstance();
  });

  function createSessionRuntime(overrides?: {
    instanceStore?: InstanceStore;
    ideContextServer?: IdeContextServer;
  }): SessionRuntime {
    return new SessionRuntime(
      terminalManager,
      captureManager,
      undefined,
      portManager,
      backendRegistry,
      overrides?.instanceStore ?? instanceStore,
      logger,
      contextSharingService,
      aiToolRegistry,
      {
        postMessage: mockPostMessage as (message: unknown) => void,
        onActiveInstanceChanged: mockOnActiveInstanceChanged as (instanceId: string) => void,
        requestStartOpenCode: mockRequestStartOpenCode as () => Promise<void>,
        showAiToolSelector: mockShowAiToolSelector as (sessionId: string, sessionName: string, forceShow?: boolean) => void,
      },
      nativeTerminalManager,
      overrides?.ideContextServer,
    );
  }

  it("constructs and returns default active instance id", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.getActiveInstanceId()).toBe("default");
  });

  it("returns native as active backend", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.getActiveBackend()).toBe("native");
  });

  it("resolves tool by name from the AI tool registry", () => {
    instanceStore.upsert({
      config: { id: "default", selectedAiTool: "codex" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    const customTool = sessionRuntime.resolveToolByName("codex");
    expect(customTool).toBeDefined();
    expect(customTool?.name).toBe("codex");
  });

  it("remembers selected tool and persists to instance store", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    sessionRuntime.rememberSelectedTool("claude");
    const record = instanceStore.get("default");
    expect(record?.config.selectedAiTool).toBe("claude");
  });

  it("starts a native session via startOpenCode", async () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => false),
      update: vi.fn(),
    } as any);

    await sessionRuntime.startOpenCode();

    expect(sessionRuntime.isStartedFlag()).toBe(true);
  });

  it("getActiveSession returns session after creation", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    const session = sessionRuntime.getActiveSession();
    expect(session).toBeUndefined(); // Not started yet
  });

  it("switches to another instance and clears previous state", async () => {
    instanceStore.upsert({
      config: { id: "instance-a" },
      runtime: { terminalKey: "instance-a" },
      state: "disconnected",
    });
    instanceStore.upsert({
      config: { id: "instance-b" },
      runtime: { terminalKey: "instance-b" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();
    instanceStore.setActive("instance-a");

    expect(sessionRuntime.getActiveInstanceId()).toBe("instance-a");

    await sessionRuntime.switchToInstance("instance-b");

    expect(sessionRuntime.getActiveInstanceId()).toBe("instance-b");
  });

  it("no-ops switching to the already-active instance", async () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();
    const initialId = sessionRuntime.getActiveInstanceId();

    await sessionRuntime.switchToInstance(initialId);

    expect(sessionRuntime.getActiveInstanceId()).toBe(initialId);
  });

  it("restarts the active instance state", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    sessionRuntime.restart();

    expect(mockRequestStartOpenCode).toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "clearTerminal" }),
    );
  });

  it("resolves instance id from session id mappings", () => {
    instanceStore.upsert({
      config: { id: "mapped-instance" },
      runtime: { terminalKey: "tk-mapped" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    const id = sessionRuntime.resolveInstanceIdFromSessionId("mapped-instance");
    expect(id).toBe("mapped-instance");
  });

  it("returns undefined for unknown session id resolution (no fallback when multiple instances)", () => {
    const runtime = new SessionRuntime(
      terminalManager,
      captureManager,
      undefined,
      portManager,
      backendRegistry,
      undefined,
      logger,
      contextSharingService,
      aiToolRegistry,
      {
        postMessage: mockPostMessage as (message: unknown) => void,
        onActiveInstanceChanged: mockOnActiveInstanceChanged as (instanceId: string) => void,
        requestStartOpenCode: mockRequestStartOpenCode as () => Promise<void>,
        showAiToolSelector: mockShowAiToolSelector as (sessionId: string, sessionName: string, forceShow?: boolean) => void,
      },
      nativeTerminalManager,
    );

    const id = runtime.resolveInstanceIdFromSessionId("nonexistent");
    expect(id).toBe("ai-sidebar-terminal-main");
  });

  it("reports started state after startDefaultSession", async () => {
    instanceStore.upsert({
      config: { id: "default", selectedAiTool: "opencode" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === "enableHttpApi") return false;
        if (key === "aiTools") return [{ name: "opencode", label: "OpenCode", command: "opencode", operator: "opencode" }];
        return undefined;
      }),
      update: vi.fn(),
    } as any);

    await sessionRuntime.startOpenCode();

    expect(sessionRuntime.isStartedFlag()).toBe(true);
  });

  it("gets and sets last known terminal size", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    sessionRuntime.setLastKnownTerminalSize(120, 40);

    const size = sessionRuntime.getLastKnownTerminalSize();
    expect(size.cols).toBe(120);
    expect(size.rows).toBe(40);
  });

  it("disconnects and cleans up on dispose", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    sessionRuntime.dispose();

    expect(sessionRuntime.getActiveSession()).toBeUndefined();
  });

  it("hasLiveTerminalProcess returns false when not started", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.hasLiveTerminalProcess()).toBe(false);
  });

  it("getApiClient returns undefined when HTTP is not enabled", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.getApiClient()).toBeUndefined();
  });

  it("getActiveTool returns undefined before startup", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.getActiveTool()).toBeUndefined();
  });

  it("isHttpAvailable returns false by default", () => {
    instanceStore.upsert({
      config: { id: "default" },
      runtime: { terminalKey: "default" },
      state: "disconnected",
    });

    sessionRuntime = createSessionRuntime();

    expect(sessionRuntime.isHttpAvailable()).toBe(false);
  });

  describe("pollForHttpReadiness", () => {
    function attachMockApiClient(runtime: SessionRuntime, behavior: {
      once?: ReturnType<typeof vi.fn>;
    }): { once: ReturnType<typeof vi.fn> } {
      const once = behavior.once ?? vi.fn().mockResolvedValue(true);
      // private field is intentionally bypassed for white-box testing of
      // the readiness loop; the apiClient contract here is just healthCheckOnce.
      (runtime as unknown as { apiClient: unknown }).apiClient = {
        healthCheckOnce: once,
      };
      return { once };
    }

    function stubSleep(runtime: SessionRuntime): void {
      // Avoid real 500 ms delays between the 30 retry attempts.
      vi.spyOn(runtime, "sleep").mockResolvedValue(undefined);
    }

    beforeEach(() => {
      instanceStore.upsert({
        config: { id: "default" },
        runtime: { terminalKey: "default" },
        state: "disconnected",
      });
      sessionRuntime = createSessionRuntime();
      stubSleep(sessionRuntime);
    });

    it("marks HTTP available when healthCheckOnce succeeds", async () => {
      const { once } = attachMockApiClient(sessionRuntime, {
        once: vi.fn().mockResolvedValue(true),
      });

      await sessionRuntime.pollForHttpReadiness();

      expect(once).toHaveBeenCalledTimes(1);
      expect(sessionRuntime.isHttpAvailable()).toBe(true);
    });

    it("retries until healthCheckOnce eventually returns true", async () => {
      const { once } = attachMockApiClient(sessionRuntime, {
        once: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
      });

      await sessionRuntime.pollForHttpReadiness();

      expect(once).toHaveBeenCalledTimes(3);
      expect(sessionRuntime.isHttpAvailable()).toBe(true);
    });

    it("logs each unhealthy attempt (returns false) instead of staying silent", async () => {
      const infoSpy = vi
        .spyOn(logger, "info")
        .mockImplementation(() => undefined);
      const { once } = attachMockApiClient(sessionRuntime, {
        once: vi.fn().mockResolvedValue(false),
      });

      await sessionRuntime.pollForHttpReadiness();

      // The outer loop now runs 30 attempts.
      expect(once).toHaveBeenCalledTimes(30);
      expect(sessionRuntime.isHttpAvailable()).toBe(false);
      // Every unhealthy attempt is surfaced — regression guard for the
      // previous silent-failure where healthCheck() swallowed the false.
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("returned unhealthy"),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("attempt 1/30 returned unhealthy"),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("HTTP API not available after retries"),
      );
    });

    it("logs each thrown attempt with the underlying error message", async () => {
      const infoSpy = vi
        .spyOn(logger, "info")
        .mockImplementation(() => undefined);
      const { once } = attachMockApiClient(sessionRuntime, {
        once: vi.fn().mockRejectedValue(new Error("Connection refused")),
      });

      await sessionRuntime.pollForHttpReadiness();

      expect(once).toHaveBeenCalledTimes(30);
      expect(sessionRuntime.isHttpAvailable()).toBe(false);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("attempt 1/30 failed: Connection refused"),
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining("HTTP API not available after retries"),
      );
    });

    it("does not call healthCheck (which would re-trigger inner exponential backoff)", async () => {
      const once = vi.fn().mockResolvedValue(true);
      const fullClient = {
        healthCheckOnce: once,
        healthCheck: vi.fn().mockResolvedValue(true),
        appendPrompt: vi.fn().mockResolvedValue(undefined),
      };
      (sessionRuntime as unknown as { apiClient: unknown }).apiClient =
        fullClient;

      await sessionRuntime.pollForHttpReadiness();

      expect(once).toHaveBeenCalledTimes(1);
      expect(fullClient.healthCheck).not.toHaveBeenCalled();
    });

    it("no-ops when apiClient is absent", async () => {
      (sessionRuntime as unknown as { apiClient: unknown }).apiClient =
        undefined;

      await expect(
        sessionRuntime.pollForHttpReadiness(),
      ).resolves.toBeUndefined();
      expect(sessionRuntime.isHttpAvailable()).toBe(false);
    });
  });

});
