/**
 * OpenCode settings modal (cli.json non-keybind settings).
 * Browser-only; communicates via WebviewMessage.
 */
import type {
  HostMessage,
  OpenCodeSettingItem,
  OpenCodeSettingOption,
  OpenCodeSettingsGroupMeta,
  OpenCodeThemeSwatch,
} from "../../types";
import { postMessage } from "../shared/vscode-api";
import { openKeymapModal } from "../keymap";

const l10nStrings: Record<string, string> =
  (typeof window !== "undefined"
    ? (window as unknown as { __OC_SETTINGS_L10N__?: Record<string, string> })
        .__OC_SETTINGS_L10N__
    : undefined) ?? {};

function t(key: string, fallback: string): string {
  return l10nStrings[key] ?? fallback;
}

function formatMessage(
  template: string,
  ...values: Array<string | number>
): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

type SettingsState = {
  items: OpenCodeSettingItem[];
  groups: OpenCodeSettingsGroupMeta[];
  values: Record<string, unknown>;
  overrides: Record<string, boolean>;
  configPath: string;
  themeOptions: OpenCodeSettingOption[];
  plugins: unknown[];
};

const state: SettingsState = {
  items: [],
  groups: [],
  values: {},
  overrides: {},
  configPath: "",
  themeOptions: [],
  plugins: [],
};

const THEME_PREVIEW_DEBOUNCE_MS = 280;

type ThemePickerState = {
  open: boolean;
  /** Value when the dropdown opened — restored on Escape. */
  originalValue: string;
  activeValue: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const themePicker: ThemePickerState = {
  open: false,
  originalValue: "",
  activeValue: "",
  timer: null,
};

let activeGroup = "appearance";
let settingsOpen = false;
let syncingNav = false;
let pendingRerender = false;
let navScrollTarget: number | null = null;
let navScrollUnlockTimer: ReturnType<typeof setTimeout> | null = null;

function $(sel: string): HTMLElement | null {
  return document.querySelector(sel);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  return false;
}

function formatVal(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function isOverride(id: string): boolean {
  return Boolean(state.overrides[id]);
}

function effectiveValue(item: OpenCodeSettingItem): unknown {
  const v = state.values[item.id];
  return v === undefined ? item.def : v;
}

function showSettingsError(message: string): void {
  const box = $("#ocs-error");
  const text = $("#ocs-error-text");
  if (text) text.textContent = message;
  box?.classList.remove("hidden");
}

function hideSettingsError(): void {
  $("#ocs-error")?.classList.add("hidden");
}

/** Persist one setting. Value equal to default deletes the key. */
function persist(item: OpenCodeSettingItem, value: unknown): void {
  if (sameValue(value, item.def)) {
    postMessage({ type: "resetOpenCodeSetting", path: item.id });
    return;
  }
  postMessage({ type: "saveOpenCodeSetting", path: item.id, value });
}

function themeItem(): OpenCodeSettingItem | undefined {
  return itemById("theme.name");
}

function currentThemeValue(): string {
  return String(state.values["theme.name"] ?? "");
}

function clearThemePreviewTimer(): void {
  if (themePicker.timer !== null) {
    clearTimeout(themePicker.timer);
    themePicker.timer = null;
  }
}

function updateThemeTriggerUi(value: string): void {
  const trigger = document.querySelector("[data-oc-theme-trigger]");
  if (!trigger) return;
  const opt = state.themeOptions.find((o) => o.value === value);
  const dots = trigger.querySelector(".ocs-theme-dots");
  if (dots && opt) {
    dots.outerHTML = swatchDotsHtml(opt.swatch, "is-trigger");
  }
  const label = trigger.querySelector(".ocs-theme-label");
  if (label) label.textContent = opt?.label || value || "Default";
}

function setActiveThemeOption(value: string, schedulePreview: boolean): void {
  themePicker.activeValue = value;
  document.querySelectorAll("[data-oc-theme-opt]").forEach((el) => {
    const on = (el as HTMLElement).dataset.ocThemeOpt === value;
    el.classList.toggle("is-active", on);
    if (on) {
      el.scrollIntoView({ block: "nearest" });
    }
  });
  updateThemeTriggerUi(value);
  if (!schedulePreview) return;
  clearThemePreviewTimer();
  themePicker.timer = setTimeout(() => {
    themePicker.timer = null;
    const item = themeItem();
    if (!item) return;
    persist(item, value);
  }, THEME_PREVIEW_DEBOUNCE_MS);
}

function openThemePicker(): void {
  const menu = document.querySelector("[data-oc-theme-menu]");
  const trigger = document.querySelector("[data-oc-theme-trigger]");
  if (!menu || !trigger) return;
  themePicker.open = true;
  themePicker.originalValue = currentThemeValue();
  themePicker.activeValue = themePicker.originalValue;
  menu.classList.remove("hidden");
  trigger.setAttribute("aria-expanded", "true");
  document.getElementById("ocs-overlay")?.classList.add("is-preview");
  setActiveThemeOption(themePicker.activeValue, false);
}

function closeThemePicker(options?: { restore?: boolean }): void {
  clearThemePreviewTimer();
  const menu = document.querySelector("[data-oc-theme-menu]");
  const trigger = document.querySelector("[data-oc-theme-trigger]");
  menu?.classList.add("hidden");
  trigger?.setAttribute("aria-expanded", "false");
  document.getElementById("ocs-overlay")?.classList.remove("is-preview");
  document.querySelectorAll("[data-oc-theme-opt]").forEach((el) => {
    el.classList.remove("is-active");
  });
  if (options?.restore) {
    const item = themeItem();
    if (item && themePicker.activeValue !== themePicker.originalValue) {
      persist(item, themePicker.originalValue);
      updateThemeTriggerUi(themePicker.originalValue);
    }
  }
  themePicker.open = false;
  themePicker.activeValue = "";
}

function commitThemeChoice(value: string): void {
  clearThemePreviewTimer();
  const item = themeItem();
  if (item) {
    persist(item, value);
  }
  updateThemeTriggerUi(value);
  closeThemePicker();
}

function themePickerIndexDelta(delta: number): void {
  const options = state.themeOptions;
  if (!options.length) return;
  const idx = options.findIndex((o) => o.value === themePicker.activeValue);
  const next = options[(idx + delta + options.length) % options.length];
  if (next) {
    setActiveThemeOption(next.value, true);
  }
}

function swatchDotsHtml(swatch?: OpenCodeThemeSwatch, extraClass = ""): string {
  const colors = [swatch?.bg, swatch?.panel, swatch?.primary, swatch?.accent]
    .filter((c): c is string => Boolean(c))
    .slice(0, 3);
  if (!colors.length) {
    return `<span class="ocs-theme-dots ${extraClass}"></span>`;
  }
  const dots = colors
    .map((c) => `<i style="background:${escapeHtml(c)}"></i>`)
    .join("");
  return `<span class="ocs-theme-dots ${extraClass}">${dots}</span>`;
}

function themePickerHtml(current: string): string {
  const options = state.themeOptions;
  const active = options.find((o) => o.value === current) ?? options[0];
  const activeLabel = active?.label || current || t("defaultLabel", "Default");
  const list = options
    .map((opt) => {
      const selected = opt.value === current ? " is-selected" : "";
      return `<div class="ocs-theme-option${selected}" role="option" data-oc-theme-opt="${escapeHtml(opt.value)}" aria-selected="${opt.value === current}">
        ${swatchDotsHtml(opt.swatch)}
        <span class="ocs-theme-option-label">${escapeHtml(opt.label)}</span>
      </div>`;
    })
    .join("");
  return `<div class="ocs-theme-picker" data-oc-theme-picker>
    <button type="button" class="ocs-theme-trigger" data-oc-theme-trigger aria-haspopup="listbox" aria-expanded="false">
      ${swatchDotsHtml(active?.swatch, "is-trigger")}
      <span class="ocs-theme-label">${escapeHtml(activeLabel)}</span>
      <span class="ocs-theme-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="ocs-theme-menu hidden" data-oc-theme-menu role="listbox">${list}</div>
  </div>`;
}

function controlHtml(item: OpenCodeSettingItem): string {
  const val = effectiveValue(item);

  if (item.type === "boolean") {
    const on = Boolean(val);
    return `<label class="ocs-toggle" title="${escapeHtml(item.title)}">
      <input type="checkbox" data-oc-set="${escapeHtml(item.id)}"${on ? " checked" : ""} />
      <span class="slider"></span>
    </label>`;
  }

  if (item.id === "theme.name") {
    return themePickerHtml(String(val ?? ""));
  }

  if (item.type === "enum") {
    let options = item.options ?? [];
    let current = String(val ?? "");
    if (item.id === "debug.turn_tokens") {
      current = val === true ? "on" : val === "verbose" ? "verbose" : "off";
    }
    const opts = options
      .map((opt) => {
        const selected = opt.value === current ? " selected" : "";
        return `<option value="${escapeHtml(opt.value)}"${selected}>${escapeHtml(opt.label)}</option>`;
      })
      .join("");
    return `<select class="ocs-select" data-oc-set="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)}">${opts}</select>`;
  }

  if (item.type === "range") {
    const min = item.min ?? 0;
    const max = item.max ?? 1;
    const step = item.step ?? 0.05;
    const num = Number(val);
    return `<div class="ocs-range-wrap">
      <input type="range" data-oc-set="${escapeHtml(item.id)}" min="${min}" max="${max}" step="${step}" value="${num}" />
      <span class="ocs-range-val">${num.toFixed(2)}</span>
    </div>`;
  }

  if (item.type === "number") {
    const num = Number(val);
    return `<input class="ocs-number" type="number" data-oc-set="${escapeHtml(item.id)}" value="${num}"${item.min !== undefined ? ` min="${item.min}"` : ""}${item.step !== undefined ? ` step="${item.step}"` : ""} />`;
  }

  const text = val === undefined || val === null ? "" : String(val);
  return `<input class="ocs-input" type="text" data-oc-set="${escapeHtml(item.id)}" value="${escapeHtml(text)}" />`;
}

function rowHtml(item: OpenCodeSettingItem): string {
  const mod = isOverride(item.id);
  return `<div class="ocs-row${mod ? " is-modified" : ""}" data-oc-row="${escapeHtml(item.id)}">
    <div class="ocs-row-info">
      <div class="ocs-title-line">
        <span class="ocs-row-title">${escapeHtml(item.title)}</span>
        <span class="ocs-row-id">${escapeHtml(item.id)}</span>
      </div>
      <div class="ocs-row-desc">${escapeHtml(item.desc)}</div>
      ${mod ? `<div class="ocs-default-ghost">${escapeHtml(formatMessage(t("defaultLabel", "Default: {0}"), formatVal(item.def)))}</div>` : ""}
    </div>
    <div class="ocs-row-control">${controlHtml(item)}</div>
  </div>`;
}

function keybindsSectionHtml(): string {
  return `<div class="ocs-section">
    <div class="group-label" id="ocs-group-keybinds">${escapeHtml(groupTitle("keybinds"))}</div>
    <div>
      <button type="button" class="ocs-jump-link" id="ocs-open-keymap">${escapeHtml(t("openKeymap", "Open keybindings"))} →</button>
    </div>
  </div>`;
}

function pluginsSectionHtml(): string {
  const items = state.plugins
    .map((plugin, index) => {
      let label = "";
      if (typeof plugin === "string") {
        label = plugin;
      } else if (plugin && typeof plugin === "object") {
        const pkg = (plugin as { package?: unknown }).package;
        label = typeof pkg === "string" ? pkg : JSON.stringify(plugin);
      } else {
        label = String(plugin);
      }
      return `<div class="ocs-plugin-item"><div>${escapeHtml(label)}</div><span class="tag">#${index + 1}</span></div>`;
    })
    .join("");
  return `<div class="ocs-section">
    <div class="group-label" id="ocs-group-plugins">${escapeHtml(groupTitle("plugins"))}</div>
    <div class="ocs-plugin-list">${items}</div>
  </div>`;
}

function groupTitle(id: string): string {
  return state.groups.find((g) => g.id === id)?.title ?? id;
}

function renderNav(): void {
  const nav = $("#ocs-side-nav");
  if (!nav) return;
  nav.innerHTML = state.groups
    .map((g) => {
      const on = g.id === activeGroup;
      return `<button type="button" class="sn-item${on ? " is-on" : ""}" data-group="${escapeHtml(g.id)}" aria-current="${on ? "true" : "false"}"><span>${escapeHtml(g.title)}</span></button>`;
    })
    .join("");
}

function renderList(): void {
  const list = $("#ocs-list");
  if (!list) return;
  if (themePicker.open) {
    // Don't tear down an in-progress theme preview.
    return;
  }
  clearThemePreviewTimer();
  const scrollTop = list.scrollTop;
  let html = "";
  for (const group of state.groups) {
    if (group.id === "keybinds") {
      html += keybindsSectionHtml();
      continue;
    }
    if (group.id === "plugins") {
      html += pluginsSectionHtml();
      continue;
    }
    const rows = state.items.filter((item) => item.group === group.id);
    html += `<div class="ocs-section">
      <div class="group-label" id="ocs-group-${escapeHtml(group.id)}">${escapeHtml(group.title)}</div>
      ${rows.map((item) => rowHtml(item)).join("")}
    </div>`;
  }
  list.innerHTML = html;
  list.scrollTop = scrollTop;
}

function listEl(): HTMLElement | null {
  return $("#ocs-list");
}

function isFocusInList(): boolean {
  const list = listEl();
  return Boolean(
    list &&
      document.activeElement instanceof Node &&
      list.contains(document.activeElement),
  );
}

function flushPendingRerender(): void {
  if (!pendingRerender) return;
  if (navScrollTarget !== null) return;
  if (isFocusInList()) return;
  pendingRerender = false;
  renderNav();
  renderList();
}

function scrollToGroup(groupId: string): void {
  const list = listEl();
  const label = document.getElementById(`ocs-group-${groupId}`);
  if (!list || !label) return;
  // Anchor to the group's first data row: a sticky label pinned inside a
  // scrolled-past section reports a shifted rect, not its layout position.
  const row = label.nextElementSibling as HTMLElement | null;
  const anchor =
    row && row.classList.contains("ocs-row")
      ? row
      : (label.nextElementSibling as HTMLElement) || label;
  syncingNav = true;
  if (navScrollUnlockTimer !== null) {
    clearTimeout(navScrollUnlockTimer);
  }
  activeGroup = groupId;
  renderNav();

  // Layout coordinate of the anchor (viewport-independent). Land the first
  // row below the stuck sticky label so the label does not cover it.
  const labelHeight = label.getBoundingClientRect().height;
  const top = Math.max(
    0,
    anchor.getBoundingClientRect().top -
      list.getBoundingClientRect().top +
      list.scrollTop -
      (anchor === label ? 0 : labelHeight + 4),
  );
  navScrollTarget = top;

  const unlock = (): void => {
    if (navScrollUnlockTimer !== null) {
      clearTimeout(navScrollUnlockTimer);
      navScrollUnlockTimer = null;
    }
    syncingNav = false;
    // 动画被中途取消（滚轮惯性、重渲染）时瞬时补齐到目标。
    if (
      navScrollTarget !== null &&
      Math.abs(list.scrollTop - navScrollTarget) >= 2
    ) {
      list.scrollTo({ top: navScrollTarget, behavior: "auto" });
    }
    navScrollTarget = null;
    activeGroup = groupId;
    renderNav();
    flushPendingRerender();
  };
  list.scrollTo({ top, behavior: "smooth" });
  list.addEventListener("scrollend", unlock, { once: true });
  navScrollUnlockTimer = setTimeout(unlock, 700);
}

function syncNavFromScroll(): void {
  if (syncingNav || !state.groups.length) return;
  const list = listEl();
  if (!list) return;
  const listTop = list.getBoundingClientRect().top;
  let current = activeGroup;
  for (const g of state.groups) {
    const node = document.getElementById(`ocs-group-${g.id}`);
    if (!node) continue;
    if (node.getBoundingClientRect().top - listTop <= 8) {
      current = g.id;
    }
  }
  if (current !== activeGroup) {
    activeGroup = current;
    renderNav();
  }
}

function itemById(id: string): OpenCodeSettingItem | undefined {
  return state.items.find((item) => item.id === id);
}

function onControlChange(target: HTMLElement): void {
  const id = target.dataset.ocSet;
  if (!id) return;
  const item = itemById(id);
  if (!item) return;

  if (item.type === "boolean") {
    persist(item, (target as HTMLInputElement).checked);
    return;
  }
  if (item.type === "enum") {
    let value: unknown = (target as HTMLSelectElement).value;
    if (item.id === "debug.turn_tokens") {
      // Schema is boolean | "verbose"; UI maps off → default, on → true.
      if (value === "off") value = item.def;
      else if (value === "on") value = true;
      else value = "verbose";
    }
    persist(item, value);
    return;
  }
  if (item.type === "range") {
    const num = Number((target as HTMLInputElement).value);
    const label = target.parentElement?.querySelector(".ocs-range-val");
    if (label) label.textContent = num.toFixed(2);
    persist(item, num);
    return;
  }
  if (item.type === "number") {
    const raw = (target as HTMLInputElement).value;
    const num = Number(raw);
    if (raw.trim() === "" || Number.isNaN(num)) {
      // Restore the effective value; do not persist a coerced 0.
      (target as HTMLInputElement).value = String(effectiveValue(item));
      return;
    }
    persist(item, num);
    return;
  }
  persist(item, (target as HTMLInputElement).value.trim());
}

function onControlInput(target: HTMLElement): void {
  if (target.dataset.ocSet && target instanceof HTMLInputElement) {
    const item = itemById(target.dataset.ocSet);
    if (item?.type === "range") {
      const label = target.parentElement?.querySelector(".ocs-range-val");
      if (label) label.textContent = Number(target.value).toFixed(2);
    }
  }
}

export function applyOpenCodeSettingsData(
  message: Extract<HostMessage, { type: "openCodeSettingsData" }>,
): void {
  state.items = message.items ?? [];
  state.groups = message.groups ?? [];
  state.values = message.values ?? {};
  state.overrides = message.overrides ?? {};
  state.configPath = message.configPath ?? "";
  state.themeOptions = message.themeOptions ?? [];
  state.plugins = message.plugins ?? [];
  const pathEl = $("#ocs-path");
  if (pathEl) pathEl.textContent = state.configPath;
  if (!settingsOpen) {
    return;
  }
  // Theme preview writes trigger a host reload. Keep the open picker mounted
  // so hover/key browsing is not interrupted.
  if (themePicker.open) {
    const current = currentThemeValue();
    if (themePicker.activeValue && themePicker.activeValue !== current) {
      // Host reverted a failed write; show the real value again.
      setActiveThemeOption(current, false);
    }
    updateThemeTriggerUi(themePicker.activeValue || current);
    return;
  }
  if (state.groups.length && !state.groups.some((g) => g.id === activeGroup)) {
    activeGroup = state.groups[0].id;
  }
  if (isFocusInList() || navScrollTarget !== null) {
    // Defer the full re-render while a control in the list has focus or a
    // nav jump animation is still in flight; otherwise the innerHTML swap
    // would cancel the smooth scroll mid-flight.
    pendingRerender = true;
    return;
  }
  renderNav();
  renderList();
}

export function handleOpenCodeSettingsSaveResult(
  message: Extract<HostMessage, { type: "openCodeSettingsSaveResult" }>,
): void {
  if (!message.ok) {
    showSettingsError(
      message.error || t("saveFailed", "Failed to save. Your config file was not changed."),
    );
  }
}

export function showOpenCodeSettingsError(error: string): void {
  showSettingsError(error || t("loadFailed", "Failed to load OpenCode settings."));
}

export function openOpenCodeSettingsModal(): void {
  settingsOpen = true;
  hideSettingsError();
  postMessage({ type: "requestOpenCodeSettingsData" });
  renderNav();
  renderList();
  const list = $("#ocs-list");
  if (list) list.scrollTop = 0;
  $("#ocs-overlay")?.classList.remove("hidden");
  document.getElementById("btn-oc-settings")?.classList.add("is-active");
}

export function closeOpenCodeSettingsModal(): void {
  settingsOpen = false;
  pendingRerender = false;
  if (navScrollUnlockTimer !== null) {
    clearTimeout(navScrollUnlockTimer);
    navScrollUnlockTimer = null;
  }
  navScrollTarget = null;
  $("#ocs-overlay")?.classList.add("hidden");
  document.getElementById("btn-oc-settings")?.classList.remove("is-active");
}

export function isOpenCodeSettingsOpen(): boolean {
  return settingsOpen;
}

export function initOpenCodeSettingsUi(): void {
  $("#ocs-close")?.addEventListener("click", () => {
    closeOpenCodeSettingsModal();
  });
  $("#ocs-error-dismiss")?.addEventListener("click", () => {
    hideSettingsError();
  });
  $("#ocs-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeOpenCodeSettingsModal();
  });

  document.addEventListener("oc-settings-hide", () => {
    closeOpenCodeSettingsModal();
  });

  $("#ocs-side-nav")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-group]") as HTMLElement | null;
    if (!btn) return;
    scrollToGroup(btn.dataset.group || "appearance");
  });

  $("#ocs-list")?.addEventListener("scroll", () => syncNavFromScroll(), {
    passive: true,
  });

  $("#ocs-list")?.addEventListener("change", (e) => {
    const target = e.target as HTMLElement;
    if (target && target.dataset && target.dataset.ocSet) {
      onControlChange(target);
    }
  });

  $("#ocs-list")?.addEventListener("input", (e) => {
    const target = e.target as HTMLElement;
    if (target && target.dataset && target.dataset.ocSet) {
      onControlInput(target);
    }
  });

  $("#ocs-list")?.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!pendingRerender) return;
      const list = $("#ocs-list");
      if (!list || !list.isConnected) {
        pendingRerender = false;
        return;
      }
      // Focus moved elsewhere within the list; keep waiting.
      if (list.contains(document.activeElement)) return;
      pendingRerender = false;
      renderNav();
      renderList();
    }, 0);
  });

  $("#ocs-list")?.addEventListener("click", (e) => {
    const jump = (e.target as HTMLElement).closest("#ocs-open-keymap");
    if (jump) {
      closeOpenCodeSettingsModal();
      openKeymapModal();
      return;
    }

    const trigger = (e.target as HTMLElement).closest("[data-oc-theme-trigger]");
    if (trigger) {
      e.preventDefault();
      if (themePicker.open) {
        commitThemeChoice(themePicker.activeValue);
      } else {
        openThemePicker();
      }
      return;
    }

    const option = (e.target as HTMLElement).closest("[data-oc-theme-opt]");
    if (option && themePicker.open) {
      e.preventDefault();
      const value = (option as HTMLElement).dataset.ocThemeOpt || "";
      commitThemeChoice(value);
    }
  });

  $("#ocs-list")?.addEventListener("mouseover", (e) => {
    const option = (e.target as HTMLElement).closest("[data-oc-theme-opt]");
    if (!option || !themePicker.open) return;
    const value = (option as HTMLElement).dataset.ocThemeOpt || "";
    if (value !== themePicker.activeValue) {
      setActiveThemeOption(value, true);
    }
  });

  $("#ocs-list")?.addEventListener("keydown", (e) => {
    const picker = (e.target as HTMLElement).closest("[data-oc-theme-picker]");
    if (!picker && !themePicker.open) return;
    if (e.key === "Escape" && themePicker.open) {
      e.preventDefault();
      e.stopPropagation();
      closeThemePicker({ restore: true });
      return;
    }
    if (!themePicker.open) {
      if (
        e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        e.key === "Enter" ||
        e.key === " "
      ) {
        const trigger = (e.target as HTMLElement).closest("[data-oc-theme-trigger]");
        if (trigger) {
          e.preventDefault();
          openThemePicker();
          if (e.key === "ArrowUp") {
            setActiveThemeOption(state.themeOptions[state.themeOptions.length - 1]?.value || "", true);
          }
        }
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      themePickerIndexDelta(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      themePickerIndexDelta(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commitThemeChoice(themePicker.activeValue);
    }
  });

  $("#ocs-list")?.addEventListener(
    "wheel",
    (e) => {
      if (!themePicker.open) return;
      // Theme menu lives inside the settings list; keep its own scrolling.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-oc-theme-menu]")) return;
      e.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener("click", (e) => {
    if (!themePicker.open) return;
    const target = e.target as HTMLElement;
    if (target.closest?.("[data-oc-theme-picker]")) return;
    // Outside click keeps the last previewed theme.
    clearThemePreviewTimer();
    closeThemePicker();
  });
}
