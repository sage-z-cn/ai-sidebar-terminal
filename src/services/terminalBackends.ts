import { TerminalBackendType } from "../types";

export interface TerminalBackend {
  readonly type: TerminalBackendType;
  readonly label: string;
  isAvailable(): boolean;
}

export class TerminalBackendRegistry {
  public isAvailable(_type: TerminalBackendType): boolean {
    return true;
  }

  public resolveAvailable(
    _requested: TerminalBackendType,
    _fallback: TerminalBackendType = "native",
  ): TerminalBackendType {
    return "native";
  }
}

/** Specification for launching a terminal process. */
export interface TerminalLaunchSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  name?: string;
}

/** Versioned state persisted alongside an instance for backend restore. */
export interface BackendSessionState {
  version: 1;
  backend: TerminalBackendType;
  sessionId?: string;
  restoreMode: "reattach" | "recreate";
  launchSpec: TerminalLaunchSpec;
  createdAt: number;
  lastSeenAt?: number;
}

/** Plan produced by a backend manager for creating or restoring a session. */
export interface BackendLaunchPlan {
  backend: TerminalBackendType;
  restoreMode: "reattach" | "recreate";
  launchSpec: TerminalLaunchSpec;
  sessionId?: string;
  state: BackendSessionState;
}

/** Manager interface for a specific terminal backend. */
export interface TerminalBackendManager {
  readonly type: TerminalBackendType;
  isAvailable(): boolean;
  create(
    instanceId: string,
    options: {
      command: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string>;
    },
  ): BackendLaunchPlan;
  restore?(savedState: BackendSessionState): BackendLaunchPlan | undefined;
  stop?(): void;
}
