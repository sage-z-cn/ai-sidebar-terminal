import { AiToolFileReference, AiToolOperator } from "../AiToolOperator";
import { AiToolConfig, getToolLaunchCommand } from "../../../types";

/**
 * Operator for Google Gemini CLI.
 *
 * File reference format: @file (no line range support).
 * Line ranges are not supported in the @ syntax — Gemini CLI only
 * supports reading entire files via @ references.
 *
 * Non-interactive mode: gemini -p "prompt"
 */
export class GeminiCLIOperator implements AiToolOperator {
  public readonly id = "gemini";
  public readonly aliases = [] as const;

  public matches(tool: AiToolConfig): boolean {
    const names = new Set([
      tool.name,
      tool.operator,
      ...(tool.aliases ?? []),
    ]);
    return names.has(this.id);
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

  /** Gemini CLI has no HTTP API, so no port arg is emitted. */
  public buildPortArg(_port: number): string | undefined {
    return undefined;
  }

  /** @file — no line range support */
  public formatFileReference(reference: AiToolFileReference): string {
    return `@${reference.path}`;
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
