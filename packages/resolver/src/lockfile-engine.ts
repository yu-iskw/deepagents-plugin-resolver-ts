import fs from 'node:fs/promises';

import {
  ExitCodes,
  LOCKFILE_VERSION,
  PluginResolutionError,
  canonicalJsonStringify,
  lockfileSchema,
  type Lockfile,
} from '@deepagents-plugins/schema';

export async function readLockfile(filePath: string): Promise<Lockfile | undefined> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const parsed = lockfileSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new PluginResolutionError(
      `Lockfile ${filePath} is invalid or from an incompatible version`,
      ExitCodes.ConfigurationError,
      'Delete the lockfile and re-run resolve to regenerate it.',
    );
  }
  return parsed.data;
}

export async function writeLockfile(filePath: string, lockfile: Lockfile): Promise<void> {
  const sorted: Lockfile = {
    ...lockfile,
    lockfileVersion: LOCKFILE_VERSION,
    marketplaces: [...lockfile.marketplaces].sort((a, b) => a.name.localeCompare(b.name)),
    plugins: [...lockfile.plugins].sort((a, b) => a.id.localeCompare(b.id)),
  };
  await fs.writeFile(filePath, canonicalJsonStringify(sorted), 'utf8');
}

/** Frozen-mode comparison: any drift is an integrity failure (RFC 10.3). */
export function assertLockfilesMatch(expected: Lockfile, actual: Lockfile): void {
  const normalize = (lock: Lockfile): string =>
    canonicalJsonStringify({
      ...lock,
      resolverVersion: undefined,
      marketplaces: [...lock.marketplaces].sort((a, b) => a.name.localeCompare(b.name)),
      plugins: [...lock.plugins].sort((a, b) => a.id.localeCompare(b.id)),
    });
  if (normalize(expected) !== normalize(actual)) {
    throw new PluginResolutionError(
      'Frozen lockfile verification failed: resolved plugin set differs from deepagents.plugins.lock.json',
      ExitCodes.IntegrityMismatch,
      'Run "deepagents-plugins resolve" without --frozen-lockfile to update the lockfile, then review the diff.',
    );
  }
}
