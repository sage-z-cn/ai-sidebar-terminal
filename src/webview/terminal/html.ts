import { renderAiSelector } from "./ai-selector";
import {
  renderTerminalContainer,
  type TerminalContainerParams,
} from "./terminal-container";
import { renderToolbar, toolbarL10nStrings } from "./toolbar";

export interface TerminalHtmlParams extends TerminalContainerParams {
  cspSource: string;
  nonce: string;
  cssUri: string;
  scriptUri: string;
}

export function renderTerminalHtml({
  cspSource,
  nonce,
  cssUri,
  scriptUri,
  fontSize,
  fontFamily,
  cursorBlink,
  cursorStyle,
  scrollback,
  sendKeybindingsToShell,
  focusIndicatorMode,
  focusIndicatorBorderWidth,
}: TerminalHtmlParams): string {
  const toolbarL10nScript = `<script nonce="${nonce}">window.__TOOLBAR_L10N__=${JSON.stringify(toolbarL10nStrings)};</script>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open Sidebar Terminal</title>
    <link rel="stylesheet" href="${cssUri}" />
    ${toolbarL10nScript}
  </head>
  <body>
    ${renderToolbar()}
    ${renderTerminalContainer({
      fontSize,
      fontFamily,
      cursorBlink,
      cursorStyle,
      scrollback,
      sendKeybindingsToShell,
      focusIndicatorMode,
      focusIndicatorBorderWidth,
    })}
    ${renderAiSelector()}
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}
