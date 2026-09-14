import * as path from "node:path";

/** Values accepted by an environment layer before it is passed to node-pty. */
export type EnvironmentValue = string | null | undefined;

/** A single ordered environment layer. */
export type EnvironmentLayer = Readonly<
  Record<string, EnvironmentValue>
>;

/** Context used to resolve the portable VS Code terminal variables. */
export interface EnvironmentResolverOptions {
  platform: NodeJS.Platform;
  inheritedEnv: Readonly<Record<string, string>>;
  workspaceFolder?: string;
  userHome: string;
}

/** Inputs used to resolve the ordered environment settings for a process. */
export interface ConfiguredEnvironmentOptions {
  platform: NodeJS.Platform;
  inheritedEnv: Readonly<Record<string, string>>;
  workspaceFolder?: string;
  userHome: string;
  integratedEnv?: unknown;
  extensionEnv?: unknown;
  toolEnv?: unknown;
}

/**
 * Finds an environment key using the platform's comparison rules.
 * Windows environment names are case-insensitive; POSIX names are not.
 */
export function findEnvironmentKey(
  env: Readonly<Record<string, unknown>>,
  key: string,
  platform: NodeJS.Platform,
): string | undefined {
  if (platform !== "win32") {
    return Object.prototype.hasOwnProperty.call(env, key) ? key : undefined;
  }

  const lowerKey = key.toLowerCase();
  return Object.keys(env).find(
    (candidate) => candidate.toLowerCase() === lowerKey,
  );
}

/**
 * Resolves the common terminal variables supported without VS Code's internal
 * configuration resolver. Unknown expressions stay literal so unsupported
 * context-specific variables are not silently corrupted.
 */
export function resolveEnvironmentValue(
  value: string,
  options: EnvironmentResolverOptions,
): string {
  const workspaceFolder = options.workspaceFolder ?? "";
  const workspaceFolderBasename = workspaceFolder
    ? options.platform === "win32"
      ? path.win32.basename(workspaceFolder)
      : path.posix.basename(workspaceFolder)
    : "";
  const pathSeparator = options.platform === "win32" ? "\\" : "/";

  return value.replace(/\$\{([^}]+)\}/g, (placeholder, expression: string) => {
    if (expression.startsWith("env:")) {
      const key = expression.slice("env:".length);
      const resolvedKey = findEnvironmentKey(
        options.inheritedEnv,
        key,
        options.platform,
      );
      return resolvedKey === undefined ? "" : options.inheritedEnv[resolvedKey];
    }

    switch (expression) {
      case "workspaceFolder":
        return workspaceFolder;
      case "workspaceFolderBasename":
        return workspaceFolderBasename;
      case "userHome":
        return options.userHome;
      case "pathSeparator":
        return pathSeparator;
      default:
        return placeholder;
    }
  });
}

/**
 * Converts an untrusted configuration value into an environment layer while
 * retaining `null` as the deletion marker and coercing other scalar values to
 * strings for node-pty compatibility.
 */
export function normalizeEnvironmentLayer(
  raw: unknown,
  resolveValue?: (value: string) => string,
): Record<string, EnvironmentValue> {
  const result: Record<string, EnvironmentValue> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return result;
  }

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      result[key] = resolveValue ? resolveValue(value) : value;
    } else if (value === null) {
      result[key] = null;
    } else if (value !== undefined) {
      result[key] = String(value);
    }
  }

  return result;
}

/**
 * Resolves and merges the terminal, extension, and tool environment layers.
 * The inherited environment is the base and later layers take precedence.
 */
export function resolveConfiguredEnvironment(
  options: ConfiguredEnvironmentOptions,
): Record<string, string> {
  const resolveValue = (value: string): string =>
    resolveEnvironmentValue(value, {
      platform: options.platform,
      inheritedEnv: options.inheritedEnv,
      workspaceFolder: options.workspaceFolder,
      userHome: options.userHome,
    });

  return mergeEnvironment(
    options.platform,
    options.inheritedEnv,
    normalizeEnvironmentLayer(options.integratedEnv, resolveValue),
    normalizeEnvironmentLayer(options.extensionEnv, resolveValue),
    normalizeEnvironmentLayer(options.toolEnv, resolveValue),
  );
}

/**
 * Applies environment layers in order. On Windows, a later value updates the
 * existing key regardless of casing and null/undefined removes that key.
 */
export function mergeEnvironment(
  platform: NodeJS.Platform,
  ...layers: Array<EnvironmentLayer | undefined>
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const layer of layers) {
    if (!layer) {
      continue;
    }

    for (const [key, value] of Object.entries(layer)) {
      const existingKey = findEnvironmentKey(result, key, platform);
      if (value === null || value === undefined) {
        if (existingKey !== undefined) {
          delete result[existingKey];
        }
        continue;
      }

      // Keep the first spelling on Windows so Path/PATH cannot become two
      // entries in node-pty's environment block.
      result[existingKey ?? key] = value;
    }
  }

  return result;
}
