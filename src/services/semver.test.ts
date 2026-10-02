import { describe, expect, it } from "vitest";
import { isVersionNewer, parseSemver } from "./semver";

describe("semver", () => {
  describe("parseSemver", () => {
    it("parses plain and v-prefixed triples", () => {
      expect(parseSemver("1.18.33")).toEqual([1, 18, 33, ""]);
      expect(parseSemver("v2.0.6")).toEqual([2, 0, 6, ""]);
      expect(parseSemver("  1.2.3  ")).toEqual([1, 2, 3, ""]);
    });

    it("captures prerelease suffixes", () => {
      expect(parseSemver("0.0.0-beta-202608110357")).toEqual([
        0,
        0,
        0,
        "beta-202608110357",
      ]);
      expect(parseSemver("1.2.3-beta.1")).toEqual([1, 2, 3, "beta.1"]);
    });

    it("rejects non-semver strings", () => {
      expect(parseSemver("local")).toBeNull();
      expect(parseSemver("1.18")).toBeNull();
      expect(parseSemver("")).toBeNull();
      expect(parseSemver("not a version")).toBeNull();
    });
  });

  describe("isVersionNewer", () => {
    it("compares patch numerically, not lexicographically", () => {
      expect(isVersionNewer("1.18.10", "1.18.9")).toBe(true);
      expect(isVersionNewer("1.18.9", "1.18.10")).toBe(false);
    });

    it("compares minor numerically across different lengths", () => {
      expect(isVersionNewer("1.18.33", "1.18.4")).toBe(true);
      expect(isVersionNewer("1.18.4", "1.18.33")).toBe(false);
    });

    it("compares major and minor before patch", () => {
      expect(isVersionNewer("2.0.0", "1.99.99")).toBe(true);
      expect(isVersionNewer("1.19.0", "1.18.99")).toBe(true);
      expect(isVersionNewer("1.18.99", "1.19.0")).toBe(false);
    });

    it("treats a release as newer than its own prerelease", () => {
      expect(isVersionNewer("0.0.0", "0.0.0-beta-202608110357")).toBe(true);
      expect(isVersionNewer("0.0.0-beta-202608110357", "0.0.0")).toBe(false);
    });

    it("compares prerelease tags of the same core by string", () => {
      expect(isVersionNewer("1.2.3-beta.2", "1.2.3-beta.1")).toBe(true);
      expect(isVersionNewer("1.2.3-beta.1", "1.2.3-beta.2")).toBe(false);
    });

    it("returns false for equal versions", () => {
      expect(isVersionNewer("1.18.33", "1.18.33")).toBe(false);
      expect(isVersionNewer("v2.0.6", "2.0.6")).toBe(false);
    });

    it("falls back to string inequality for unparseable versions", () => {
      // Two-segment versions do not parse; the fallback only detects change.
      expect(isVersionNewer("2.0.1", "2.0")).toBe(true);
      expect(isVersionNewer("local", "1.18.33")).toBe(true);
      expect(isVersionNewer("local", "local")).toBe(false);
      expect(isVersionNewer("garbage", "garbage")).toBe(false);
      expect(isVersionNewer("", "")).toBe(false);
    });
  });
});
