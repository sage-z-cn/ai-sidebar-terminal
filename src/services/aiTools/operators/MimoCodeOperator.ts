import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";

/**
 * Operator for Mimo Code (Xiaomi / 小米).
 *
 * Based on OpenCode, so file reference format and HTTP API support
 * follow the same conventions.
 *
 * File reference format: @file#Lline-range (hash + L prefix).
 * Examples:
 *   @src/app.ts           — entire file
 *   @src/app.ts#L10       — single line
 *   @src/app.ts#L10-L20   — line range
 */
export class MimoCodeOperator implements AiToolOperator {
  public readonly id = "mimo";
  public readonly aliases = ["mimo-code"] as const;

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
   * Mimo Code is OpenCode-derived and shares the `--port=N` CLI contract.
   * See {@link OpenCodeToolOperator.buildPortArg} for the rationale.
   */
  public buildPortArg(port: number): string | undefined {
    return `--port=${port}`;
  }

  /** @file#L10-L20 — hash + L prefix line range */
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
