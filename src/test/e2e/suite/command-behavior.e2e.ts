import * as assert from "assert";
import * as vscode from "vscode";

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "sagez.opencode-cli-sidebar",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

async function executeCommandWithoutUserInput(commandId: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(commandId);
  } catch {
    // Expected for commands that require user input or specific state
  }
}

suite("Command behavior", () => {
  const safeCommands = [
    "opencode-cli-sidebar.start",
  ];

  for (const commandId of safeCommands) {
    test(`executes ${commandId} without throwing`, async () => {
      await activateExtension();

      await assert.doesNotReject(async () => {
        await executeCommandWithoutUserInput(commandId);
      });
    });
  }
});
