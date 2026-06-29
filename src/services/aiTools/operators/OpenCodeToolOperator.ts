import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";

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
   * Emits `--port=N` so OpenCode actually binds its HTTP API server.
   *
   * OpenCode's CLI reads the port exclusively from `--port` (default 0 = no
   * HTTP server). The legacy `_EXTENSION_OPENCODE_PORT` env var is no longer
   * honoured, so we must pass the port as a CLI arg.
   */
  public buildPortArg(port: number): string | undefined {
    return `--port=${port}`;
  }

  public formatFileReference(reference: AiToolFileReference): string {
    let formatted = `@${reference.path}`;
    if (reference.selectionStart !== undefined) {
      if (reference.selectionStart === reference.selectionEnd) {
        formatted += `#L${reference.selectionStart}`;
      } else {
        formatted += `#L${reference.selectionStart}-L${reference.selectionEnd}`;
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
