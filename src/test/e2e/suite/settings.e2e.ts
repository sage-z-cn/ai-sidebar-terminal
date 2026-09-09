import * as assert from "assert";
import * as vscode from "vscode";

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  items?: unknown;
  required?: string[];
  properties?: Record<string, ConfigurationProperty>;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
}

async function activateExtension(): Promise<vscode.Extension<unknown>> {
  const extension = vscode.extensions.getExtension(
    "sagez.ai-sidebar-terminal",
  );

  assert.ok(extension, "Extension should be available in the test host");
  await extension.activate();
  return extension;
}

function getConfigurationProperties(
  extension: vscode.Extension<unknown>,
): Record<string, ConfigurationProperty> {
  const packageJSON = extension.packageJSON as {
    contributes?: {
      configuration?: {
        properties?: Record<string, ConfigurationProperty>;
      };
    };
  };

  const properties = packageJSON.contributes?.configuration?.properties;
  assert.ok(properties, "Extension should contribute configuration properties");
  return properties;
}

suite("AI tool settings", () => {
  test("promptAiToolOnSession defaults to true", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ai-sidebar-terminal.promptAiToolOnSession"]?.default,
      true,
    );
  });

  test('defaultAiTool defaults to "opencode"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ai-sidebar-terminal.defaultAiTool"]?.default,
      "opencode",
    );
  });

  test("aiTools config structure is correct", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const aiTools = properties["ai-sidebar-terminal.aiTools"];

    assert.ok(aiTools, "ai-sidebar-terminal.aiTools should be contributed");
    assert.strictEqual(aiTools.type, "array");

    const items = aiTools.items as ConfigurationProperty | undefined;
    assert.ok(items, "ai-sidebar-terminal.aiTools should define array item schema");
    assert.strictEqual(items.type, "object");
    assert.deepStrictEqual(items.required, ["name", "label"]);

    const itemProperties = items.properties;
    assert.ok(itemProperties, "AI tool item schema should define properties");
    assert.strictEqual(itemProperties.name?.type, "string");
    assert.strictEqual(itemProperties.label?.type, "string");
    assert.strictEqual(itemProperties.path?.type, "string");
    assert.strictEqual(itemProperties.args?.type, "array");
    assert.strictEqual(itemProperties.aliases?.type, "array");
    assert.strictEqual(itemProperties.operator?.type, "string");

    assert.deepStrictEqual(aiTools.default, [
      {
        name: "opencode",
        label: "OpenCode",
        path: "",
        args: [],
        operator: "opencode",
      },
      {
        name: "claude",
        label: "Claude",
        path: "",
        args: [],
        aliases: ["claude"],
        operator: "claude",
      },
      {
        name: "codex",
        label: "Codex",
        path: "",
        args: [],
        operator: "codex",
      },
    ]);
  });
});

suite("Focus indicator settings", () => {
  test('focusIndicatorMode defaults to "off"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    const mode = properties["ai-sidebar-terminal.focusIndicatorMode"];
    assert.ok(
      mode,
      "ai-sidebar-terminal.focusIndicatorMode should be contributed",
    );
    assert.strictEqual(mode.type, "string");
    assert.strictEqual(mode.default, "off");
    assert.deepStrictEqual(mode.enum, ["off", "bottomBorder", "fullBorder"]);
  });

  test("focusIndicatorBorderWidth defaults to 2 within a 1-8 range", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    const width = properties["ai-sidebar-terminal.focusIndicatorBorderWidth"];
    assert.ok(
      width,
      "ai-sidebar-terminal.focusIndicatorBorderWidth should be contributed",
    );
    assert.strictEqual(width.type, "number");
    assert.strictEqual(width.default, 2);
    assert.strictEqual(width.minimum, 1);
    assert.strictEqual(width.maximum, 8);
  });
});


