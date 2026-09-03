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

const commandCategories = {
  core: [
    "ai-sidebar-terminal.start",
    "ai-sidebar-terminal.focus",
    "ai-sidebar-terminal.paste",
  ],
  "file-reference": [
    "ai-sidebar-terminal.sendToTerminal",
    "ai-sidebar-terminal.sendAtMention",
    "ai-sidebar-terminal.sendAllOpenFiles",
    "ai-sidebar-terminal.sendToAiTerminal",
    "ai-sidebar-terminal.sendAbsoluteToAiTerminal",
  ],
} as const satisfies Record<string, readonly string[]>;

function allExpectedCommands(): string[] {
  return Object.values(commandCategories).flatMap((commands) => [...commands]);
}

suite("Comprehensive command registration", () => {
  for (const [category, expectedCommands] of Object.entries(commandCategories)) {
    test(`registers ${category} commands`, async () => {
      await activateExtension();
      const registeredCommands = await vscode.commands.getCommands(true);

      for (const command of expectedCommands) {
        assert.ok(
          registeredCommands.includes(command),
          `${command} should be registered in ${category}`,
        );
      }
    });
  }

  test("registers every package command exactly once in the comprehensive list", async () => {
    const extension = await activateExtension();
    const packageJSON = extension.packageJSON as {
      contributes?: { commands?: Array<{ command?: string }> };
    };
    const contributedCommands =
      packageJSON.contributes?.commands?.map(({ command }) => command) ?? [];
    const expectedCommands = allExpectedCommands();

    assert.strictEqual(expectedCommands.length, 7);
    assert.deepStrictEqual(
      [...new Set(expectedCommands)].sort(),
      [...expectedCommands].sort(),
    );
    assert.deepStrictEqual(contributedCommands.sort(), expectedCommands.sort());
  });
});
