/**
 * Keymap value helpers — chord lists, normalization, display state.
 * Pure functions; safe for webview and host.
 */

export type KeybindDisplayState = "bound" | "modified" | "unbound";

/** "Empty" binding: none / false / "" / empty array / object without key. */
export function isNoneValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") {
    return true;
  }
  if (value === "none" || value === "false") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  if (typeof value === "object") {
    return isNoneValue((value as { key?: unknown }).key);
  }
  return false;
}

/** Split a binding value into individual chord strings. */
export function chordsOf(value: unknown): string[] {
  if (isNoneValue(value)) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => chordsOf(v));
  }
  if (typeof value === "object" && value !== null && "key" in (value as object)) {
    return chordsOf((value as { key: unknown }).key);
  }
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize one chord for comparison (aliases + lowercase). */
export function normChord(chord: string): string {
  return String(chord)
    .trim()
    .toLowerCase()
    .replace(/^enter$/, "return")
    .replace(/^esc$/, "escape")
    .replace(/^pgdown$/, "pagedown")
    .replace(/^pgup$/, "pageup");
}

/** Set signature of a binding value (order-independent). */
export function normalizeBinding(value: unknown): string {
  const chords = chordsOf(value)
    .map(normChord)
    .filter((c) => c && c !== "none");
  if (!chords.length) {
    return "none";
  }
  return [...new Set(chords)].sort().join(",");
}

/** Dedupe chords, preserving first-seen order. */
export function uniqueChords(chords: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of chords) {
    const n = normChord(c);
    if (!n || seen.has(n)) {
      continue;
    }
    seen.add(n);
    out.push(c.trim());
  }
  return out;
}

/**
 * True when the user override is present and its chord set differs from default.
 * Redundant overrides (same as default) are NOT user modifications.
 */
export function hasUserOverride(override: unknown, def: unknown): boolean {
  if (override === undefined) {
    return false;
  }
  return normalizeBinding(override) !== normalizeBinding(def);
}

/** Effective binding: override when it is a real change, else default. */
export function effectiveBinding(override: unknown, def: unknown): unknown {
  return hasUserOverride(override, def) ? override : def;
}

/**
 * Display state (已禁用 / 默认关闭 are unified into unbound):
 *   modified — user changed to different keys
 *   bound    — default keys in use
 *   unbound  — currently no keys
 */
export function getDisplayState(override: unknown, def: unknown): KeybindDisplayState {
  const effective = effectiveBinding(override, def);
  if (isNoneValue(effective)) {
    return "unbound";
  }
  return hasUserOverride(override, def) ? "modified" : "bound";
}

/**
 * Persist value for cli.json keybinds[id]:
 *   empty chords        → "none"
 *   same set as default → undefined (caller deletes the key)
 *   otherwise           → comma-joined chords
 */
export function toPersistedValue(
  chords: readonly string[],
  def: unknown,
): string | undefined {
  const unique = uniqueChords(chords);
  if (!unique.length) {
    return "none";
  }
  const joined = unique.join(",");
  if (normalizeBinding(joined) === normalizeBinding(def)) {
    return undefined;
  }
  return joined;
}
