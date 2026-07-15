import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ExitCodes,
  PluginResolutionError,
  sha256DigestOfFile,
  sha256DigestOfJson,
} from '@deepagents-plugins/schema';

import { assertNoPathCollisions, assertSafeRelativePath } from './path-safety.js';

import type { ContentLimits } from './limits.js';

export interface DirectoryDigestResult {
  /** `sha256:` digest over the sorted map of file paths to file digests. */
  contentDigest: string;
  /** Relative POSIX path -> `sha256:` digest, sorted by path. */
  files: Record<string, string>;
}

const EXCLUDED_DIRS = new Set(['.git', 'node_modules']);

/** Enumerate a plugin directory (without executing anything) and digest it. */
export async function digestDirectory(
  root: string,
  limits: ContentLimits,
): Promise<DirectoryDigestResult> {
  const relativePaths: string[] = [];
  let totalBytes = 0;

  async function walk(current: string, depth: number): Promise<void> {
    if (depth > limits.maxDirectoryDepth) {
      throw new PluginResolutionError(
        `Directory depth limit exceeded under "${current}"`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PluginResolutionError(
          `Symlink "${absolute}" is not allowed in plugin sources`,
          ExitCodes.SecurityValidationFailure,
          'Replace the symlink with a regular file or directory.',
        );
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        throw new PluginResolutionError(
          `Special file "${absolute}" is not allowed in plugin sources`,
          ExitCodes.SecurityValidationFailure,
        );
      }
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      assertSafeRelativePath(relative, limits);
      const stat = await fs.stat(absolute);
      if (stat.size > limits.maxFileBytes) {
        throw new PluginResolutionError(
          `File "${relative}" exceeds the per-file size limit`,
          ExitCodes.SecurityValidationFailure,
        );
      }
      totalBytes += stat.size;
      if (totalBytes > limits.maxTotalBytes) {
        throw new PluginResolutionError(
          'Plugin exceeds the total expanded size limit',
          ExitCodes.SecurityValidationFailure,
        );
      }
      relativePaths.push(relative);
      if (relativePaths.length > limits.maxFileCount) {
        throw new PluginResolutionError(
          `Plugin contains more than ${limits.maxFileCount} files`,
          ExitCodes.SecurityValidationFailure,
        );
      }
    }
  }

  await walk(root, 1);
  assertNoPathCollisions(relativePaths);
  relativePaths.sort();

  const files: Record<string, string> = {};
  for (const relative of relativePaths) {
    files[relative] = await sha256DigestOfFile(path.join(root, relative));
  }
  return { contentDigest: sha256DigestOfJson(files), files };
}
