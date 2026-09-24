import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";
import { buildOpenCodeHttpPortArg } from "../../OpenCodeCliCompat";

export class OpenCodeToolOperator implements AiToolOperator {
  public readonly id = "opencode";
  public readonly aliases = ["open-code"] as const;

  public matches(tool: AiToolConfig): boolean {
    const names = new Set([
      tool.name,
      tool.operator,
      ...(tool.aliases ?? []),
    ]);
    return names.has(this.id) || this.aliases.some((alias) => names.has(alias));
  }

  public getLaunchCommand(tool: AiToolConfig): string {
    return getToolLaunchCommand(tool);
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
  public formatFileReference(reference: AiToolFileReference): string {
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
