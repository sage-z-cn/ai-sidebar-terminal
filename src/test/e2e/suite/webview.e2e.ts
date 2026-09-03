import * as assert from "assert";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "sagez.ai-sidebar-terminal",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

suite("Webview registration", () => {
  test("registers the sidebar view contribution", async () => {
    const extension = await activateExtension();
    const packageJSON = extension.packageJSON as {
      contributes?: {
        views?: Record<string, Array<{ id?: string; type?: string }>>;
      };
    };

    const sidebarViews =
      packageJSON.contributes?.views?.["ai-sidebar-terminalContainer"] ?? [];
    const terminalView = sidebarViews.find((view) => view.id === "ai-sidebar-terminal-view");

    assert.ok(terminalView, "ai-sidebar-terminal-view sidebar view should be contributed");
    assert.strictEqual(terminalView.type, "webview");
  });

  test("registers the sidebar view as webview", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ai-sidebar-terminal.focus"),
      "Focus command should be registered to activate sidebar view",
    );
  });

  test("view container command is registered", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    const viewContainerCommand = "workbench.view.extension.ai-sidebar-terminalContainer";

    assert.ok(
      commands.includes(viewContainerCommand),
      `${viewContainerCommand} should be registered when extension contributes a view container`,
    );
  });
});


