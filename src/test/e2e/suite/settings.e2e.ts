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

suite("OpenCode settings", () => {
  test('opencode.commandPath defaults to "opencode"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ai-sidebar-terminal.opencode.commandPath"]?.type,
      "string",
    );
    assert.strictEqual(
      properties["ai-sidebar-terminal.opencode.commandPath"]?.default,
      "opencode",
    );
  });

  test("opencode.args defaults to an empty string array", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const args = properties["ai-sidebar-terminal.opencode.args"] as {
      type?: string;
      items?: { type?: string };
      default?: string[];
    };

    assert.ok(args, "ai-sidebar-terminal.opencode.args should be contributed");
    assert.strictEqual(args.type, "array");
    assert.strictEqual(args.items?.type, "string");
    assert.deepStrictEqual(args.default, []);
  });

  test("opencode.continueLastSession defaults to true", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["ai-sidebar-terminal.opencode.continueLastSession"]?.type,
      "boolean",
    );
    assert.strictEqual(
      properties["ai-sidebar-terminal.opencode.continueLastSession"]?.default,
      true,
    );
  });
});

suite("Focus indicator settings", () => {
  test('focusIndicatorMode defaults to "bottomBorder"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    const mode = properties["ai-sidebar-terminal.focusIndicatorMode"];
    assert.ok(
      mode,
      "ai-sidebar-terminal.focusIndicatorMode should be contributed",
    );
    assert.strictEqual(mode.type, "string");
    assert.strictEqual(mode.default, "bottomBorder");
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


