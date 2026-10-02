/**
 * OpenCode self-update UI (webview side).
 *
 * Browser-only; all host I/O goes through WebviewMessage. The interaction
 * specification is the frozen prototype at docs/opencode-upgrade/index.html:
 * version pill as the sole update entry, anchored method popover, in-panel
 * card system (progress / blocked / success / failure / transient hints),
 * log drawer, collapse-vs-close semantics, abandon exit.
 */
import type { OpenCodeUpdateUiStatus } from "../../types";
import { postMessage } from "../shared/vscode-api";

// ── Strings (injected host-side; see update/l10n.ts) ──

const l10nStrings: Record<string, string> =
  (typeof window !== "undefined"
    ? (window as unknown as { __OC_UPDATE_L10N__?: Record<string, string> })
        .__OC_UPDATE_L10N__
    : undefined) ?? {};

function t(key: string, fallback: string): string {
  return l10nStrings[key] ?? fallback;
}

function format(template: string, ...values: string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : value;
  });
}

const DEFAULT_METHODS = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew"];

const STEP_LABELS: Record<string, string> = {
  "prepare-target": t("stepPrepareTarget", "Resolve latest version"),
  "prepare-local": t("stepPrepareLocal", "Read installed version"),
  execute: t("stepExecute", "Run update"),
  reshim: t("stepReshim", "Sync nvm shim"),
  verify: t("stepVerify", "Verify version"),
  "remediate-trust": t("stepRemediateTrust", "Apply nvm trust setting"),
  "remediate-reshim": t("stepRemediateReshim", "Run nvm reshim"),
};

const METHOD_DESCS: Record<string, string> = {
  curl: t("descCurl", "Download and run the official install script to update"),
  npm: t("descNpm", "Update via the npm global package"),
  pnpm: t("descPnpm", "Update via the pnpm global package"),
  bun: t("descBun", "Update via the bun global package"),
  yarn: t("descYarn", "Update via the yarn global package"),
  vp: t("descVp", "Update via the vp tool"),
  brew: t("descBrew", "Update via Homebrew"),
};

const HINT_TTL_MS = 4500;

const ICONS = {
  check:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  sync:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  info:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  error:
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
};

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Module state ──

let initialized = false;
let status: OpenCodeUpdateUiStatus | null = null;

let pill: HTMLButtonElement | null = null;
let pillText: HTMLElement | null = null;
let popover: HTMLDivElement | null = null;
let popList: HTMLElement | null = null;
let card: HTMLElement | null = null;
let drawer: HTMLElement | null = null;
let drawerBody: HTMLElement | null = null;
let liveRegion: HTMLElement | null = null;

type CardMode =
  | "progress"
  | "success"
  | "manual"
  | "verify"
  | "generic"
  | "hint"
  | "checking";

let cardMode: CardMode | null = null;
/** Flow cards (progress) collapse instead of closing. */
let cardCollapsed = false;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

let popFocused = 0;

// ── A11y ──

function announce(text: string): void {
  const region = liveRegion;
  if (!region) return;
  region.textContent = "";
  window.requestAnimationFrame(() => {
    region.textContent = text;
  });
}

// ── Init ──

export function initOpenCodeUpdateUi(): void {
  if (initialized) return;
  initialized = true;

  pill = document.getElementById("btn-oc-version") as HTMLButtonElement | null;
  pillText = document.getElementById("ocu-version-text");

  liveRegion = document.createElement("div");
  liveRegion.className = "ocu-sr-only";
  liveRegion.setAttribute("aria-live", "polite");
  document.body.appendChild(liveRegion);

  popover = document.createElement("div");
  popover.className = "ocu-popover hidden";
  popover.id = "ocu-popover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-labelledby", "ocu-popover-title");
  popover.innerHTML =
    '<div class="ocu-pop-head">' +
    '<span id="ocu-popover-title"></span>' +
    '<button type="button" class="ocu-pop-close" id="ocu-pop-close" aria-label="' +
    escapeHtml(t("closeLabel", "Close")) +
    '">' +
    ICONS.x +
    "</button></div>" +
    '<div class="ocu-pop-list" id="ocu-pop-list" role="listbox" aria-label="' +
    escapeHtml(t("popoverTitle", "Update OpenCode to {0}").replace(/\s*\{0\}\s*/g, "")) +
    '"></div>' +
    '<div class="ocu-pop-foot" aria-hidden="true"><span>' +
    escapeHtml(t("hintConfirm", "Enter to confirm")) +
    "</span><span>" +
    escapeHtml(t("hintCancel", "Esc to cancel")) +
    "</span><span>" +
    escapeHtml(t("hintMove", "Up and down to switch")) +
    "</span></div>";
  document.body.appendChild(popover);
  popList = popover.querySelector("#ocu-pop-list");

  card = document.createElement("section");
  card.className = "ocu-card hidden";
  card.id = "ocu-card";
  card.setAttribute("role", "status");
  document.getElementById("terminal-container")?.appendChild(card);

  drawer = document.createElement("div");
  drawer.className = "ocu-drawer hidden";
  drawer.id = "ocu-drawer";
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-label", t("logTitle", "Update log"));
  drawer.innerHTML =
    '<div class="ocu-drawer-head"><span>' +
    escapeHtml(t("logTitle", "Update log")) +
    '</span><button type="button" class="ocu-drawer-close" id="ocu-drawer-close" aria-label="' +
    escapeHtml(t("closeLabel", "Close")) +
    '">' +
    ICONS.x +
    "</button></div>" +
    '<div class="ocu-drawer-body" id="ocu-drawer-body" tabindex="0"></div>';
  document.getElementById("terminal-container")?.appendChild(drawer);
  drawerBody = drawer.querySelector("#ocu-drawer-body");

  bindEvents();

  postMessage({ type: "requestOpenCodeUpdateStatus" });
}

// ── Status entry point ──

function isBusyState(state: string): boolean {
  return state === "updating";
}

export function applyOpenCodeUpdateStatus(next: OpenCodeUpdateUiStatus): void {
  status = status ? { ...status, ...next } : { ...next };
  renderPill();
  updateMenuGate();
  if (popover && !popover.classList.contains("hidden") && status.state !== "available") {
    closePopover(false);
  }
  const notice = next.notice;
  if (notice && !isBusyState(status.state)) {
    showHintCard(notice);
  } else if (
    cardMode === "checking" &&
    (status.state === "available" || status.state === "idle")
  ) {
    // Host answered the manual check without a notice: drop the pending card.
    hideCardFull();
  }
  renderCard();
}

/** Settings dropdown item was clicked; show local pending state immediately. */
export function notifyOpenCodeUpdateCheckRequested(): void {
  if (!status || isBusyState(status.state)) return;
  closePopover(false);
  showCheckingCard();
}

// ── Pill ──

function renderPill(): void {
  if (!pill || !pillText) return;
  const st = status;
  if (!st || (st.state === "idle" && !st.installedVersion)) {
    pill.classList.add("hidden");
    pill.disabled = true;
    return;
  }

  const entryA = st.state === "available" || st.state === "failed";
  const busy = isBusyState(st.state);

  pillText.textContent =
    st.installedVersion ?? st.currentVersion ?? st.runningVersion ?? "";

  pill.classList.remove("hidden");
  pill.disabled = !(entryA || busy);
  pill.classList.toggle("is-entry", entryA);
  pill.classList.toggle("is-updating", busy);

  if (busy) {
    pill.setAttribute("title", t("updatingTooltip", "Updating OpenCode, click to view progress"));
    pill.setAttribute("aria-label", t("viewProgressLabel", "View update progress"));
  } else if (st.state === "failed") {
    pill.setAttribute(
      "title",
      t("retryTooltip", "Last update failed. Click to check again"),
    );
    pill.setAttribute(
      "aria-label",
      t("retryTooltip", "Last update failed. Click to check again"),
    );
  } else if (entryA) {
    const current = st.currentVersion ?? st.installedVersion ?? "";
    const latest = st.latestVersion ?? st.targetVersion ?? "";
    pill.setAttribute(
      "title",
      format(t("updateAvailableTooltip", "OpenCode update available: current {0}, latest {1}"), current, latest),
    );
    pill.setAttribute("aria-label", t("updateLabel", "Update OpenCode"));
  } else {
    pill.removeAttribute("title");
    pill.setAttribute(
      "aria-label",
      format(t("versionLabel", "OpenCode version {0}"), pillText.textContent ?? ""),
    );
  }
}

function updateMenuGate(): void {
  const item = document.getElementById("menu-oc-update-check");
  if (!item) return;
  const featureOn = Boolean(
    status && (status.state !== "idle" || Boolean(status.installedVersion)),
  );
  item.classList.toggle("hidden", !featureOn);
  item.classList.toggle("is-disabled", featureOn && status ? isBusyState(status.state) : false);
}

// ── Cards ──

function flowMode(mode: CardMode | null): boolean {
  return mode === "progress";
}

function hideCardFull(): void {
  if (!card) return;
  const hadFocus = card.contains(document.activeElement);
  card.classList.add("hidden");
  card.innerHTML = "";
  card.classList.remove("pulse");
  cardMode = null;
  cardCollapsed = false;
  if (hintTimer !== null) {
    clearTimeout(hintTimer);
    hintTimer = null;
  }
  if (hadFocus && pill && !pill.disabled) pill.focus();
}

function collapseCard(): void {
  if (!card || card.classList.contains("hidden")) return;
  const hadFocus = card.contains(document.activeElement);
  card.classList.add("hidden");
  cardCollapsed = true;
  if (hadFocus && pill) pill.focus();
}

/** X / Esc: flow cards collapse (re-showable via pill), others close. */
function closeOrCollapseCard(): void {
  if (flowMode(cardMode) && status && isBusyState(status.state)) {
    collapseCard();
  } else {
    hideCardFull();
  }
}

function pulseCard(): void {
  if (!card) return;
  card.classList.remove("pulse");
  void card.offsetWidth;
  card.classList.add("pulse");
  announce(t("stillInProgress", "Update still in progress"));
}

/** Progress heads are text-only; info/error heads keep their icon. */
function cardHead(kind: "prog" | "info" | "error", title: string): string {
  const iconHtml =
    kind === "prog"
      ? ""
      : '<span class="ocu-card-ic ocu-ic-' +
        kind +
        '">' +
        (kind === "error" ? ICONS.error : ICONS.info) +
        "</span>";
  return (
    '<div class="ocu-card-head">' +
    iconHtml +
    '<span class="ocu-card-title">' +
    escapeHtml(title) +
    "</span>" +
    '<button type="button" class="ocu-card-x" data-ocu-act="x" aria-label="' +
    escapeHtml(t("closeLabel", "Close")) +
    '">' +
    ICONS.x +
    "</button></div>"
  );
}

function stepRowsHtml(): string {
  const history = status?.history ?? [];
  const stepId = status?.step ?? "";
  let html = "";
  for (const entry of history) {
    const state = entry.ok ? "done" : "fail";
    html +=
      '<li class="' +
      state +
      '"><span class="ocu-st-ic">' +
      (entry.ok ? ICONS.check : ICONS.x) +
      "</span><span>" +
      escapeHtml(entry.label || STEP_LABELS[entry.step] || entry.step) +
      "</span></li>";
  }
  if (stepId) {
    const detail = status?.detail ?? "";
    html +=
      '<li class="active"><span class="ocu-st-ic ocu-spin">' +
      ICONS.sync +
      "</span><span>" +
      escapeHtml(STEP_LABELS[stepId] ?? detail ?? stepId) +
      "</span>" +
      (detail ? '<span class="ocu-cmd">' + escapeHtml(detail) + "</span>" : "") +
      "</li>";
  }
  const total = history.length + (stepId ? 1 : 0);
  const frac = total > 0 ? String(Math.round((history.length / total) * 100)) : "100";
  return (
    '<ol class="ocu-steps">' +
    html +
    '</ol><div class="ocu-progbar"><div class="ocu-fill" style="width:' +
    frac +
    '%"></div></div>'
  );
}

function buildCard(mode: CardMode): void {
  if (!card) return;
  const st = status;
  let html = "";

  if (mode === "progress") {
    html = cardHead("prog", t("progressTitle", "Updating OpenCode"));
    // Auto-fix steps stay in the step list and expose the abandon exit.
    const inRemediation =
      st?.step === "remediate-trust" || st?.step === "remediate-reshim";
    html +=
      '<div class="ocu-card-body">' +
      stepRowsHtml() +
      (inRemediation
        ? '<div class="ocu-card-actions"><button type="button" class="ocu-btn" data-ocu-act="abandon">' +
          escapeHtml(t("abandonUpdate", "Abandon update")) +
          "</button></div>"
        : "") +
      "</div>";
  } else if (mode === "success") {
    html = cardHead("info", format(t("successTitle", "OpenCode updated to {0}"), st?.installedVersion ?? st?.targetVersion ?? ""));
    html +=
      '<div class="ocu-card-body"><p class="ocu-card-msg">' +
      escapeHtml(t("successMessage", "Restart the terminal now?")) +
      '</p><div class="ocu-card-actions">' +
      '<button type="button" class="ocu-btn ocu-btn-primary" data-ocu-act="restart">' +
      escapeHtml(t("restartNow", "Restart now")) +
      "</button>" +
      '<button type="button" class="ocu-btn" data-ocu-act="later">' +
      escapeHtml(t("later", "Later")) +
      "</button></div></div>";
  } else if (mode === "manual") {
    html = cardHead("error", t("blockedTitle", "npm update blocked by nvm security policy"));
    const cmds = status?.manualCommands ?? status?.remediationCommands ?? [];
    html +=
      '<div class="ocu-card-body"><p class="ocu-card-msg">' +
      escapeHtml(t("remediateFailed", "Automatic fix did not succeed. Run the following commands in the terminal, then start the update again.")) +
      "</p>";
    for (const cmd of cmds) {
      html +=
        '<div class="ocu-cmd-row"><code>' +
        escapeHtml(cmd) +
        '</code><button type="button" class="ocu-copy" data-ocu-copy="' +
        escapeHtml(cmd) +
        '">' +
        ICONS.copy +
        '<span class="ocu-copy-label">' +
        escapeHtml(t("copy", "Copy")) +
        "</span></button></div>";
    }
    html +=
      '<div class="ocu-card-actions"><button type="button" class="ocu-btn ocu-btn-primary" data-ocu-act="gotit">' +
      escapeHtml(t("gotIt", "Got it")) +
      "</button></div></div>";
  } else if (mode === "generic") {
    // Generic failure without a verified version: show the detail line.
    html = cardHead("error", st?.detail ?? t("progressTitle", "Updating OpenCode"));
    html +=
      '<div class="ocu-card-body"><div class="ocu-card-actions">' +
      '<button type="button" class="ocu-btn" data-ocu-act="viewlog">' +
      escapeHtml(t("viewLog", "View log")) +
      "</button></div></div>";
  } else {
    // verify
    html = cardHead(
      "error",
      format(t("verifyFailedTitle", "Update did not take effect, version is still {0}"), st?.currentVersion ?? st?.installedVersion ?? ""),
    );
    html +=
      '<div class="ocu-card-body"><div class="ocu-card-actions">' +
      '<button type="button" class="ocu-btn" data-ocu-act="viewlog">' +
      escapeHtml(t("viewLog", "View log")) +
      "</button></div></div>";
  }

  card.innerHTML = html;
  card.setAttribute("role", mode === "manual" || mode === "verify" || mode === "generic" ? "alert" : "status");
}

function renderCard(): void {
  if (!card) return;
  const st = status;
  if (!st || st.state === "idle" || st.state === "available") {
    if (cardMode !== "hint" && cardMode !== "checking") hideCardFull();
    return;
  }
  if (cardMode === "hint" && !isBusyState(st.state)) {
    // The transient hint owns the card slot until it expires; the
    // expiry callback re-renders whatever the current status maps to.
    // Busy states override immediately so a just-started update is
    // never hidden behind a leftover hint.
    return;
  }

  const manualCommands = st.manualCommands ?? st.remediationCommands ?? [];
  const target: CardMode =
    st.state === "updating"
      ? "progress"
      : st.state === "success"
        ? "success"
        : manualCommands.length
          ? "manual"
          : st.installedVersion
            ? "verify"
            : "generic";

  const modeChanged = target !== cardMode;
  cardMode = target;
  if (modeChanged) cardCollapsed = false;
  buildCard(target);
  if (!cardCollapsed) card.classList.remove("hidden");
  if (modeChanged && target === "success") {
    card.querySelector<HTMLButtonElement>('[data-ocu-act="restart"]')?.focus();
  }
}

function showHintCard(text: string): void {
  if (!card) return;
  if (hintTimer !== null) {
    clearTimeout(hintTimer);
    hintTimer = null;
  }
  cardMode = "hint";
  cardCollapsed = false;
  card.setAttribute("role", "status");
  card.innerHTML =
    cardHead("info", text) + '<div class="ocu-card-body"></div>';
  card.classList.remove("hidden");
  hintTimer = setTimeout(() => {
    hintTimer = null;
    if (cardMode === "hint") {
      // Re-render from the current status instead of just hiding:
      // idle/available still hides, while failed restores its card.
      cardMode = null;
      renderCard();
    }
  }, HINT_TTL_MS);
}

function showCheckingCard(): void {
  if (!card) return;
  cardMode = "checking";
  cardCollapsed = false;
  card.setAttribute("role", "status");
  card.innerHTML =
    cardHead("prog", t("checkingUpdates", "Checking for updates…")) +
    '<div class="ocu-card-body"></div>';
  card.classList.remove("hidden");
}

// ── Log drawer ──

function openDrawer(): void {
  if (!drawer || !drawerBody) return;
  const history = status?.history ?? [];
  const lines: string[] = [];
  for (const entry of history) {
    const glyph = entry.ok ? "✓" : "✗";
    const cls = entry.ok ? "ocu-lg-ok" : "ocu-lg-err";
    lines.push(
      '<div class="' + cls + '">' + glyph + " " + escapeHtml(entry.label || STEP_LABELS[entry.step] || entry.step) + "</div>",
    );
  }
  if (status?.detail) {
    lines.push('<div class="ocu-lg-cmd">' + escapeHtml(status.detail) + "</div>");
  }
  if (status?.state === "failed") {
    lines.push(
      '<div class="ocu-lg-err">' +
        escapeHtml(
          format(
            t("verifyFailedTitle", "Update did not take effect, version is still {0}"),
            status.currentVersion ?? status.installedVersion ?? "",
          ),
        ) +
        "</div>",
    );
  }
  if (!lines.length) {
    lines.push('<div class="ocu-lg-out">—</div>');
  }
  drawerBody.innerHTML = lines.join("");
  drawer.classList.remove("hidden");
  drawer.querySelector<HTMLButtonElement>("#ocu-drawer-close")?.focus();
}

function closeDrawer(restoreFocus: boolean): void {
  if (!drawer || drawer.classList.contains("hidden")) return;
  drawer.classList.add("hidden");
  if (restoreFocus && pill && !pill.disabled) pill.focus();
}

// ── Method popover ──

function methods(): string[] {
  const list = status?.methods;
  return list && list.length ? list : DEFAULT_METHODS;
}

function popRows(): HTMLElement[] {
  if (!popList) return [];
  return Array.from(popList.querySelectorAll<HTMLElement>(".ocu-pop-row"));
}

function positionPopover(): void {
  if (!popover || !pill) return;
  const vw = document.documentElement.clientWidth || window.innerWidth || 420;
  const vh = window.innerHeight || 700;
  const pr = pill.getBoundingClientRect();
  const w = Math.max(200, Math.min(280, vw - 16));
  let left = pr.left;
  const top = pr.bottom + 6;
  left = Math.max(8, Math.min(left, vw - w - 8));
  popover.style.width = w + "px";
  popover.style.left = left + "px";
  popover.style.top = top + "px";
  popover.style.maxHeight = Math.max(180, vh - top - 10) + "px";
}

function renderPopoverRows(): void {
  if (!popList) return;
  const det = status?.detectedMethod ?? "";
  const last = status?.lastUsedMethod ?? "";
  let html = "";
  methods().forEach((id, i) => {
    const isLast = Boolean(last) && id === last;
    const isDet = Boolean(det) && id === det;
    let tags = "";
    if (isLast) {
      tags += '<span class="ocu-tag ocu-tag-last">' + escapeHtml(t("methodLastUsed", "Last used")) + "</span>";
    } else if (isDet) {
      tags += '<span class="ocu-tag ocu-tag-det">' + escapeHtml(t("methodDetected", "Detected install method")) + "</span>";
    }
    let desc = METHOD_DESCS[id] ?? "";
    if (isLast && isDet) {
      desc += " · " + t("methodDetected", "Detected install method");
    }
    html +=
      '<button type="button" class="ocu-pop-row' +
      (i === 0 ? " is-focused" : "") +
      '" role="option" aria-selected="' +
      (i === 0) +
      '" data-ocu-method="' +
      escapeHtml(id) +
      '" tabindex="' +
      (i === 0 ? 0 : -1) +
      '">' +
      '<span class="ocu-pop-main"><span class="ocu-pop-label">' +
      escapeHtml(id) +
      "</span>" +
      tags +
      '<span class="ocu-pop-ok hidden">' +
      ICONS.check +
      "</span></span>" +
      (desc ? '<span class="ocu-pop-desc" title="' + escapeHtml(desc) + '">' + escapeHtml(desc) + "</span>" : "") +
      "</button>";
  });
  popList.innerHTML = html;
}

function syncPopoverFocus(): void {
  const rows = popRows();
  rows.forEach((row, i) => {
    const on = i === popFocused;
    row.classList.toggle("is-focused", on);
    row.setAttribute("aria-selected", on ? "true" : "false");
    row.tabIndex = on ? 0 : -1;
    row.querySelector(".ocu-pop-ok")?.classList.toggle("hidden", !on);
  });
}

function openPopover(): void {
  if (!popover || !status || status.state !== "available") return;
  if (!popover.classList.contains("hidden")) {
    closePopover(true);
    return;
  }
  const titleText = format(
    t("popoverTitle", "Update OpenCode to {0}"),
    status.latestVersion ?? status.targetVersion ?? "",
  );
  const titleEl = popover.querySelector("#ocu-popover-title");
  if (titleEl) {
    titleEl.textContent = titleText;
  }
  renderPopoverRows();
  const pref =
    status.lastUsedMethod ?? status.detectedMethod ?? status.defaultMethod ?? "npm";
  const idx = Math.max(0, methods().indexOf(pref));
  popFocused = idx;
  syncPopoverFocus();
  positionPopover();
  popover.classList.remove("hidden");
  popRows()[popFocused]?.focus();
  announce(titleText);
}

function closePopover(restoreFocus: boolean): void {
  if (!popover || popover.classList.contains("hidden")) return;
  popover.classList.add("hidden");
  if (popList) popList.innerHTML = "";
  if (restoreFocus && pill && !pill.disabled) pill.focus();
}

function setPopoverFocused(idx: number): void {
  const rows = popRows();
  if (!rows.length) return;
  popFocused = (idx + rows.length) % rows.length;
  syncPopoverFocus();
  const row = rows[popFocused];
  row.focus();
  row.scrollIntoView({ block: "nearest" });
}

function chooseMethod(id: string): void {
  closePopover(false);
  postMessage({ type: "startOpenCodeUpdate", method: id });
  pill?.focus();
}

// ── Clipboard ──

function copyText(text: string, button: HTMLElement): void {
  const label = button.querySelector(".ocu-copy-label");
  const done = (ok: boolean): void => {
    if (label) {
      label.textContent = ok
        ? t("copied", "Copied")
        : t("copyFailed", "Copy failed");
      setTimeout(() => {
        label.textContent = t("copy", "Copy");
      }, 1600);
    }
  };
  const fallback = (): void => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      done(ok);
    } catch {
      done(false);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => done(true),
      () => fallback(),
    );
  } else {
    fallback();
  }
}

// ── Focus trap ──

function trapCycle(root: HTMLElement, e: KeyboardEvent): void {
  const focusables = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]',
    ),
  ).filter(
    (el) =>
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute("tabindex") !== "-1" &&
      el.closest(".hidden") === null,
  );
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

// ── Events ──

function bindEvents(): void {
  pill?.addEventListener("click", () => {
    if (!status) return;
    if (isBusyState(status.state)) {
      // State B: re-show the collapsed flow card, or pulse when visible.
      if (flowMode(cardMode) && card) {
        if (card.classList.contains("hidden")) {
          cardCollapsed = false;
          card.classList.remove("hidden");
          announce(t("progressShown", "Updating OpenCode, progress card shown"));
        } else {
          pulseCard();
        }
      }
      return;
    }
    if (pill && pill.disabled) return;
    if (status.state === "failed") {
      // The failed pill is a re-check entry: the popover only opens from
      // the available state, so a fresh check restores the real entry.
      closePopover(false);
      showCheckingCard();
      postMessage({ type: "checkOpenCodeUpdates" });
      return;
    }
    openPopover();
  });

  card?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest<HTMLElement>("[data-ocu-act]");
    if (act) {
      const action = act.dataset.ocuAct;
      if (action === "x") {
        if (cardMode === "success") {
          // Same as Esc on the success card: dismiss the flow entirely.
          hideCardFull();
          postMessage({ type: "dismissOpenCodeUpdate" });
        } else {
          closeOrCollapseCard();
        }
      } else if (action === "restart") {
        hideCardFull();
        postMessage({ type: "restartAfterUpdate" });
      } else if (action === "later") {
        hideCardFull();
        postMessage({ type: "dismissOpenCodeUpdate" });
      } else if (action === "abandon") {
        postMessage({ type: "abandonOpenCodeUpdate" });
        showHintCard(t("abandonedHint", "Update abandoned"));
      } else if (action === "viewlog") {
        openDrawer();
      } else if (action === "gotit") {
        hideCardFull();
      }
      return;
    }
    const copyBtn = target.closest<HTMLElement>("[data-ocu-copy]");
    if (copyBtn) {
      copyText(copyBtn.dataset.ocuCopy ?? "", copyBtn);
    }
  });

  popover?.addEventListener("keydown", (e) => {
    const rows = popRows();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPopoverFocused(popFocused + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPopoverFocused(popFocused - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setPopoverFocused(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setPopoverFocused(rows.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[popFocused];
      if (row) chooseMethod(row.dataset.ocuMethod ?? "");
    }
  });

  popList?.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>("[data-ocu-method]");
    if (row) chooseMethod(row.dataset.ocuMethod ?? "");
  });

  popover?.querySelector("#ocu-pop-close")?.addEventListener("click", () => {
    closePopover(true);
  });

  drawer?.querySelector("#ocu-drawer-close")?.addEventListener("click", () => {
    closeDrawer(true);
  });

  document.addEventListener("mousedown", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (
      popover &&
      !popover.classList.contains("hidden") &&
      !popover.contains(target) &&
      !(pill && pill.contains(target))
    ) {
      closePopover(true);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (popover && !popover.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover(true);
      } else if (e.key === "Tab") {
        trapCycle(popover, e);
      }
      return;
    }
    if (drawer && !drawer.classList.contains("hidden")) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDrawer(true);
      } else if (e.key === "Tab") {
        trapCycle(drawer, e);
      }
      return;
    }
    if (card && !card.classList.contains("hidden") && e.key === "Escape") {
      e.preventDefault();
      if (cardMode === "success") {
        hideCardFull();
        postMessage({ type: "dismissOpenCodeUpdate" });
      } else {
        closeOrCollapseCard();
      }
    }
  });

  window.addEventListener("resize", () => {
    if (popover && !popover.classList.contains("hidden")) positionPopover();
  });
}
