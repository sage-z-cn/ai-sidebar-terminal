# AI Sidebar Terminal Agent Notes

## Project Shape

- VS Code extension in strict TypeScript. Runtime entry is `src/extension.ts`; activation/deactivation is delegated to `src/core/ExtensionLifecycle.ts`.
- Extension-host code lives in `src/core`, `src/providers`, `src/services`, and `src/terminals`; browser sandbox code lives in `src/webview`.
- Host <-> webview message contracts are discriminated unions in `src/types.ts`; update them before adding or changing message payloads.
- `TerminalBackendType` is currently only `"native"`. If multi-backend support is reintroduced, both the code and `package.json` must be updated together; do not trust legacy docs.
- User-visible strings go through `src/i18n.ts` / `l10n.t()`, with zh-CN translations in `l10n/bundle.l10n.zh-cn.json`.
- More specific notes exist in `src/core/AGENTS.md`, `src/providers/AGENTS.md`, `src/services/AGENTS.md`, `src/webview/AGENTS.md`, and `src/test/AGENTS.md`; read the nearest one before editing that area.

## Commands

- Install with `npm install`; keep `package-lock.json` and do not switch package managers casually.
- `npm run compile` builds webpack outputs `dist/extension.js` and `dist/webview.js`.
- `npm run watch` is the VS Code launch-task watch build.
- `npm run package` runs `npm run compile` then writes `build/extension.vsix`.
- `npm run build-and-install` compiles, packages `build/ai-sidebar-terminal-<version>.vsix`, then installs it with `code --install-extension --force`.
- `npm run lint` is `eslint src --ext ts`; the ESLint config is intentionally minimal and ignores `dist`, `build`, `coverage`, `node_modules`, `.sisyphus`.
- `npm run test` runs Vitest unit tests; focused runs use `npx vitest run src/path/File.test.ts` or `npx vitest run -t "test name"`.
- `npm run test:coverage` enforces 80% lines/functions/statements and 70% branches; `src/webview/**` is excluded from coverage.
- `npm run test:e2e` runs `pretest:e2e` (`compile` + `compile:e2e`) then `vscode-test`.
- `scripts/check-l10n.js` checks missing/extra `l10n.t()` keys but is not wired into package scripts.

## Single-Terminal Model

- Session/instance switching is handled in the extension host via `InstanceQuickPick`, `InstanceStore`, and `SessionRuntime`.
- Instance switching: `InstanceQuickPick` calls `InstanceStore.setActive()`, `SessionRuntime` subscribes via `onDidSetActive`, and `TerminalProvider.switchToInstance()` reconnects to an existing terminal or force-restarts the selected AI tool.
- `SessionRuntime` manages a single terminal session; there is no multi-pane or tab switching in the webview.
- Terminal output is throttled through `DataThrottleService` for smooth rendering.

## Architecture Constraints

- `ExtensionLifecycle` creates services/providers/code actions and delegates command registration to `src/core/commands`; do not register commands directly in providers.
- Providers bridge VS Code/webview actions to services. Keep terminal state, discovery, ports, and process lifecycle in services or `SessionRuntime`, not ad hoc provider state.
- `TerminalProvider` owns webview lifecycle and HTML, `MessageRouter` owns message dispatch, and `SessionRuntime` owns process/session start, restart, reconnect, and instance switching.
- Instance state should flow through `InstanceStore`; avoid parallel caches for active instances or discovered processes.
- Use `PortManager.getInstance(...)` / `portManager` for ports; OpenCode HTTP discovery uses ephemeral range `16384-65535`.
- Use `OutputChannelService.getInstance()`; tests can reset through the provided reset path. Do not instantiate `OutputChannelService` directly.
- AI tool behavior belongs in `src/services/aiTools` via `AiToolOperatorRegistry` and per-tool operators, not scattered command conditionals.

## Webview Constraints

- `src/webview` is browser-only: no `fs`, `path`, `os`, child processes, or VS Code extension-host APIs.
- Host communication must use `WebviewMessage` / `HostMessage` from `src/types.ts`.
- xterm sizing is timing-sensitive; fit after fonts are ready and after terminal becomes visible; avoid fitting hidden DOM nodes.
- Webpack currently has one webview entry: `src/webview/main.ts`; do not assume a second webview bundle unless you add a new entry to `webpack.config.js`.

## Packaging Notes

- `package.json` contributes commands, keybindings, settings, and secondary-sidebar webview registration. If adding a command/setting in code, update `package.json` and l10n keys together.
- Minimum runtime requirements are VS Code `^1.106.0` and Node `>=20.0.0`.
- README is bilingual: `README.md` (English) and `README.zh-CN.md` (Chinese). Any change to one must be mirrored in the other.
