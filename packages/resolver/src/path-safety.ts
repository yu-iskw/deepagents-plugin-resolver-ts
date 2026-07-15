import path from 'node:path';

import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';

import type { ContentLimits } from './limits.js';

/**
 * Filesystem validation (RFC section 14.2). Every archive entry and plugin
 * file path passes through these checks before it is written or hashed.
 */

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const UNC_PATH = /^\\\\/;

export function assertSafeRelativePath(entryPath: string, limits: ContentLimits): string {
  const fail = (reason: string): never => {
    throw new PluginResolutionError(
      `Unsafe path "${entryPath}": ${reason}`,
      ExitCodes.SecurityValidationFailure,
      'Remove or rename the offending file in the plugin source.',
    );
  };

  if (entryPath.length === 0) fail('empty path');
  if (entryPath.length > limits.maxPathLength) fail('path too long');
  if (entryPath.includes('\0')) fail('NUL byte in path');
  if (WINDOWS_DRIVE.test(entryPath)) fail('Windows drive path');
  if (UNC_PATH.test(entryPath)) fail('UNC path');
  if (path.posix.isAbsolute(entryPath) || entryPath.startsWith('/')) fail('absolute path');

  const normalized = entryPath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) fail('empty path');
  if (segments.length > limits.maxDirectoryDepth) fail('directory depth exceeds limit');
  for (const segment of segments) {
    if (segment === '..') fail('path traversal segment');
  }
  return segments.join('/');
}

/**
 * Detect case-insensitive and Unicode-normalization collisions across a set
 * of relative paths (RFC 14.2).
 */
export function assertNoPathCollisions(paths: readonly string[]): void {
  const seen = new Map<string, string>();
  for (const relative of paths) {
    const key = relative.normalize('NFC').toLowerCase();
    const existing = seen.get(key);
    if (existing !== undefined && existing !== relative) {
      throw new PluginResolutionError(
        `Path collision between "${existing}" and "${relative}" (case or Unicode normalization ambiguity)`,
        ExitCodes.SecurityValidationFailure,
        'Rename one of the colliding files so paths remain distinct on all filesystems.',
      );
    }
    if (existing === relative) {
      throw new PluginResolutionError(
        `Duplicate entry "${relative}"`,
        ExitCodes.SecurityValidationFailure,
        'Remove the duplicate archive entry.',
      );
    }
    seen.set(key, relative);
  }
}

/** Verify that a resolved absolute path stays inside the extraction root. */
export function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new PluginResolutionError(
      `Path "${candidate}" escapes extraction root`,
      ExitCodes.SecurityValidationFailure,
    );
  }
}
