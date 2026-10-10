# Providers Agent Notes

## Scope

- Providers are extension-host code that bridge VS Code webviews/actions to services.
- Current provider files are `TerminalProvider.ts`, `MessageRouter.ts`, `SessionRuntime.ts`, `CodeActionProvider.ts`, and `openFile.ts`.
- Do not assume a dashboard or multi-backend provider exists; the current tree only has the providers listed above.

## Responsibility Split

- `TerminalProvider` owns VS Code webview lifecycle, HTML generation, pending webview messages, and `DataThrottleService` integration.
- `MessageRouter` dispatches normal `WebviewMessage` values: terminal input/resize, ready, drag/drop, paste/image paste, file open, external terminal list, and restart/settings messages.
- `SessionRuntime` owns terminal session state: start/restart, active instance switching, HTTP client readiness, and listener reconnects.
- `CodeActionProvider` stays focused on diagnostic code actions and sends prompts through the provider path.

## Single-Terminal Flow

- Startup: webview sends `ready`; `MessageRouter.handleReady()` starts the session if needed.
- Instance switching: `SessionRuntime` listens to `InstanceStore.onDidSetActive`; `TerminalProvider.switchToInstance()` clears the terminal, reconnects listeners to an existing terminal, or force-restarts the OpenCode session.
- `TerminalProvider.postWebviewMessage()` throttles `terminalOutput` through `DataThrottleService`.

## Constraints

- Providers can use Node/VS Code APIs, but browser rendering and DOM behavior belong in `src/webview`.
- Any message shape used here must be declared in `src/types.ts`; no arbitrary provider-only payloads.
- Do not put process lifecycle or port allocation directly in `MessageRouter`; route through `SessionRuntime`, `TerminalManager`, and services.
- `TerminalProvider.getHtmlForWebview()` loads only `dist/webview.js` plus copied CSS assets; do not reference a dashboard bundle unless webpack is changed.

## Verification

- Provider tests are colocated: `TerminalProvider.test.ts`, `MessageRouter.test.ts`, `SessionRuntime.test.ts`, and `CodeActionProvider.test.ts`.
