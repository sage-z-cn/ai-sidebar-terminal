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

async function getRegisteredCommands(): Promise<string[]> {
  await activateExtension();
  return vscode.commands.getCommands(true);
}

function assertCommandRegistered(commands: string[], commandId: string): void {
  assert.ok(commands.includes(commandId), `${commandId} should be registered`);
}

suite("Session flows", () => {
  test("registers core session commands", async () => {
    const commands = await getRegisteredCommands();

    assertCommandRegistered(commands, "ai-sidebar-terminal.start");
    assertCommandRegistered(commands, "ai-sidebar-terminal.focus");
    assertCommandRegistered(commands, "ai-sidebar-terminal.sendToAiTerminal");
  });

  test("executes start command without requiring external process", async () => {
    await activateExtension();

    await assert.doesNotReject(
      async () =>
        vscode.commands.executeCommand("ai-sidebar-terminal.start"),
    );
  });

  test("executes focus command", async () => {
    const commands = await getRegisteredCommands();
    assertCommandRegistered(commands, "ai-sidebar-terminal.focus");

    // The focus command delegates to the workbench view command, which the
    // minimal test host does not register. Only exercise the command when
    // its workbench counterpart is available.
    if (!commands.includes("workbench.view.focus")) {
      return;
    }

    await assert.doesNotReject(
      async () =>
        vscode.commands.executeCommand("ai-sidebar-terminal.focus"),
    );
  });
});
