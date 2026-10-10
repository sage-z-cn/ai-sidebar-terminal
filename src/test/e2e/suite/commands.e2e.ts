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

suite("Command registration", () => {
  test("registers core extension commands", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);

    assert.ok(commands.includes("ai-sidebar-terminal.start"));
    assert.ok(commands.includes("ai-sidebar-terminal.focus"));
  });

  test("registers focus command without relying on internal workbench commands", async () => {
    await activateExtension();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("ai-sidebar-terminal.focus"),
      "ai-sidebar-terminal.focus should be registered",
    );
  });

  test("uses opencode auto-start defaults", async () => {
    const extension = await activateExtension();

    const properties = extension.packageJSON.contributes.configuration
      .properties as Record<string, { default: unknown }>;

    assert.strictEqual(properties["ai-sidebar-terminal.autoStartOnOpen"].default, true);
    assert.strictEqual(
      properties["ai-sidebar-terminal.opencode.commandPath"].default,
      "opencode",
    );
  });
});


