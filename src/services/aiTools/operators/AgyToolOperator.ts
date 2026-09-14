import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";

/**
 * Operator for Antigravity CLI (Google / agy).
 *
 * File reference format: @file#Lline-range (hash + L prefix).
 * Examples:
 *   @src/app.ts           — entire file
 *   @src/app.ts#L10       — single line
 *   @src/app.ts#L10-L20   — line range
 */
export class AgyToolOperator implements AiToolOperator {
  public readonly id = "agy";
  public readonly aliases = ["antigravity"] as const;

  /** Matches canonical, operator, or configured alias names for Agy. */
  public matches(tool: AiToolConfig): boolean {
    const names = new Set([
      tool.name,
      tool.operator,
      ...(tool.aliases ?? []),
    ]);
    return names.has(this.id) || this.aliases.some((alias) => names.has(alias));
  }

  /** Returns the configured Agy executable and arguments unchanged. */
  public getLaunchCommand(tool: AiToolConfig): string {
    return getToolLaunchCommand(tool);
  }

  /** Agy is a local TUI and does not expose the OpenCode HTTP API. */
  public supportsHttpApi(): boolean {
    return false;
  }

  /** Agy does not consume the extension's editor-context WebSocket. */
  public supportsAutoContext(): boolean {
    return false;
  }

  /** Agy reads text and rich media directly from the system clipboard. */
  public supportsNativePaste(): boolean {
    return true;
  }

  /** Antigravity CLI has no HTTP API, so no port arg is emitted. */
  public buildPortArg(_port: number): string | undefined {
    return undefined;
  }

  /** Formats an Agy @ reference with its optional one-based line range. */
  public formatFileReference(reference: AiToolFileReference): string {
    let formatted = `@${reference.path}`;
    if (reference.selectionStart !== undefined) {
      if (
        reference.selectionEnd !== undefined &&
        reference.selectionStart !== reference.selectionEnd
      ) {
        formatted += `#L${reference.selectionStart}-L${reference.selectionEnd}`;
      } else {
        formatted += `#L${reference.selectionStart}`;
      }
    }

    return formatted;
  }

  /** Formats dropped paths either as Agy @ references or plain paths. */
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

  /** Keeps a file-reference fallback for non-keyboard paste entry points. */
  public formatPastedImage(tempPath: string): string | undefined {
    // Agy's file attachment syntax is the same @-reference used for dropped
    // files; sending a bare path would make the paste ordinary prompt text.
    return this.formatFileReference({ path: tempPath });
  }
}
