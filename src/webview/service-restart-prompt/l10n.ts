/**
 * Service-restart prompt strings.
 *
 * Evaluated on the extension host (same pattern as update/l10n.ts) and
 * injected into the webview document as `window.__SERVICE_RESTART_L10N__`
 * by terminal/html.ts. The webview module reads it with English fallbacks.
 *
 * NOTE: zh-CN translations for these keys live in
 * l10n/bundle.l10n.zh-cn.json (host packaging owns that file).
 */
import { l10n } from "../../i18n";

export const serviceRestartPromptL10nStrings: Record<string, string> = {
  title: l10n.t(
    "Restarting the terminal. Also restart the OpenCode background service?",
  ),
  restartService: l10n.t("Restart all"),
  terminalOnly: l10n.t("Restart terminal only"),
  cancel: l10n.t("Cancel"),
  close: l10n.t("Close"),
};
