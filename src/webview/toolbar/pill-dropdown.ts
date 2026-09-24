/**
 * Reusable pill-dropdown component for the toolbar.
 *
 * Two instances: AI tool pill & backend pill.
 * Mutual exclusion: only one dropdown open at a time.
 */

export interface PillOption {
  value: string;
  label: string;
  group?: string;
}

export interface PillDropdownConfig {
  /** ID of the pill-host wrapper element */
  hostId: string;
  /** ID of the <button> element */
  buttonId: string;
  /** ID of the label <span> */
  labelId: string;
  /** ID of the dropdown panel */
  dropdownId: string;
  /** Called when user selects an option */
  onSelect: (value: string) => void;
}

// ── Shared open-state registry (mutual exclusion) ──

const openInstances: Set<PillDropdown> = new Set();

function closeAllExcept(instance?: PillDropdown): void {
  for (const inst of openInstances) {
    if (inst !== instance) {
      inst.close();
    }
  }
  // When opening a new pill, also close external dropdowns
  if (instance) {
    externalDropdownClose?.();
  }
}

// ── Click-outside handler (singleton) ──

let documentListenerAttached = false;

function ensureDocumentListener(): void {
  if (documentListenerAttached) return;
  documentListenerAttached = true;
  document.addEventListener("click", (e) => {
    if (openInstances.size === 0 && !externalDropdownClose) return;
    const target = e.target as Node;
    let clickedInside = false;
    for (const inst of openInstances) {
      if (inst.hostEl?.contains(target)) {
        clickedInside = true;
        break;
      }
    }
    if (!clickedInside) {
      closeAllExcept();
      externalDropdownClose?.();
    }
  });
}

/** External dropdown close callback – used for settings dropdown mutex. */
let externalDropdownClose: (() => void) | null = null;

export function registerExternalDropdownClose(close: () => void): void {
  externalDropdownClose = close;
  ensureDocumentListener();
}

export function closeAllPillDropdowns(): void {
  closeAllExcept();
}

// ── PillDropdown class ──

/** Delay in ms before auto-closing on mouse leave (prevents flicker). */
const AUTO_CLOSE_DELAY_MS = 200;

export class PillDropdown {
  private readonly config: PillDropdownConfig;
  /**
   * Host element – intentionally NOT private so the module-level
   * click-outside handler can read it without a getter.
   */
  readonly hostEl: HTMLElement | null;
  private readonly buttonEl: HTMLButtonElement | null;
  private readonly labelEl: HTMLElement | null;
  private readonly dropdownEl: HTMLElement | null;
  private options: PillOption[] = [];
  private currentValue: string = "";
  private isOpen: boolean = false;
  private leaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: PillDropdownConfig) {
    this.config = config;
    this.hostEl = document.getElementById(config.hostId);
    this.buttonEl = document.getElementById(config.buttonId) as HTMLButtonElement | null;
    this.labelEl = document.getElementById(config.labelId);
    this.dropdownEl = document.getElementById(config.dropdownId);

    this.bind();
    ensureDocumentListener();
  }

  // ── Public API ──

  update(options: PillOption[], currentValue: string): void {
    this.options = options;
    this.currentValue = currentValue;

    const single = options.length <= 1;

    // Update button state
    if (this.buttonEl) {
      this.buttonEl.dataset.single = String(single);
      this.buttonEl.dataset.value = currentValue;
      this.buttonEl.setAttribute("aria-expanded", "false");
    }

    // Update label text: find the option matching currentValue
    const selected = options.find((o) => o.value === currentValue);
    if (this.labelEl) {
      this.labelEl.textContent = selected?.label ?? currentValue;
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.clearLeaveTimer();
    this.dropdownEl?.classList.add("hidden");
    this.buttonEl?.setAttribute("aria-expanded", "false");
    openInstances.delete(this);
  }

  // ── Internal ──

  private bind(): void {
    this.buttonEl?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.buttonEl?.dataset.single === "true") return;

      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });

    // Close on mouse leave (with delay to prevent flicker)
    this.hostEl?.addEventListener("pointerleave", () => {
      if (!this.isOpen) return;
      this.clearLeaveTimer();
      this.leaveTimer = setTimeout(() => this.close(), AUTO_CLOSE_DELAY_MS);
    });

    this.hostEl?.addEventListener("pointerenter", () => {
      this.clearLeaveTimer();
    });
  }

  private open(): void {
    closeAllExcept(this);
    this.clearLeaveTimer();
    this.renderDropdown();
    this.dropdownEl?.classList.remove("hidden");
    this.buttonEl?.setAttribute("aria-expanded", "true");
    this.isOpen = true;
    openInstances.add(this);
  }

  private clearLeaveTimer(): void {
    if (this.leaveTimer !== null) {
      clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  private renderDropdown(): void {
    if (!this.dropdownEl) return;
    this.dropdownEl.innerHTML = "";

    let lastGroup = "";
    for (const opt of this.options) {
      // Render group heading
      if (opt.group && opt.group !== lastGroup) {
        lastGroup = opt.group;
        const heading = document.createElement("div");
        heading.className = "pill-separator-heading";
        heading.textContent = opt.group;
        this.dropdownEl.appendChild(heading);
      }

      const item = document.createElement("div");
      item.className = "pill-option";
      item.role = "option";
      item.textContent = opt.label;
      item.dataset.value = opt.value;
      if (opt.value === this.currentValue) {
        item.classList.add("selected");
        item.setAttribute("aria-selected", "true");
      }

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectOption(opt.value);
      });

      this.dropdownEl.appendChild(item);
    }
  }

  private selectOption(value: string): void {
    if (value === this.currentValue) {
      this.close();
      return;
    }
    this.currentValue = value;
    if (this.buttonEl) {
      this.buttonEl.dataset.value = value;
    }
    const selected = this.options.find((o) => o.value === value);
    if (this.labelEl) {
      this.labelEl.textContent = selected?.label ?? value;
    }
    this.close();
    this.config.onSelect(value);
  }
}
