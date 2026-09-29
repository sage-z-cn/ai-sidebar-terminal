import { l10n } from "../../i18n";
import html from "./toolbar.html?raw";

const titleL10nMap: Record<string, string> = {
  toggleEditor: l10n.t("Switch to Editor"),
  restart: l10n.t("Restart Terminal"),
  fontDecrease: l10n.t("Decrease Font Size"),
  fontIncrease: l10n.t("Increase Font Size"),
  fontReset: l10n.t("Reset Font Size"),
  settings: l10n.t("Settings"),
  extensionSettings: l10n.t("Extension Settings"),
  keybindSettings: l10n.t("Keyboard Shortcut Settings"),
  keymap: l10n.t("Opencode Keymap"),
  openCodeCliSettings: l10n.t("Opencode CLI Config"),
  openCodeGlobalAgentsMd: l10n.t("Global AGENTS.md"),
  openCodeGlobalConfig: l10n.t("Opencode Config"),
};

function localizeTitles(input: string): string {
  return input.replace(/\{\{t:(\w+)\}\}/g, (_, key: string) => {
    return titleL10nMap[key] ?? `{{t:${key}}}`;
  });
}

export const toolbarL10nStrings: Record<string, string> = {
  switchToEditor: titleL10nMap.toggleEditor,
  switchToSidebar: l10n.t("Switch to Sidebar"),
  default: l10n.t("default"),
};

export function renderToolbar(): string {
  return localizeTitles(html);
}
