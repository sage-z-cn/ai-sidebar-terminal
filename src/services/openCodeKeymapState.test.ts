import { describe, expect, it } from "vitest";
import {
  chordsOf,
  effectiveBinding,
  getDisplayState,
  hasUserOverride,
  isNoneValue,
  normalizeBinding,
  toPersistedValue,
  uniqueChords,
} from "./openCodeKeymapState";

describe("isNoneValue", () => {
  it("treats none/false/empty as unbound", () => {
    expect(isNoneValue(undefined)).toBe(true);
    expect(isNoneValue(null)).toBe(true);
    expect(isNoneValue(false)).toBe(true);
    expect(isNoneValue("")).toBe(true);
    expect(isNoneValue("none")).toBe(true);
    expect(isNoneValue([])).toBe(true);
    expect(isNoneValue({ key: "none" })).toBe(true);
  });

  it("treats real keys as bound", () => {
    expect(isNoneValue("ctrl+p")).toBe(false);
    expect(isNoneValue("a,b")).toBe(false);
    expect(isNoneValue(["ctrl+p"])).toBe(false);
    expect(isNoneValue({ key: "ctrl+v", preventDefault: false })).toBe(false);
  });
});

describe("chordsOf", () => {
  it("splits comma strings and arrays", () => {
    expect(chordsOf("a,b")).toEqual(["a", "b"]);
    expect(chordsOf(["a", "b"])).toEqual(["a", "b"]);
    expect(chordsOf({ key: "ctrl+v" })).toEqual(["ctrl+v"]);
    expect(chordsOf("none")).toEqual([]);
  });
});

describe("normalizeBinding", () => {
  it("compares chord sets order-independently with aliases", () => {
    expect(normalizeBinding("b,a")).toBe(normalizeBinding("a,b"));
    expect(normalizeBinding("enter")).toBe(normalizeBinding("return"));
    expect(normalizeBinding("none")).toBe("none");
  });
});

describe("hasUserOverride / getDisplayState", () => {
  it("redundant override is not a user change", () => {
    expect(hasUserOverride("ctrl+p", "ctrl+p")).toBe(false);
    expect(getDisplayState("ctrl+p", "ctrl+p")).toBe("bound");
    expect(getDisplayState(undefined, "ctrl+p")).toBe("bound");
  });

  it("classifies modified / bound / unbound", () => {
    expect(getDisplayState("F1", "ctrl+p")).toBe("modified");
    expect(getDisplayState("none", "ctrl+p")).toBe("unbound");
    expect(getDisplayState(undefined, "none")).toBe("unbound");
    expect(getDisplayState("none", "none")).toBe("unbound");
    expect(getDisplayState("alt+d", "none")).toBe("modified");
  });

  it("effective prefers real overrides", () => {
    expect(effectiveBinding("F1", "ctrl+p")).toBe("F1");
    expect(effectiveBinding("ctrl+p", "ctrl+p")).toBe("ctrl+p");
  });
});

describe("toPersistedValue", () => {
  it("empty → none, same as default → undefined, else comma join", () => {
    expect(toPersistedValue([], "ctrl+p")).toBe("none");
    expect(toPersistedValue(["ctrl+p"], "ctrl+p")).toBeUndefined();
    expect(toPersistedValue(["a", "b"], "c")).toBe("a,b");
  });

  it("uniqueChords drops duplicates", () => {
    expect(uniqueChords(["a", "A", "b"])).toEqual(["a", "b"]);
  });
});
