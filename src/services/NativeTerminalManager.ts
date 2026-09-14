import { existsSync } from "node:fs";
import { TerminalBackendType } from "../types";
import {
  BackendLaunchPlan,
  BackendSessionState,
  TerminalBackendManager,
} from "./terminalBackends";
import { ILogger } from "./ILogger";

export class NativeTerminalManager implements TerminalBackendManager {
  public readonly type = "native" as const;

  public constructor(private readonly logger?: ILogger) {
    void this.logger;
  }

  public isAvailable(): boolean {
    return true;
  }

  public restore(savedState: BackendSessionState): BackendLaunchPlan | undefined {
    if (savedState.version !== 1) {
      this.logger?.debug(
        `[NativeTerminalManager] Unknown backend state version: ${savedState.version}, skipping restore`,
      );
      return undefined;
    }

    if (savedState.backend !== "native") {
      this.logger?.debug(
        `[NativeTerminalManager] Backend mismatch: expected 'native', got '${savedState.backend}'`,
      );
      return undefined;
    }

    let cwd = savedState.launchSpec.cwd;
    if (cwd && !existsSync(cwd)) {
      this.logger?.debug(
        `[NativeTerminalManager] Saved cwd '${cwd}' no longer exists, clearing`,
      );
      cwd = undefined;
    }

    const now = Date.now();
    const launchSpec = {
      ...savedState.launchSpec,
      cwd,
    };

    const state: BackendSessionState = {
      version: 1,
      backend: "native" as TerminalBackendType,
      restoreMode: "recreate",
      launchSpec,
      createdAt: now,
      lastSeenAt: savedState.createdAt,
    };

    return {
      backend: "native",
      restoreMode: "recreate",
      launchSpec,
      state,
    };
  }

  public create(
    instanceId: string,
    options: {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    },
  ): BackendLaunchPlan {
    const now = Date.now();
    const launchSpec = {
      command: options.command,
      args: options.args,
      cwd: options.cwd,
      ...(options.env ? { env: { ...options.env } } : {}),
      name: instanceId,
    };

    const state: BackendSessionState = {
      version: 1,
      backend: "native" as TerminalBackendType,
      restoreMode: "recreate",
      launchSpec,
      createdAt: now,
    };

    return {
      backend: "native",
      restoreMode: "recreate",
      launchSpec,
      state,
    };
  }
}
