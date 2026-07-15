import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';

/** Minimal, dependency-free semver resolution for npm plugin sources. */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
  raw: string;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(raw: string): ParsedVersion | undefined {
  const match = VERSION_RE.exec(raw);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
    raw,
  };
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === undefined) return 1;
  if (b.prerelease === undefined) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

/** Resolve `range` (exact, `^x.y.z`, `~x.y.z`) against available versions. */
export function resolveVersionRange(range: string, available: string[]): string {
  const exact = parseVersion(range);
  if (exact && available.includes(range)) return range;

  const operator = range.startsWith('^') ? '^' : range.startsWith('~') ? '~' : undefined;
  const base = operator ? parseVersion(range.slice(1)) : exact;
  if (!base) {
    throw new PluginResolutionError(
      `Unsupported npm version range "${range}" (use an exact version, ^x.y.z, or ~x.y.z)`,
      ExitCodes.ConfigurationError,
    );
  }

  const candidates = available
    .map((version) => parseVersion(version))
    .filter((version): version is ParsedVersion => version !== undefined)
    .filter((version) => version.prerelease === undefined)
    .filter((version) => {
      if (!operator) {
        return compareVersions(version, base) === 0;
      }
      if (compareVersions(version, base) < 0) return false;
      if (operator === '^') {
        return base.major === 0
          ? version.major === 0 && version.minor === base.minor
          : version.major === base.major;
      }
      return version.major === base.major && version.minor === base.minor;
    })
    .sort(compareVersions);

  const best = candidates.at(-1);
  if (!best) {
    throw new PluginResolutionError(
      `No published npm version satisfies "${range}"`,
      ExitCodes.ResolutionFailure,
    );
  }
  return best.raw;
}
