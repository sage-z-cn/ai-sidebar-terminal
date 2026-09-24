/**
 * OpenCode v2 Keymap modal (L1 list + L2 chord editor).
 * Browser-only; communicates via WebviewMessage.
 */
import type { HostMessage, KeymapItem } from "../../types";
import {
  chordsOf,
  effectiveBinding,
  getDisplayState,
  hasUserOverride,
  isNoneValue,
  normChord,
  normalizeBinding,
  toPersistedValue,
  uniqueChords,
} from "../../services/openCodeKeymapState";
import { postMessage } from "../shared/vscode-api";

/** 注入方为 terminal/html.ts 的 nonce 脚本 window.__KEYMAP_L10N__；缺失时回退英文。 */
const keymapL10n: Record<string, string> =
  (typeof window !== "undefined"
    ? (window as unknown as { __KEYMAP_L10N__?: Record<string, string> })
        .__KEYMAP_L10N__
    : undefined) ?? {};

function t(key: string, fallback: string): string {
  return keymapL10n[key] ?? fallback;
}

/** 位置参数模板（{0}/{1}…），与 l10n.t 的占位符风格一致。 */
function formatMessage(
  template: string,
  ...values: Array<string | number>
): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

const GROUP_ORDER = [
  "general",
  "session",
  "nav",
  "model",
  "input",
  "dialog",
  "diff",
  "whichkey",
] as const;

const GROUP_LABELS: Record<string, string> = {
  general: t("groupGeneral", "General"),
  session: t("groupSession", "Session"),
  nav: t("groupNav", "Navigation / Messages"),
  model: t("groupModel", "Models / Agents"),
  input: t("groupInput", "Input / Prompts"),
  dialog: t("groupDialog", "Dialogs"),
  diff: t("groupDiff", "Diff viewer"),
  whichkey: t("groupWhichkey", "Which-key"),
};

type CaptureState = {
  mode: "add" | "replace";
  index?: number;
  pendingLeader?: boolean;
  chord?: string;
  leaderTimer?: ReturnType<typeof setTimeout>;
};

type L2State = {
  id: string;
  draft: string[];
  def: string;
  /** 打开弹窗时的 chord 列表，用于判断未保存更改 */
  original: string[];
};

let items: KeymapItem[] = [];
let overrides: Record<string, string> = {};
let filterMode = "all";
let searchQuery = "";
let activeGroup = "general";
let l2: L2State | null = null;
let capture: CaptureState | null = null;
let navScrollLock = false;
let navScrollUnlockTimer: ReturnType<typeof setTimeout> | null = null;
/** 打开 L2 并进入录制的那次 click 会冒泡到 document，忽略以免立刻 stopCapture */
let suppressOutsideCapture = false;

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

function itemDef(id: string): string {
  return items.find((c) => c.id === id)?.def ?? "none";
}

function itemOverride(id: string): string | undefined {
  return overrides[id];
}

function eff(id: string): string {
  const value = effectiveBinding(itemOverride(id), itemDef(id));
  return isNoneValue(value) ? "none" : String(value);
}

function effChords(id: string): string[] {
  return chordsOf(eff(id));
}

function formatKey(key: string): string {
  return String(key)
    .replace(/\+/g, " + ")
    .replace(/\bctrl\b/gi, "Ctrl")
    .replace(/\balt\b/gi, "Alt")
    .replace(/\bshift\b/gi, "Shift")
    .replace(/\bsuper\b/gi, "Super")
    .replace(/\breturn\b/gi, "Enter")
    .replace(/\benter\b/gi, "Enter")
    .replace(/\bescape\b/gi, "Esc")
    .replace(/\bpageup\b/gi, "PgUp")
    .replace(/\bpagedown\b/gi, "PgDn")
    .replace(/\bleft\b/gi, "←")
    .replace(/\bright\b/gi, "→")
    .replace(/\bup\b/gi, "↑")
    .replace(/\bdown\b/gi, "↓")
    .replace(/\bbackspace\b/gi, "Bksp")
    .replace(/\bdelete\b/gi, "Del")
    .trim();
}

function renderOneChord(chord: string, extraClass = "", extraAttrs = ""): string {
  const lower = chord.toLowerCase();
  const cls = (base: string) =>
    [base, extraClass].filter(Boolean).join(" ");
  const attrs = extraAttrs ? ` ${extraAttrs}` : "";
  if (lower.startsWith("<leader>")) {
    const rest = chord.slice(8);
    return `<span class="${cls("kbd leader")}"${attrs}>Leader${
      rest ? ` ${escapeHtml(formatKey(rest))}` : ""
    }</span>`;
  }
  return `<span class="${cls("kbd")}"${attrs}>${escapeHtml(formatKey(chord))}</span>`;
}

function matchesFilter(item: KeymapItem): boolean {
  const state = getDisplayState(itemOverride(item.id), itemDef(item.id));
  if (filterMode === "modified" && state !== "modified") return false;
  if (filterMode === "bound" && state !== "bound") return false;
  if (filterMode === "unbound" && state !== "unbound") return false;
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return (
    item.id.toLowerCase().includes(q) ||
    item.title.toLowerCase().includes(q) ||
    item.desc.toLowerCase().includes(q) ||
    eff(item.id).toLowerCase().includes(q) ||
    item.def.toLowerCase().includes(q)
  );
}

function visibleInGroup(group: string): KeymapItem[] {
  return items.filter((c) => c.group === group && matchesFilter(c));
}

function renderSideNav(): void {
  const nav = $("#km-side-nav");
  if (!nav) return;
  nav.innerHTML = GROUP_ORDER.map((key) => {
    const n = visibleInGroup(key).length;
    const on = activeGroup === key;
    return `<button type="button" class="sn-item${on ? " is-on" : ""}${
      n === 0 ? " is-empty" : ""
    }" data-group="${key}" aria-current="${on ? "true" : "false"}"><span>${
      GROUP_LABELS[key]
    }</span><span class="sn-count">${n}</span></span></button>`;
  }).join("");
}

function renderList(): void {
  const body = $("#km-list");
  if (!body) return;
  let html = "";
  let total = 0;
  let rowIndex = 0;
  for (const g of GROUP_ORDER) {
    const list = visibleInGroup(g);
    if (!list.length) continue;
    total += list.length;
    html += `<div class="group-label" id="km-group-${g}">${GROUP_LABELS[g]} <span class="gl-count">(${
      list.length
    })</span></div>`;
    for (const item of list) {
      const mod = hasUserOverride(itemOverride(item.id), itemDef(item.id));
      const zebra = rowIndex % 2 === 1 ? " is-zebra" : "";
      rowIndex += 1;
      const chords = effChords(item.id);
      const keys = chords.length
        ? chords
            .map((c, i) =>
              renderOneChord(
                c,
                "is-clickable",
                `data-act="edit-chord" data-id="${escapeHtml(item.id)}" data-index="${i}" role="button" tabindex="0" title="${t("clickToEdit", "Click to edit")}"`,
              ),
            )
            .join("")
        : `<span class="kbd is-none is-clickable" data-act="edit-chord" data-id="${escapeHtml(item.id)}" data-index="0" role="button" tabindex="0" title="${t("clickToBind", "Click to bind a shortcut")}">${t("unbound", "Unbound")}</span>`;
      html += `
        <div class="kb-row${mod ? " is-modified" : ""}${zebra}" data-id="${escapeHtml(item.id)}">
          <div class="kb-info">
            <div class="kb-title-line">
              <span class="kb-title">${escapeHtml(item.title)}</span>
              <span class="kb-id">${escapeHtml(item.id)}</span>
            </div>
            <div class="kb-desc">${escapeHtml(item.desc)}</div>
            ${
              mod
                ? `<div class="kb-default-ghost">${escapeHtml(formatMessage(t("defaultLabel", "Default: {0}"), item.def))}</div>`
                : ""
            }
          </div>
          <div class="kb-keys">${keys}</div>
          <div class="kb-actions">
            ${
              mod
                ? `<button type="button" class="mini-btn reset" data-act="reset" data-id="${escapeHtml(
                    item.id,
                  )}">${t("reset", "Reset")}</button>`
                : `<button type="button" class="mini-btn reset is-placeholder" tabindex="-1" aria-hidden="true" disabled>${t("reset", "Reset")}</button>`
            }
          </div>
        </div>`;
    }
  }
  if (!total) {
    html = `<div class="empty">${t("noMatches", "No matching shortcuts")}</div>`;
  }
  body.innerHTML = html;

  const nBound = items.filter(
    (c) => getDisplayState(itemOverride(c.id), itemDef(c.id)) === "bound",
  ).length;
  const nMod = items.filter(
    (c) => getDisplayState(itemOverride(c.id), itemDef(c.id)) === "modified",
  ).length;
  const nUn = items.filter(
    (c) => getDisplayState(itemOverride(c.id), itemDef(c.id)) === "unbound",
  ).length;
  const stats = $("#km-stats");
  if (stats) {
    stats.innerHTML = formatMessage(
      t("stats", "Total {0} · Bound {1} · Modified {2} · Unbound {3}"),
      items.length,
      `<strong>${nBound}</strong>`,
      `<strong>${nMod}</strong>`,
      `<strong>${nUn}</strong>`,
    );
  }
}

function renderL2(): void {
  if (!l2) return;
  const item = items.find((c) => c.id === l2!.id);
  if (!item) return;
  const title = $("#km-l2-id");
  const desc = $("#km-l2-desc");
  const leaderEl = $("#km-l2-leader");
  const defEl = $("#km-l2-default");
  const host = $("#km-l2-chords");
  if (title) title.textContent = item.id;
  if (desc) desc.textContent = item.desc;
  if (defEl) {
    defEl.textContent = formatMessage(
      t("defaultLabel", "Default: {0}"),
      item.def,
    );
  }
  if (leaderEl) {
    const leader = formatKey(eff("leader") || "ctrl+x");
    leaderEl.innerHTML = `${formatMessage(
      t("leaderLabel", "Leader key: {0}"),
      `<strong>${escapeHtml(leader)}</strong>`,
    )} · ${t(
      "leaderHint",
      "Press Leader first, then the next key when recording a sequence",
    )}`;
  }
  if (!host) return;

  const iconEdit =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11.2 2.3a1.5 1.5 0 0 1 2.1 2.1L5.2 12.5 2 13.5l1-3.2 8.2-8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';
  // 垃圾桶
  const iconDel =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3.5h3v1M5 4.5l.5 8h5l.5-8M6.8 7v3.2M9.2 7v3.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const msgEl = $("#km-l2-msg");
  const showUnsaved = Boolean(msgEl?.classList.contains("is-unsaved"));
  const showAdd = !capture && !showUnsaved;

  const showCaptureHint = (isCap: boolean): string =>
    isCap
      ? `<div class="capture-hint-inline" role="status"><span class="capture-dot" aria-hidden="true"></span>${t(
          "recording",
          "Recording",
        )}<button type="button" class="capture-cancel-link" data-l2="cancel">${t(
          "cancel",
          "Cancel",
        )}</button></div>`
      : "";

  if (l2.draft.length) {
    host.innerHTML = l2.draft
      .map((chord, i) => {
        const isCap =
          capture && capture.mode === "replace" && capture.index === i;
        return `<div class="l2-chord-line"><div class="chord-slot is-clickable${
          isCap ? " is-capture" : ""
        }" data-l2="replace" data-index="${i}" role="button" tabindex="0" title="${t("clickToEdit", "Click to edit")}">${renderOneChord(
          chord,
          isCap ? "is-capture" : "",
        )}</div>${showCaptureHint(Boolean(isCap))}<div class="chord-actions">${
          isCap
            ? ""
            : `<button type="button" class="icon-mini" data-l2="replace" data-index="${i}" title="${t("edit", "Edit")}">${iconEdit}</button>
          <button type="button" class="icon-mini danger" data-l2="delete" data-index="${i}" title="${t("delete", "Delete")}">${iconDel}</button>`
        }</div></div>`;
      })
      .join("");
  } else {
    const isCap = capture && capture.mode === "add";
    host.innerHTML = `<div class="l2-chord-line"><div class="chord-slot is-clickable${
      isCap ? " is-capture" : ""
    }" data-l2="replace" data-index="0" role="button" tabindex="0" title="${t("clickToBind", "Click to bind a shortcut")}"><span class="kbd is-none${
      isCap ? " is-capture" : ""
    }">${t("unbound", "Unbound")}</span></div>${showCaptureHint(Boolean(isCap))}<div class="chord-actions">${
      isCap
        ? ""
        : `<button type="button" class="icon-mini" data-l2="replace" data-index="0" title="${t("edit", "Edit")}">${iconEdit}</button>`
    }</div></div>`;
  }

  if (capture && capture.mode === "add" && l2.draft.length) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="l2-chord-line"><div class="chord-slot is-capture"><span class="kbd is-none is-capture">${t(
        "unbound",
        "Unbound",
      )}</span></div>${showCaptureHint(true)}<div class="chord-actions"></div></div>`,
    );
  }

  // 「添加绑定」居中放在列表内；录制中或未保存提示时隐藏
  if (showAdd) {
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="l2-add-row"><button type="button" class="km-btn" id="km-l2-add">${t(
        "addBinding",
        "+ Add binding",
      )}</button></div>`,
    );
    $("#km-l2-add")?.addEventListener("click", () => startCapture("add"));
  }
}

function render(): void {
  renderSideNav();
  renderList();
}

/** L2 内联错误/警告（不使用 toast）。 */
function setL2Msg(message: string, kind: "error" | "warning"): void {
  const el = $("#km-l2-msg");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden", "error", "warning", "is-unsaved");
  el.classList.add(kind);
  renderL2();
}

function clearL2Msg(): void {
  const el = $("#km-l2-msg");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
  el.classList.remove("error", "warning", "is-unsaved");
  renderL2();
}

export function openKeymapModal(): void {
  postMessage({ type: "requestKeymapData" });
  hideKeymapError();
  $("#km-overlay")?.classList.remove("hidden");
  document.getElementById("btn-keymap")?.classList.add("is-active");
  activeGroup = GROUP_ORDER[0];
  render();
  $("#km-search")?.focus();
}

export function closeKeymapModal(): void {
  closeL2(false);
  $("#km-overlay")?.classList.add("hidden");
  document.getElementById("btn-keymap")?.classList.remove("is-active");
}

let keymapOpenCodeV2 = false;

function applyKeymapVisibility(): void {
  // Single source of truth: the pill button's actual selected value.
  // Reading the live DOM value keeps the button consistent with what the
  // pill displays even when host messages arrive out of order or a
  // message handler throws midway.
  const pillValue = document
    .getElementById("btn-pill-ai-tool")
    ?.dataset.value;
  const visible = keymapOpenCodeV2 && pillValue === "opencode";
  const btn = document.getElementById("btn-keymap");
  if (!btn) return;
  btn.classList.toggle("hidden", !visible);
  btn.setAttribute("aria-hidden", visible ? "false" : "true");
  if (!visible) {
    closeKeymapModal();
  }
}

/** Host signal from activeSession: OpenCode with a resolved v2 CLI. */
export function setKeymapOpenCodeV2(openCodeV2: boolean): void {
  keymapOpenCodeV2 = openCodeV2;
  applyKeymapVisibility();
}

/**
 * Re-evaluate visibility after the pill selection changed.
 * The selection itself is read from the pill DOM (see applyKeymapVisibility).
 */
export function setKeymapActiveTool(_toolName?: string): void {
  void _toolName;
  applyKeymapVisibility();
}

export function applyKeymapData(
  message: Extract<HostMessage, { type: "keymapData" }>,
): void {
  items = message.items ?? [];
  overrides = { ...(message.overrides ?? {}) };
  // 错误横幅是粘性的：宿主保存失败后会重发 keymapData，此处不清除
  if (!$("#km-overlay")?.classList.contains("hidden")) {
    render();
  }
}

/** L1 顶部错误横幅：保存/加载失败对用户可见。 */
export function showKeymapError(message?: string): void {
  const banner = $("#km-error");
  const textEl = $("#km-error-text");
  if (!banner || !textEl) return;
  textEl.textContent =
    message ?? t("loadFailed", "Failed to load keymap configuration.");
  banner.classList.remove("hidden");
}

function hideKeymapError(): void {
  $("#km-error")?.classList.add("hidden");
}

/**
 * 处理宿主的保存/重置结果：失败时展示横幅（技术细节仅进 console，
 * UI 用通用文案）；成功时清除横幅。
 */
export function handleKeymapSaveResult(
  message: Extract<HostMessage, { type: "keymapSaveResult" }>,
): void {
  if (message.ok) {
    hideKeymapError();
    return;
  }
  showKeymapError(
    t(
      "saveFailed",
      "Failed to save the shortcut. Your config file was not changed.",
    ),
  );
}

function openL2(id: string, options?: { captureIndex?: number }): void {
  const item = items.find((c) => c.id === id);
  if (!item) return;
  const draft = effChords(id).slice();
  l2 = {
    id,
    draft: draft.slice(),
    def: item.def,
    original: draft.slice(),
  };
  capture = null;
  clearL2Msg();
  document.body.classList.add("km-l2-open");
  $("#km-l2-overlay")?.classList.remove("hidden");
  if (options?.captureIndex != null) {
    suppressOutsideCapture = true;
    if (!draft.length) {
      startCapture("add");
    } else {
      startCapture("replace", options.captureIndex);
    }
    // 本次 click 冒泡结束后再允许“点外退出”
    setTimeout(() => {
      suppressOutsideCapture = false;
    }, 0);
  } else {
    renderL2();
  }
}

function isL2Dirty(): boolean {
  if (!l2) return false;
  // 仅比较草稿与打开时快照；进入录制但未提交不算更改
  return (
    normalizeBinding(l2.draft.join(",")) !==
    normalizeBinding(l2.original.join(","))
  );
}

/** 关闭前检查未保存；有更改则内联确认，不直接关。 */
function requestCloseL2(): void {
  if (!l2) return;
  if (isL2Dirty()) {
    showUnsavedPrompt();
    return;
  }
  closeL2(false);
}

function showUnsavedPrompt(): void {
  const el = $("#km-l2-msg");
  if (!el) return;
  el.classList.remove("hidden", "error", "warning");
  el.classList.add("warning", "is-unsaved");
  el.innerHTML = `
    <div class="km-unsaved-row">
      <div class="km-unsaved-text">${t(
        "unsavedChanges",
        "You have unsaved changes. Closing will discard them.",
      )}</div>
      <div class="km-unsaved-actions">
        <button type="button" class="km-btn" id="km-l2-keep">${t(
          "keepEditing",
          "Keep editing",
        )}</button>
        <button type="button" class="km-btn" id="km-l2-discard">${t(
          "discardChanges",
          "Discard changes",
        )}</button>
      </div>
    </div>`;
  el.querySelector("#km-l2-discard")?.addEventListener("click", () => {
    closeL2(false);
  });
  el.querySelector("#km-l2-keep")?.addEventListener("click", () => {
    clearL2Msg();
  });
  renderL2();
}

function closeL2(save: boolean): void {
  if (!l2) return;
  if (save) {
    // 若仍在录制且已有预览键，先尝试提交
    if (
      capture?.chord &&
      !capture.chord.endsWith(" …") &&
      !capture.pendingLeader
    ) {
      const pending = capture.chord;
      const mode = capture.mode;
      const index = capture.index;
      capture = null;
      if (!applyCapturedChord(l2.id, l2.draft, pending, mode, index)) {
        // 冲突等：保留弹窗，不关闭
        capture = { mode, index, chord: pending };
        renderL2();
        return;
      }
    } else if (capture) {
      stopCapture();
    }

    // 保存前校验草稿全部 chord，有冲突则提示并保持弹窗
    const id = l2.id;
    for (const chord of l2.draft) {
      const conflict = findConflict(id, chord);
      if (conflict) {
        setL2Msg(
          formatMessage(
            t(
              "cannotSaveConflict",
              'Cannot save: {0} conflicts with "{1}". Change it before saving.',
            ),
            formatKey(chord),
            conflict,
          ),
          "error",
        );
        renderL2();
        return;
      }
    }

    const chords = l2.draft.slice();
    const def = l2.def;
    // 本地立即生效，不等 host 回包
    const persisted = toPersistedValue(chords, def);
    if (persisted === undefined) {
      delete overrides[id];
    } else {
      overrides[id] = persisted;
    }
    postMessage({ type: "saveKeybind", id, chords });
  }
  clearL2Msg();
  l2 = null;
  capture = null;
  document.body.classList.remove("km-l2-open");
  $("#km-l2-overlay")?.classList.add("hidden");
  render();
}

/** 将一个 chord 应用到草稿列表；失败返回 false。 */
function applyCapturedChord(
  id: string,
  draft: string[],
  chord: string,
  mode: "add" | "replace",
  index?: number,
): boolean {
  const conflict = findConflict(id, chord);
  if (conflict) {
    setL2Msg(
      formatMessage(
        t("conflictChord", 'Conflict: {0} is already used by "{1}"'),
        formatKey(chord),
        conflict,
      ),
      "error",
    );
    return false;
  }
  const list = draft.slice();
  if (mode === "replace" && index != null) {
    if (index >= 0 && index < list.length) {
      list[index] = chord;
    } else {
      list.push(chord);
    }
  } else {
    if (list.some((c) => normChord(c) === normChord(chord))) {
      setL2Msg(
        formatMessage(
          t("duplicateChord", "This command already has {0}"),
          formatKey(chord),
        ),
        "warning",
      );
      return false;
    }
    list.push(chord);
  }
  if (l2) {
    l2.draft = uniqueChords(list);
  }
  clearL2Msg();
  return true;
}

function commitChord(chord: string): void {
  if (!l2 || !capture) return;
  const mode = capture.mode;
  const index = capture.index;
  if (!applyCapturedChord(l2.id, l2.draft, chord, mode, index)) {
    // 冲突/重复：停止录制，避免预览键“假成功”
    stopCapture();
    return;
  }
  stopCapture();
}

function startCapture(mode: "add" | "replace", index?: number): void {
  capture = { mode, index, pendingLeader: false };
  renderL2();
}

function stopCapture(): void {
  if (capture?.leaderTimer) clearTimeout(capture.leaderTimer);
  capture = null;
  renderL2();
}

function findConflict(id: string, chord: string): string | undefined {
  const n = normChord(chord);
  for (const other of items) {
    if (other.id === id) continue;
    if (effChords(other.id).some((c) => normChord(c) === n)) {
      return other.title;
    }
  }
  return undefined;
}

/** 重置需确认，避免误点直接覆盖用户配置。 */
function requestReset(id: string): void {
  const item = items.find((c) => c.id === id);
  const overlay = $("#km-confirm-overlay");
  const desc = $("#km-confirm-desc");
  if (!overlay) return;
  if (desc) {
    desc.textContent = formatMessage(
      t(
        "resetConfirm",
        'Reset "{0}" to its default bindings? Your customization will be removed.',
      ),
      item?.title ?? id,
    );
  }
  overlay.classList.remove("hidden");
  const ok = $("#km-confirm-ok");
  const cancel = $("#km-confirm-cancel");
  const close = (): void => {
    overlay.classList.add("hidden");
    ok?.replaceWith(ok.cloneNode(true));
    cancel?.replaceWith(cancel.cloneNode(true));
  };
  const onOk = (): void => {
    postMessage({ type: "resetKeybind", id });
    close();
    render();
  };
  const onCancel = (): void => {
    close();
  };
  ok?.addEventListener("click", onOk, { once: true });
  cancel?.addEventListener("click", onCancel, { once: true });
  overlay.onclick = (e) => {
    if (e.target === overlay) onCancel();
  };
}

function eventToChord(e: KeyboardEvent): string | null {
  const MODS = ["Shift", "Control", "Alt", "Meta", "OS"];
  if (MODS.includes(e.key)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("super");
  let key = e.key;
  if (key === " ") key = "space";
  else if (key === "Escape") key = "escape";
  else if (key === "Enter") key = "return";
  else if (key === "ArrowLeft") key = "left";
  else if (key === "ArrowRight") key = "right";
  else if (key === "ArrowUp") key = "up";
  else if (key === "ArrowDown") key = "down";
  else if (key === "PageUp") key = "pageup";
  else if (key === "PageDown") key = "pagedown";
  else key = key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

function currentLeaderKey(): string {
  const chords = effChords("leader");
  return chords[0] ? normChord(chords[0]) : "ctrl+x";
}

function handleCaptureKey(e: KeyboardEvent): void {
  if (!capture) return;
  const simple = eventToChord(e);
  if (!simple) return;
  if (!capture.pendingLeader && normChord(simple) === currentLeaderKey()) {
    capture.pendingLeader = true;
    capture.chord = `${formatKey(simple)} …`;
    renderL2();
    capture.leaderTimer = setTimeout(() => {
      if (capture && capture.pendingLeader) {
        capture.pendingLeader = false;
        commitChord(simple);
      }
    }, 1500);
    return;
  }
  if (capture.pendingLeader) {
    const seq = `<leader>${simple}`;
    if (capture.leaderTimer) clearTimeout(capture.leaderTimer);
    capture.pendingLeader = false;
    capture.chord = seq;
    renderL2();
    commitChord(seq);
    return;
  }
  capture.chord = simple;
  renderL2();
  commitChord(simple);
}

function scrollToGroup(key: string): void {
  const body = $("#km-list");
  const label = document.getElementById(`km-group-${key}`);
  if (!body || !label) return;
  // 锚定到该组第一条数据行：sticky 标题吸附后 offsetTop/rect 不可靠
  const row = label.nextElementSibling as HTMLElement | null;
  const target =
    row && row.classList.contains("kb-row")
      ? row
      : (label.nextElementSibling as HTMLElement) || label;
  navScrollLock = true;
  if (navScrollUnlockTimer) clearTimeout(navScrollUnlockTimer);
  activeGroup = key;
  renderSideNav();

  // 非 sticky 目标用 rect 差 + scrollTop（布局坐标，可回滚到组首）
  const top =
    target.getBoundingClientRect().top -
    body.getBoundingClientRect().top +
    body.scrollTop -
    (target === label ? 0 : 4);

  const unlock = (): void => {
    navScrollLock = false;
    navScrollUnlockTimer = null;
    activeGroup = key;
    renderSideNav();
  };
  body.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  body.addEventListener("scrollend", unlock, { once: true });
  navScrollUnlockTimer = setTimeout(unlock, 700);
}

function syncSideNavFromScroll(): void {
  if (navScrollLock) return;
  const body = $("#km-list");
  if (!body) return;
  const bodyTop = body.getBoundingClientRect().top;
  let current = activeGroup;
  for (const g of GROUP_ORDER) {
    const el = document.getElementById(`km-group-${g}`);
    if (!el) continue;
    if (el.getBoundingClientRect().top - bodyTop <= 8) {
      current = g;
    }
  }
  if (current !== activeGroup) {
    activeGroup = current;
    renderSideNav();
  }
}

export function initKeymapUi(): void {
  $("#km-close")?.addEventListener("click", () => closeKeymapModal());
  $("#km-error-dismiss")?.addEventListener("click", () => hideKeymapError());
  $("#km-overlay")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeKeymapModal();
  });
  $("#km-search")?.addEventListener("input", (e) => {
    searchQuery = (e.target as HTMLInputElement).value || "";
    render();
  });
  $("#km-filter")?.addEventListener("change", (e) => {
    filterMode = (e.target as HTMLSelectElement).value || "all";
    render();
  });
  $("#km-side-nav")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-group]") as HTMLElement | null;
    if (!btn) return;
    scrollToGroup(btn.dataset.group || "general");
  });
  $("#km-list")?.addEventListener("scroll", () => syncSideNavFromScroll(), {
    passive: true,
  });
  $("#km-list")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!btn) return;
    const id = btn.dataset.id || "";
    if (btn.dataset.act === "edit-chord") {
      const index = btn.dataset.index != null ? Number(btn.dataset.index) : 0;
      openL2(id, { captureIndex: index });
    } else if (btn.dataset.act === "reset") {
      requestReset(id);
    }
  });
  $("#km-list")?.addEventListener("dblclick", (e) => {
    const row = (e.target as HTMLElement).closest(".kb-row") as HTMLElement | null;
    if (!row || (e.target as HTMLElement).closest("[data-act]")) return;
    if (row.dataset.id) openL2(row.dataset.id);
  });

  $("#km-l2-close")?.addEventListener("click", () => requestCloseL2());
  $("#km-l2-save")?.addEventListener("click", () => closeL2(true));
  $("#km-l2-disable")?.addEventListener("click", () => {
    if (!l2) return;
    stopCapture();
    l2.draft = [];
    renderL2();
  });
  $("#km-l2-reset")?.addEventListener("click", () => {
    if (!l2) return;
    stopCapture();
    l2.draft = chordsOf(l2.def);
    renderL2();
  });
  $("#km-l2-chords")?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest("[data-l2]") as HTMLElement | null;
    if (!btn || !l2) return;
    const act = btn.dataset.l2;
    const index = btn.dataset.index != null ? Number(btn.dataset.index) : undefined;
    if (act === "replace") {
      if (capture && capture.mode === "replace" && capture.index === index) {
        stopCapture();
      } else if (!l2.draft.length) {
        startCapture("add");
      } else {
        startCapture("replace", index);
      }
    } else if (act === "cancel") {
      stopCapture();
    } else if (act === "delete") {
      const list = l2.draft.slice();
      if (index == null || index < 0 || index >= list.length) return;
      list.splice(index, 1);
      l2.draft = list;
      stopCapture();
    }
  });

  // 点击 kbd / 录制槽以外区域时退出输入态
  document.addEventListener("click", (e) => {
    if (!capture || !l2) return;
    if (suppressOutsideCapture) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(".chord-slot") ||
      target.closest("[data-l2]") ||
      target.closest("#km-l2-add")
    ) {
      return;
    }
    stopCapture();
  });

  document.addEventListener("keydown", (e) => {
    const l1Open = !$("#km-overlay")?.classList.contains("hidden");
    const l2Open = !$("#km-l2-overlay")?.classList.contains("hidden");
    if (!l1Open && !l2Open) return;
    // Escape 优先关闭最上层的重置确认弹窗，不向下传播到 L1/L2
    if (
      e.key === "Escape" &&
      !$("#km-confirm-overlay")?.classList.contains("hidden")
    ) {
      e.preventDefault();
      $("#km-confirm-cancel")?.click();
      return;
    }
    if (capture) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        stopCapture();
        return;
      }
      if (
        (e.key === "Backspace" || e.key === "Delete") &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey
      ) {
        if (capture.mode === "replace" && l2 && capture.index != null) {
          const list = l2.draft.slice();
          list.splice(capture.index, 1);
          l2.draft = list;
        }
        stopCapture();
        return;
      }
      handleCaptureKey(e);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (l2Open) requestCloseL2();
      else if (l1Open) closeKeymapModal();
    }
  });
}
