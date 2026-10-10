import * as vscode from "vscode";
import { l10n } from "../i18n";
import { ContextManager } from "../services/ContextManager";
import { formatDiagnostic, formatDiagnostics } from "../utils/PromptFormatter";

type SeverityName = "error" | "warning" | "information" | "hint";

interface ExplainAndFixCommandArgs {
  diagnostic: vscode.Diagnostic;
  documentUri: string;
}

const SEVERITY_MAP: Record<SeverityName, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

export class OpenCodeCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  constructor(
    private contextManager: ContextManager,
    private readonly sendPrompt: (prompt: string) => Promise<void>,
  ) {}

  public registerCommand(): vscode.Disposable {
    return vscode.commands.registerCommand(
      "opencode-cli-sidebar.explainAndFix",
      async (args?: ExplainAndFixCommandArgs) => {
        if (!args?.diagnostic || !args.documentUri) {
          vscode.window.showWarningMessage(
            l10n.t("Explain and Fix could not read the selected diagnostic context."),
          );
          return;
        }

        try {
          const document = await vscode.workspace.openTextDocument(
            vscode.Uri.parse(args.documentUri),
          );
          const prompt = this.buildPrompt(args.diagnostic, document);
          await this.sendPrompt(prompt);
          vscode.window.showInformationMessage(
            l10n.t("Sent diagnostic to OpenCode terminal"),
          );
        } catch (error) {
          vscode.window.showErrorMessage(
            l10n.t("Failed to send diagnostic prompt: {error}", { error: error instanceof Error ? error.message : String(error) }),
          );
        }
      },
    );
  }

  public provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    if (token.isCancellationRequested || context.diagnostics.length === 0) {
      return [];
    }

    const allowedSeverities = this.getConfiguredSeverities();
    const diagnostics = context.diagnostics.filter((diagnostic) =>
      allowedSeverities.has(diagnostic.severity),
    );

    if (diagnostics.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of diagnostics) {
      actions.push(this.createFixAction(diagnostic, document));
    }

    return actions;
  }

  private createFixAction(
    diagnostic: vscode.Diagnostic,
    document: vscode.TextDocument,
  ): vscode.CodeAction {
    const action = {
      title: l10n.t("Explain and Fix (Terminal)"),
      kind: vscode.CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      isPreferred: true,
      command: {
        title: l10n.t("Explain and Fix (Terminal)"),
        command: "opencode-cli-sidebar.explainAndFix",
        arguments: [
          {
            diagnostic,
            documentUri: document.uri.toString(),
          },
        ],
      },
    };

    return action as vscode.CodeAction;
  }

  private getConfiguredSeverities(): Set<vscode.DiagnosticSeverity> {
    const config = vscode.workspace.getConfiguration("opencode-cli-sidebar");
    const severities = config.get<SeverityName[]>("codeActionSeverities", [
      "error",
      "warning",
    ]);

    return new Set(
      severities
        .map((severity) => SEVERITY_MAP[severity])
        .filter(
          (severity): severity is vscode.DiagnosticSeverity =>
            severity !== undefined,
        ),
    );
  }

  private buildPrompt(
    diagnostic: vscode.Diagnostic,
    document: vscode.TextDocument,
  ): string {
    const config = vscode.workspace.getConfiguration("opencode-cli-sidebar");
    const maxDiagnosticLength = config.get<number>("maxDiagnosticLength", 500);

    const primaryDiagnostic = formatDiagnostic(
      diagnostic,
      document.uri,
      maxDiagnosticLength,
    );

    const relatedDiagnostics = this.contextManager
      .getDiagnostics(document.uri)
      .filter((candidate) => candidate !== diagnostic);

    const relatedSection =
      relatedDiagnostics.length > 0
        ? `Additional diagnostics in this file:\n${formatDiagnostics(relatedDiagnostics, document.uri, maxDiagnosticLength)}`
        : "";

    const instruction =
      l10n.t("Explain this diagnostic and provide a concrete fix with code changes.");

    return [instruction, primaryDiagnostic, relatedSection]
      .filter((value) => value.length > 0)
      .join("\n\n");
  }
}

