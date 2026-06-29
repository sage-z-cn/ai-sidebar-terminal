import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";

/**
 * Operator for Kimi Code (Moonshot AI / 月之暗面).
 *
 * File reference format: @file:line-range (colon, not hash).
 * Examples:
 *   @src/app.ts           — entire file
 *   @src/app.ts:10        — single line
 *   @src/app.ts:10-20     — line range
 *
 * Reference: https://www.kimi.com/code/docs/en/kimi-code-for-vscode/core-operations.html
 */
export class KimiCodeOperator implements AiToolOperator {
  public readonly id = "kimi";
  public readonly aliases = ["kimi-code"] as const;

  public matches(tool: AiToolConfig): boolean {
    const names = new Set([
      tool.name,
      tool.operator,
      ...(tool.aliases ?? []),
    ]);
    return names.has(this.id) || names.has("kimi-code");
  }

  public getLaunchCommand(tool: AiToolConfig): string {
    return getToolLaunchCommand(tool);
  }

  public supportsHttpApi(): boolean {
    return false;
  }

  public supportsAutoContext(): boolean {
    return false;
  }

  /** Kimi Code has no HTTP API, so no port arg is emitted. */
  public buildPortArg(_port: number): string | undefined {
    return undefined;
  }

  /** @file:10-20 — colon-separated line range */
  public formatFileReference(reference: AiToolFileReference): string {
    let formatted = `@${reference.path}`;
    if (reference.selectionStart !== undefined) {
      if (
        reference.selectionEnd !== undefined &&
        reference.selectionStart !== reference.selectionEnd
      ) {
        formatted += `:${reference.selectionStart}-${reference.selectionEnd}`;
      } else {
        formatted += `:${reference.selectionStart}`;
      }
    }
    return formatted;
  }

  public formatDroppedFiles(
    paths: string[],
    options: { useAtSyntax: boolean },
  ): string {
    if (options.useAtSyntax) {
      return paths.map((file) => `@${file}`).join(" ");
    }
    return paths.join(" ");
  }

  public formatPastedImage(tempPath: string): string | undefined {
    return tempPath;
  }
}
