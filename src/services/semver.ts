/**
 * Dependency-free semver parsing and comparison shared by the OpenCode
 * plugin update checks and the CLI self-update flow.
 */

/** Parsed semver tuple: [major, minor, patch, prerelease]. */
export type ParsedSemver = [number, number, number, string];

/**
 * Parses a `v`-prefixed `X.Y.Z` string with an optional `-prerelease`
 * suffix. Returns null when the core triple cannot be parsed.
 */
export function parseSemver(v: string): ParsedSemver | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ?? ""];
}

/**
 * Semver-ish compare: true when `latest` is strictly newer than `current`.
 * Falls back to string inequality for non-semver tags.
 */
export function isVersionNewer(latest: string, current: string): boolean {
  if (latest === current) return false;
  const a = parseSemver(latest);
  const b = parseSemver(current);
  if (a && b) {
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    // Same core; a pre-release of the same core is older than the release.
    if (a[3] === b[3]) return false;
    if (!a[3]) return true;
    if (!b[3]) return false;
    return a[3] > b[3];
  }
  return latest !== current;
}
