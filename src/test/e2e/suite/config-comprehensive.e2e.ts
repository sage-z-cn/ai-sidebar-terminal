import * as assert from "assert";
import * as vscode from "vscode";

interface ConfigurationProperty {
  type?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  items?: ConfigurationProperty;
  required?: string[];
  properties?: Record<string, ConfigurationProperty>;
}

interface ConfigurationSpec {
  type: string;
  defaultValue: unknown;
  minimum?: number;
  maximum?: number;
  enumValues?: string[];
  itemType?: string;
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

const nerdFontStack =
  "'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace";

const configurationSpecs: Record<string, ConfigurationSpec> = {
  "ai-sidebar-terminal.fontSize": {
    type: "number",
    defaultValue: 12,
    minimum: 6,
    maximum: 25,
  },
  "ai-sidebar-terminal.fontFamily": {
    type: "string",
    defaultValue: nerdFontStack,
  },
  "ai-sidebar-terminal.cursorBlink": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.cursorStyle": {
    type: "string",
    defaultValue: "block",
    enumValues: ["block", "underline", "bar"],
  },
  "ai-sidebar-terminal.scrollback": {
    type: "number",
    defaultValue: 10000,
    minimum: 0,
    maximum: 100000,
  },
  "ai-sidebar-terminal.autoFocusOnSend": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.autoStartOnOpen": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.shellPath": { type: "string", defaultValue: "" },
  "ai-sidebar-terminal.shellArgs": {
    type: "array",
    defaultValue: [],
    itemType: "string",
  },
  "ai-sidebar-terminal.env": { type: "object", defaultValue: {} },
  "ai-sidebar-terminal.sendKeybindingsToShell": {
    type: "boolean",
    defaultValue: true,
  },
  "ai-sidebar-terminal.autoShareContext": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.httpTimeout": {
    type: "number",
    defaultValue: 5000,
    minimum: 1000,
    maximum: 30000,
  },
  "ai-sidebar-terminal.enableHttpApi": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.logLevel": {
    type: "string",
    defaultValue: "info",
    enumValues: ["debug", "info", "warn", "error"],
  },
  "ai-sidebar-terminal.contextDebounceMs": {
    type: "number",
    defaultValue: 500,
    minimum: 100,
    maximum: 5000,
  },
  "ai-sidebar-terminal.maxDiagnosticLength": {
    type: "number",
    defaultValue: 500,
    minimum: 100,
    maximum: 2000,
  },
  "ai-sidebar-terminal.enableAutoSpawn": { type: "boolean", defaultValue: true },
  "ai-sidebar-terminal.codeActionSeverities": {
    type: "array",
    defaultValue: ["error", "warning"],
    itemType: "string",
  },
  "ai-sidebar-terminal.aiTools": { type: "array", defaultValue: undefined },
  "ai-sidebar-terminal.defaultAiTool": { type: "string", defaultValue: "opencode" },
  "ai-sidebar-terminal.promptAiToolOnSession": {
    type: "boolean",
    defaultValue: true,
  },
  "ai-sidebar-terminal.focusIndicatorMode": {
    type: "string",
    defaultValue: "off",
    enumValues: ["off", "bottomBorder", "fullBorder"],
  },
  "ai-sidebar-terminal.focusIndicatorBorderWidth": {
    type: "number",
    defaultValue: 2,
    minimum: 1,
    maximum: 8,
  },
};

function assertConfigurationProperty(
  id: string,
  property: ConfigurationProperty | undefined,
  spec: ConfigurationSpec,
): void {
  assert.ok(property, `${id} should be contributed`);
  assert.strictEqual(property.type, spec.type, `${id} should have expected type`);

  if (id !== "ai-sidebar-terminal.aiTools") {
    assert.deepStrictEqual(
      property.default,
      spec.defaultValue,
      `${id} should have expected default`,
    );
  }

  if (spec.minimum !== undefined) {
    assert.strictEqual(property.minimum, spec.minimum);
  }

  if (spec.maximum !== undefined) {
    assert.strictEqual(property.maximum, spec.maximum);
  }

  if (spec.enumValues) {
    assert.deepStrictEqual(property.enum, spec.enumValues);
  }

  if (spec.itemType) {
    assert.strictEqual(property.items?.type, spec.itemType);
  }
}

suite("Comprehensive configuration contributions", () => {
  test("contributes exactly the expected 24 configuration properties", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const expectedPropertyIds = Object.keys(configurationSpecs).sort();

    assert.strictEqual(expectedPropertyIds.length, 24);
    assert.deepStrictEqual(Object.keys(properties).sort(), expectedPropertyIds);
  });

  for (const [id, spec] of Object.entries(configurationSpecs)) {
    test(`defines ${id} metadata`, async () => {
      const extension = await activateExtension();
      const properties = getConfigurationProperties(extension);

      assertConfigurationProperty(id, properties[id], spec);
    });
  }

  test("defines aiTools object schema and default tools", async () => {
    const extension = await activateExtension();
    const properties = getConfigurationProperties(extension);
    const aiTools = properties["ai-sidebar-terminal.aiTools"];

    assert.strictEqual(aiTools?.type, "array");
    assert.strictEqual(aiTools?.items?.type, "object");
    assert.deepStrictEqual(aiTools?.items?.required, ["name", "label"]);
    assert.strictEqual(aiTools?.items?.properties?.name?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.label?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.path?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.args?.type, "array");
    assert.strictEqual(aiTools?.items?.properties?.aliases?.type, "array");
    assert.strictEqual(aiTools?.items?.properties?.operator?.type, "string");
    assert.strictEqual(aiTools?.items?.properties?.env?.type, "object");
    assert.deepStrictEqual(aiTools?.default, [
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
      {
        name: "agy",
        label: "Antigravity",
        path: "",
        args: [],
        aliases: ["antigravity"],
        operator: "agy",
      },
    ]);
  });
});

suite("Runtime configuration defaults", () => {
  test("reads key defaults from vscode.workspace.getConfiguration", async () => {
    await activateExtension();

    const config = vscode.workspace.getConfiguration("ai-sidebar-terminal");
    const defaultValue = (key: string): unknown =>
      config.inspect(key)?.defaultValue;

    assert.strictEqual(defaultValue("promptAiToolOnSession"), true);
    assert.strictEqual(defaultValue("defaultAiTool"), "opencode");
    assert.deepStrictEqual(defaultValue("aiTools"), [
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
      {
        name: "agy",
        label: "Antigravity",
        path: "",
        args: [],
        aliases: ["antigravity"],
        operator: "agy",
      },
    ]);
    assert.strictEqual(defaultValue("autoStartOnOpen"), true);
    assert.strictEqual(defaultValue("enableHttpApi"), true);
    assert.strictEqual(defaultValue("fontSize"), 12);
  });
});

