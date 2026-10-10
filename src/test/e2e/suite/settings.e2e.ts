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
    "sagez.opencode-cli-sidebar",
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
      properties["opencode-cli-sidebar.opencode.commandPath"]?.type,
      "string",
    );
    assert.strictEqual(
      properties["opencode-cli-sidebar.opencode.commandPath"]?.default,
      "opencode",
    );
  });

  test("opencode.args defaults to an empty string array", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const args = properties["opencode-cli-sidebar.opencode.args"] as {
      type?: string;
      items?: { type?: string };
      default?: string[];
    };

    assert.ok(args, "opencode-cli-sidebar.opencode.args should be contributed");
    assert.strictEqual(args.type, "array");
    assert.strictEqual(args.items?.type, "string");
    assert.deepStrictEqual(args.default, []);
  });

  test("opencode.continueLastSession defaults to true", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    assert.strictEqual(
      properties["opencode-cli-sidebar.opencode.continueLastSession"]?.type,
      "boolean",
    );
    assert.strictEqual(
      properties["opencode-cli-sidebar.opencode.continueLastSession"]?.default,
      true,
    );
  });
});

suite("Focus indicator settings", () => {
  test('focusIndicatorMode defaults to "bottomBorder"', async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    const mode = properties["opencode-cli-sidebar.focusIndicatorMode"];
    assert.ok(
      mode,
      "opencode-cli-sidebar.focusIndicatorMode should be contributed",
    );
    assert.strictEqual(mode.type, "string");
    assert.strictEqual(mode.default, "bottomBorder");
    assert.deepStrictEqual(mode.enum, ["off", "bottomBorder", "fullBorder"]);
  });

  test("focusIndicatorBorderWidth defaults to 2 within a 1-8 range", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);

    const width = properties["opencode-cli-sidebar.focusIndicatorBorderWidth"];
    assert.ok(
      width,
      "opencode-cli-sidebar.focusIndicatorBorderWidth should be contributed",
    );
    assert.strictEqual(width.type, "number");
    assert.strictEqual(width.default, 2);
    assert.strictEqual(width.minimum, 1);
    assert.strictEqual(width.maximum, 8);
  });
});


