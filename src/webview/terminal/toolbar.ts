import { l10n } from "../../i18n";
import html from "./toolbar.html?raw";

const titleL10nMap: Record<string, string> = {
  toggleEditor: l10n.t("Switch to editor"),
  restart: l10n.t("Restart terminal"),
  fontDecrease: l10n.t("Decrease font size"),
  fontIncrease: l10n.t("Increase font size"),
  fontReset: l10n.t("Reset font size"),
  settings: l10n.t("Settings"),
  extensionSettings: l10n.t("Extension settings"),
  keybindSettings: l10n.t("Keyboard shortcut settings"),
};

function localizeTitles(input: string): string {
  return input.replace(/\{\{t:(\w+)\}\}/g, (_, key: string) => {
    return titleL10nMap[key] ?? `{{t:${key}}}`;
  });
}

export const toolbarL10nStrings: Record<string, string> = {
  switchToEditor: titleL10nMap.toggleEditor,
  switchToSidebar: l10n.t("Switch to sidebar"),
  default: l10n.t("default"),
};

export function renderToolbar(): string {
  return localizeTitles(html);
}
