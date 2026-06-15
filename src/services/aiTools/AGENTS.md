# AI Tools Agent Notes

## Scope

- `src/services/aiTools/` holds the operator extension point: one interface (`AiToolOperator.ts`), one registry (`AiToolOperatorRegistry.ts`), and per-tool implementations under `operators/`.
- Operators are stateless strategy objects. There are no `start()`/`stop()`/`dispose()` lifecycle hooks; process lifecycle is owned by `SessionRuntime` + `TerminalManager`.

## Interface Contract

`AiToolOperator` is a pure `interface` (no abstract base class, no shared helpers). Every operator implements all of:

- `id: string`, `aliases: readonly string[]` — identity
- `matches(AiToolConfig): boolean` — name/alias/operator field match
- `getLaunchCommand(AiToolConfig): string` — shell command string
- `supportsHttpApi(tool): boolean` — if true, `SessionRuntime` calls `portManager.assignPortToTerminal()` and passes `_EXTENSION_OPENCODE_PORT` + `OPENCODE_CALLER=vscode`
- `supportsAutoContext(tool): boolean` — gates editor-context auto-share
- `formatFileReference(AiToolFileReference): string` — `@file` syntax (varies per tool)
- `formatDroppedFiles(paths, { useAtSyntax }): string`
- `formatPastedImage(tempPath): string | undefined` — `undefined` means tool does not support images

## Registry Mechanics

- `AiToolOperatorRegistry` constructor **hardcodes** the operator list — no DI, no plugin discovery, no config-driven registration.
- `getForConfig(tool)` returns first `matches()` hit; **falls back to `new CodexToolOperator()` if none match** (the fallback instance is not tracked in the array).
- Registry is instantiated in `TerminalProvider` constructor, then passed into `SessionRuntime`.
- Operators never reference `PortManager` directly — `SessionRuntime` reads `supportsHttpApi()` and does port work itself.

## Adding An Operator (5 file changes)

1. `src/services/aiTools/operators/<Name>Operator.ts` — implement interface.
2. `AiToolOperatorRegistry.ts` — import + add to constructor array (lines ~18-25).
3. `src/types.ts` — optional: add entry to `DEFAULT_AI_TOOLS`; if added, its `operator` field MUST equal the operator's `id`.
4. `package.json` — optional: mirror the `DEFAULT_AI_TOOLS` entry in `ai-sidebar-terminal.aiTools.default`.
5. `<Name>Operator.test.ts` — colocated; use `OpenCodeToolOperator.test.ts` (covers all 8 methods) as the template.

## Template Selection

| New tool behavior | Copy from |
|---|---|
| HTTP API + auto-context (`@file#L10-L20`) | `OpenCodeToolOperator` |
| OpenCode-derived, same syntax | `MimoCodeOperator` |
| No HTTP, standard `#L` syntax | `ClaudeCodeToolOperator` or `CodexToolOperator` |
| Colon-separated ranges (`@file:10-20`) | `KimiCodeOperator` |
| `@file` only, no line ranges | `GeminiCLIOperator` |
| No custom behavior needed | skip — unmatched tools fall back to Codex behavior |

## Gotchas

- **Qwen has no operator**: `DEFAULT_AI_TOOLS` contains a `"qwen"` entry without an `operator` field. `getForConfig()` returns a fresh `CodexToolOperator` for it. Give Qwen custom behavior by adding an operator, not by editing Codex.
- Operators ignore the `tool` arg in `supportsHttpApi`/`supportsAutoContext` today; the param exists for future per-config decisions.
- File naming is mixed (`*ToolOperator` vs `*Operator`); match the closest analog.

## Verification

- Registry tests: `AiToolOperatorRegistry.test.ts`.
- Per-operator tests colocated under `operators/*.test.ts`.
