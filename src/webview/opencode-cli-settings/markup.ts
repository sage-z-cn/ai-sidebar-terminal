import { l10n } from "../../i18n";

/** Markup for the OpenCode CLI Settings modal. */
export function renderOpenCodeCliSettingsModal(): string {
  return `
<div class="occs-overlay hidden" id="occs-overlay">
  <div class="occs-modal" role="dialog" aria-modal="true" aria-label="${l10n.t("OpenCode CLI Settings")}">
    <div class="occs-header">
      <div class="occs-title-wrap">
        <h1 class="occs-title" id="occs-title">${l10n.t("OpenCode CLI Settings")}</h1>
        <div class="occs-sub-row">
          <button
            type="button"
            class="occs-sub-link"
            id="occs-open-cli-json"
            title="${l10n.t("Open cli.json")}"
            aria-label="${l10n.t("Open cli.json")}"
          >
            <span class="occs-sub">${l10n.t("TUI Settings")}</span>
            <span class="occs-path hidden" id="occs-path"></span>
          </button>
        </div>
      </div>
      <div class="occs-header-actions">
        <button type="button" class="occs-icon-btn" id="occs-reload" title="${l10n.t("Reload")}" aria-label="${l10n.t("Reload")}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M13.5 8a5.5 5.5 0 1 1-1.64-3.86" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            <path d="M13.5 2.5v3.2h-3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button type="button" class="occs-icon-btn" id="occs-close" aria-label="${l10n.t("Close")}">✕</button>
      </div>
    </div>
    <div class="occs-error hidden" id="occs-error" role="alert"><span id="occs-error-text"></span><button type="button" class="occs-icon-btn" id="occs-error-dismiss" aria-label="${l10n.t("Close")}">×</button></div>
    <div class="occs-main">
      <nav class="occs-side-nav" id="occs-side-nav" aria-label="${l10n.t("Settings groups")}"></nav>
      <div class="occs-body">
        <div class="occs-loading" id="occs-loading" role="status" aria-live="polite">
          <span class="occs-spinner" aria-hidden="true"></span>
          <span id="occs-loading-text">${l10n.t("Loading…")}</span>
        </div>
        <div class="occs-list" id="occs-list"></div>
      </div>
    </div>
  </div>
</div>`;
}

/** Localized strings for browser-side settings module. */
export const openCodeCliSettingsL10nStrings: Record<string, string> = {
  openKeymap: l10n.t("Open keybindings"),
  defaultLabel: l10n.t("Default: {0}"),
  saveFailed: l10n.t("Failed to save. Your config file was not changed."),
  loadFailed: l10n.t("Failed to load OpenCode CLI settings."),
  loading: l10n.t("Loading…"),
};
