# Webview Terminal Agent Notes

## Scope

- `src/webview/terminal/` owns the xterm.js lifecycle: instance creation, config parsing, keyboard routing, fit/resize/visibility, HTML generation, and the AI-tool-selector overlay markup.
- Sibling webview modules (`messages/`, `dragdrop/`, `clipboard/`, `links/`, `toolbar/`, `shared/`) are documented in `src/webview/AGENTS.md`; this file covers the terminal subdir only.

## Files

| File | Role |
|---|---|
| `index.ts` | `initTerminal()` — primary xterm bootstrap; returns `{ terminal, fitAddon, dispose }` |
| `config.ts` | Parses `TerminalConfig` from `#terminal-container` `data-*` attributes |
| `terminal-container.ts` | Emits the `<div id="terminal-container" data-*>` fragment |
| `keyboard.ts` | `attachCustomKeyEventHandler` wiring; `ALWAYS_TERMINAL_CONTROL` set |
| `resize.ts` | `ResizeObserver` + `IntersectionObserver` + initial-fit phases |
| `html.ts` | Full-page HTML composition (CSP, nonce, CSS/JS URIs, toolbar, selector) |
| `toolbar.ts` / `toolbar.html` | Toolbar render from `?raw` HTML, l10n-localized |
| `ai-selector.ts` / `ai-selector.html` | AI-tool-selector overlay markup loader |
| `html-asset.d.ts` | Type decl for `*.html?raw` webpack loader |
| `terminal.css` (in parent `src/webview/`) | All webview styles |

## initTerminal() Sequence (order-sensitive)

1. Read config from `container.dataset.*`
2. Create `Terminal` (cursorBlink/style, fontSize, fontFamily, theme, scrollback)
3. `attachCustomKeyEventHandler(handler)`
4. Load `FitAddon`
5. Load `WebLinksAddon`
6. `terminal.open(container)`
7. Load `WebglAddon` (try/catch — silent fallback to canvas renderer, no addon swap)
8. `registerLinkProvider(...)` — **after** renderer init so link underline layer sets up correctly
9. Install wheel/contextmenu/drag/focus events
10. `setupVisibilityHandling()` (IntersectionObserver, threshold 0.1)
11. `setupResizeHandling()` (ResizeObserver + window.resize, 50ms debounce)
12. `performInitialFit()` — three-phase (see below)

## Fit Timing

Initial fit runs in three scheduled phases — all three fire, do not collapse them:

- `requestAnimationFrame` → `fit()` + post `ready` (with cols/rows)
- `setTimeout(100ms)` → `fit()` + `refresh()` + post `terminalResize`
- `setTimeout(500ms)` → `fit()` + `refresh()`

Other fit triggers: window resize (50ms debounce), container resize (rAF + 50ms debounce via ResizeObserver), `webviewVisible` host message (50ms timeout), `terminalConfig` update (immediate), post-`clearTerminal` (immediate).

`scheduleRefresh()` (in `../shared/utils.ts`) rAF-debounces `terminal.refresh()` so overlapping fits do not stack screen updates.

## Keyboard Routing (`keyboard.ts`)

- `ALWAYS_TERMINAL_CONTROL` — shell/TUI control chords (Ctrl+C, Ctrl+D, etc.) are **always** routed to the terminal; never suppress for IDE shortcuts.
- Paste (`Cmd/Ctrl+V`) and copy are intercepted and routed through the host via `setClipboard` / `triggerPaste` messages.
- `Shift+Enter` → emits `\n`.
- `sendKeybindingsToShell` setting toggles whether Ctrl/Cmd+letter/number chords pass through to the terminal.

## Dual xterm Creation Paths

- `initTerminal()` (here) creates the primary instance.
- `TerminalManager` (in parent `src/webview/terminal-manager.ts`) has its own `.create()`. `main.ts` calls `initTerminal()` first, then `terminalManager.register(result)`. If `register()` is called with no instance, it falls back to `this.create()`.
- Know which path owns the current instance before recreating or disposing.

## Drag/Drop Layers

Drag/drop handlers exist at three levels; window-level fires first:
1. `index.ts` window-level (captures OS/Finder drag overlays)
2. `terminal-manager.ts` container-level (own file-path extraction)
3. `dragdrop/index.ts` shared `handleDrop()` (called by #1)

All three share the same extraction logic but #2 has a duplicated copy. When changing drop behavior, audit all three.

## Constraints

- `*.html?raw` imports are inlined as source strings via webpack `asset/source` loader — the `.d.ts` declares the module shape.
- CSP requires nonce on all inline scripts; `cspSource` comes from the host webview object.
- WebGL fallback is silent — there is no explicit CanvasAddon swap.

## Verification

- Tests use `// @vitest-environment jsdom` and mock `../shared/vscode-api`.
- `src/webview/**` is excluded from coverage thresholds; webview tests run but do not count.
