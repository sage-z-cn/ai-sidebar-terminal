import * as assert from "assert";
import * as vscode from "vscode";

interface ViewContainerContribution {
  id?: string;
  title?: string;
  icon?: string;
}

interface ViewContribution {
  id?: string;
  name?: string;
  type?: string;
}

interface MenuContribution {
  command?: string;
  group?: string;
  when?: string;
}

interface KeybindingContribution {
  command?: string;
  key?: string;
  mac?: string;
  when?: string;
}

interface ExtensionPackageJSON {
  contributes?: {
    viewsContainers?: Record<string, ViewContainerContribution[]>;
    views?: Record<string, ViewContribution[]>;
    menus?: Record<string, MenuContribution[]>;
    keybindings?: KeybindingContribution[];
  };
}

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "sagez.ai-sidebar-terminal",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

async function getPackageJSON(): Promise<ExtensionPackageJSON> {
  const extension = await activateExtension();
  return extension.packageJSON as ExtensionPackageJSON;
}

suite("Package contribution metadata", () => {
  test("contributes the Open Sidebar Terminal view container", async () => {
    const packageJSON = await getPackageJSON();
    const secondarySidebar =
      packageJSON.contributes?.viewsContainers?.secondarySidebar ?? [];
    const container = secondarySidebar.find(
      ({ id }) => id === "ai-sidebar-terminalContainer",
    );

    assert.ok(container, "ai-sidebar-terminalContainer should be contributed");
    assert.strictEqual(container.title, "Open Sidebar Terminal");
    assert.strictEqual(container.icon, "resources/activity-bar.svg");
  });

  test("contributes terminal view metadata", async () => {
    const packageJSON = await getPackageJSON();
    const views =
      packageJSON.contributes?.views?.["ai-sidebar-terminalContainer"] ?? [];
    const terminalView = views.find(({ id }) => id === "ai-sidebar-terminal-view");

    assert.ok(terminalView, "ai-sidebar-terminal-view webview should be contributed");
    assert.strictEqual(terminalView.type, "webview");
  });

  test("contributes editor and explorer context menus", async () => {
    const packageJSON = await getPackageJSON();
    const menus = packageJSON.contributes?.menus;
    const editorContext = menus?.["editor/context"] ?? [];
    const explorerContext = menus?.["explorer/context"] ?? [];

    assert.ok(
      editorContext.some(
        ({ command, group }) =>
          command === "ai-sidebar-terminal.sendAtMention" && group === "navigation",
      ),
      "editor/context should include sendAtMention",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ai-sidebar-terminal.sendToAiTerminal" &&
          group === "0_ai_sidebar_terminal@1" &&
          when === "!explorerResourceIsFolder",
      ),
      "explorer/context should include file send command",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ai-sidebar-terminal.sendToAiTerminal" &&
          group === "0_ai_sidebar_terminal@1" &&
          when === "explorerResourceIsFolder",
      ),
      "explorer/context should include folder send command",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ai-sidebar-terminal.sendAbsoluteToAiTerminal" &&
          group === "0_ai_sidebar_terminal@2" &&
          when === "!explorerResourceIsFolder",
      ),
      "explorer/context should include absolute path file send command",
    );
    assert.ok(
      explorerContext.some(
        ({ command, group, when }) =>
          command === "ai-sidebar-terminal.sendAbsoluteToAiTerminal" &&
          group === "0_ai_sidebar_terminal@2" &&
          when === "explorerResourceIsFolder",
      ),
      "explorer/context should include absolute path folder send command",
    );
  });

  test("contributes required keyboard shortcuts", async () => {
    const packageJSON = await getPackageJSON();
    const keybindings = packageJSON.contributes?.keybindings ?? [];
    const expectedKeybindings = [
      {
        command: "ai-sidebar-terminal.sendAtMention",
        key: "alt+a",
        mac: "alt+a",
      },
      {
        command: "ai-sidebar-terminal.sendAllOpenFiles",
        key: "ctrl+alt+a",
        mac: "cmd+alt+a",
      },
    ];

    for (const expected of expectedKeybindings) {
      assert.ok(
        keybindings.some(
          ({ command, key, mac }) =>
            command === expected.command &&
            key === expected.key &&
            mac === expected.mac,
        ),
        `${expected.command} should have ${expected.mac} keybinding`,
      );
    }
  });
});


