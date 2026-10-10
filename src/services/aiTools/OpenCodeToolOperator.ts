import { buildOpenCodeHttpPortArg } from "../OpenCodeCliCompat";

/** File reference payload rendered as an OpenCode `@file` mention. */
export interface OpenCodeFileReference {
  path: string;
  selectionStart?: number;
  selectionEnd?: number;
}

/**
 * Launch command shape resolved from the `opencode.commandPath` and
 * `opencode.args` settings.
 */
export interface OpenCodeLaunchCommand {
  commandPath: string;
  args: string[];
  /** Appends OpenCode's continue-last-session flag (`-c`) after `args`. */
  continueLastSession?: boolean;
}

/**
 * OpenCode-specific behavior for the sidebar terminal session: launch
 * command assembly, HTTP API port argument, and `@file` reference /
 * dropped-file / pasted-image formatting.
 *
 * Stateless; process lifecycle is owned by `SessionRuntime` +
 * `TerminalManager`.
 */
export class OpenCodeToolOperator {
  /**
   * Builds the shell command from the configured command path and args:
   * `commandPath + args + ("-c" when continueLastSession)`. An empty or
   * whitespace-only command path yields an empty string so callers can
   * reject the launch; the joined result is trimmed overall.
   */
  public getLaunchCommand(launch: OpenCodeLaunchCommand): string {
    const commandPath = launch.commandPath.trim();
    if (!commandPath) {
      return "";
    }
    const parts = [commandPath, ...launch.args];
    if (launch.continueLastSession) {
      parts.push("-c");
    }
    return parts.join(" ").trim();
  }

  public supportsHttpApi(): boolean {
    return true;
  }

  public supportsAutoContext(): boolean {
    return true;
  }

  /**
   * Emits `--port=N` for OpenCode v1 so the TUI binds its HTTP API server.
   *
   * OpenCode v1 reads the port exclusively from `--port` (default 0 = no HTTP
   * server). OpenCode v2 rejects `--port` on the TUI and instead attaches to
   * the background service (`opencode service`), so v2 returns `undefined`.
   */
  public buildPortArg(
    port: number,
    options?: { cliMajorVersion?: number },
  ): string | undefined {
    return buildOpenCodeHttpPortArg(options?.cliMajorVersion, port);
  }

  /**
   * Formats references as `@path`, `@path#42` (single line), or
   * `@path#37-42` (line range). OpenCode uses bare line numbers without
   * the `L` prefix. Directory paths are passed through unchanged, so a
   * caller-supplied trailing `/` (e.g. `@src/`) is preserved.
   */
  public formatFileReference(reference: OpenCodeFileReference): string {
    let formatted = `@${reference.path}`;
    if (reference.selectionStart !== undefined) {
      if (
        reference.selectionEnd === undefined ||
        reference.selectionStart === reference.selectionEnd
      ) {
        formatted += `#${reference.selectionStart}`;
      } else {
        formatted += `#${reference.selectionStart}-${reference.selectionEnd}`;
      }
    }

    return formatted;
  }

  public formatDroppedFiles(
    paths: string[],
    options: { useAtSyntax: boolean },
  ): string {
    if (options.useAtSyntax) {
      return paths
        .map((file) => this.formatFileReference({ path: file }))
        .join(" ");
    }

    return paths.join(" ");
  }

  public formatPastedImage(tempPath: string): string | undefined {
    return tempPath;
  }
}
