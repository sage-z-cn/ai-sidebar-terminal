import { AiToolConfig } from "../../types";

export interface AiToolFileReference {
  path: string;
  selectionStart?: number;
  selectionEnd?: number;
}

export interface AiToolOperator {
  readonly id: string;
  readonly aliases: readonly string[];
  matches(tool: AiToolConfig): boolean;
  getLaunchCommand(tool: AiToolConfig): string;
  supportsHttpApi(tool: AiToolConfig): boolean;
  supportsAutoContext(tool: AiToolConfig): boolean;
  /**
   * Returns the command-line argument(s) used to direct the tool to start
   * its HTTP API server on the given port, or `undefined` if the tool does
   * not expose its HTTP server via a CLI flag.
   *
   * Appended to the launch command when {@link supportsHttpApi} returns true
   * and a port has been reserved. Example: `"--port=59867"`.
   *
   * OpenCode >=1.x CLI reads the port exclusively from `--port` (default 0 =
   * no HTTP server) and no longer honours the legacy `_EXTENSION_OPENCODE_PORT`
   * env var, so operators that support HTTP must emit the CLI form here.
   *
   * @param port - Reserved ephemeral port for the HTTP server.
   * @returns CLI arg string (already shell-safe) or `undefined`.
   */
  buildPortArg(port: number): string | undefined;
  formatFileReference(reference: AiToolFileReference): string;
  formatDroppedFiles(
    paths: string[],
    options: { useAtSyntax: boolean },
  ): string;
  formatPastedImage(tempPath: string): string | undefined;
}
