import { l10n } from "../../i18n";

/** Markup for the OpenCode settings modal. */
export function renderOpenCodeSettingsModal(): string {
  return `
<div class="ocs-overlay hidden" id="ocs-overlay">
  <div class="ocs-modal" role="dialog" aria-modal="true" aria-label="${l10n.t("OpenCode settings")}">
    <div class="ocs-header">
      <div class="ocs-title-wrap">
        <h1 class="ocs-title" id="ocs-title">${l10n.t("OpenCode settings")}</h1>
        <div class="ocs-sub-row">
          <span class="ocs-sub">${l10n.t("TUI settings")}</span>
          <span class="ocs-path-chip" id="ocs-path"></span>
        </div>
      </div>
      <button type="button" class="ocs-icon-btn" id="ocs-close" aria-label="${l10n.t("Close")}">✕</button>
    </div>
    <div class="ocs-error hidden" id="ocs-error" role="alert"><span id="ocs-error-text"></span><button type="button" class="ocs-icon-btn" id="ocs-error-dismiss" aria-label="${l10n.t("Close")}">×</button></div>
    <div class="ocs-main">
      <nav class="ocs-side-nav" id="ocs-side-nav" aria-label="${l10n.t("Settings groups")}"></nav>
      <div class="ocs-list" id="ocs-list"></div>
    </div>
  </div>
</div>`;
}

/** Localized strings for browser-side settings module. */
export const openCodeSettingsL10nStrings: Record<string, string> = {
  openKeymap: l10n.t("Open keybindings"),
  defaultLabel: l10n.t("Default: {0}"),
  saveFailed: l10n.t("Failed to save. Your config file was not changed."),
  loadFailed: l10n.t("Failed to load OpenCode settings."),
};
