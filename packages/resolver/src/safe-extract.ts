import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';
import * as tar from 'tar';

import { assertNoPathCollisions, assertSafeRelativePath } from './path-safety.js';

import type { ContentLimits } from './limits.js';
import type { Unpack } from 'tar';

/**
 * Safe tar/tgz extraction (RFC section 14.2): rejects traversal, absolute
 * paths, links escaping the root, special files, duplicate entries, and
 * decompression bombs. Only regular files and directories are materialized.
 *
 * Violations are captured inside the tar filter (which swallows exceptions)
 * and re-thrown after the stream settles, so extraction always fails closed.
 */
export async function safeExtractTar(
  archivePath: string,
  destination: string,
  limits: ContentLimits,
  options: { stripComponents?: number } = {},
): Promise<string[]> {
  return runExtraction(destination, limits, options, archivePath, async (extractOpts) => {
    await tar.extract({ ...extractOpts, file: archivePath });
  });
}

/** Extract a verified in-memory archive without writing the bytes to disk first. */
export async function safeExtractTarBytes(
  bytes: Uint8Array,
  destination: string,
  limits: ContentLimits,
  options: { stripComponents?: number } = {},
): Promise<string[]> {
  return runExtraction(destination, limits, options, '<memory>', async (extractOpts) => {
    // No `file` option → tar returns a Writable Unpack stream.
    const extractor: Unpack = tar.extract(extractOpts);
    await pipeline(Readable.from([Buffer.from(bytes)]), extractor);
  });
}

type ExtractFilterOptions = {
  cwd: string;
  strip: number;
  preservePaths: false;
  filter: (entryPath: string, entryOrStat: unknown) => boolean;
};

async function runExtraction(
  destination: string,
  limits: ContentLimits,
  options: { stripComponents?: number },
  label: string,
  extract: (opts: ExtractFilterOptions) => Promise<void>,
): Promise<string[]> {
  await fs.mkdir(destination, { recursive: true });
  const extracted: string[] = [];
  let totalBytes = 0;
  let violation: PluginResolutionError | undefined;

  const strip = options.stripComponents ?? 0;
  const reject = (error: PluginResolutionError): false => {
    violation ??= error;
    return false;
  };

  const extractOpts: ExtractFilterOptions = {
    cwd: destination,
    strip,
    preservePaths: false,
    filter: (entryPath, entryOrStat) => {
      if (violation) return false;
      const entry = entryOrStat as { type?: string; size?: number };
      const rawSegments = entryPath
        .replaceAll('\\', '/')
        .split('/')
        .filter((segment) => segment.length > 0 && segment !== '.');
      const effective = rawSegments.slice(strip).join('/');
      if (effective.length === 0) return false;

      let safe: string;
      try {
        safe = assertSafeRelativePath(effective, limits);
      } catch (error) {
        return reject(
          error instanceof PluginResolutionError
            ? error
            : new PluginResolutionError(String(error), ExitCodes.SecurityValidationFailure),
        );
      }

      if (entry.type === 'Directory') return true;
      if (entry.type !== 'File') {
        return reject(
          new PluginResolutionError(
            `Archive entry "${entryPath}" has unsupported type "${entry.type}" (links, devices, FIFOs and sockets are rejected)`,
            ExitCodes.SecurityValidationFailure,
            'Repackage the plugin archive with regular files and directories only.',
          ),
        );
      }

      const size = entry.size ?? 0;
      if (size > limits.maxFileBytes) {
        return reject(
          new PluginResolutionError(
            `Archive entry "${entryPath}" exceeds the per-file size limit (${limits.maxFileBytes} bytes)`,
            ExitCodes.SecurityValidationFailure,
          ),
        );
      }
      totalBytes += size;
      if (totalBytes > limits.maxTotalBytes) {
        return reject(
          new PluginResolutionError(
            `Archive expands beyond the total size limit (${limits.maxTotalBytes} bytes)`,
            ExitCodes.SecurityValidationFailure,
          ),
        );
      }
      if (extracted.length + 1 > limits.maxFileCount) {
        return reject(
          new PluginResolutionError(
            `Archive contains more than ${limits.maxFileCount} files`,
            ExitCodes.SecurityValidationFailure,
          ),
        );
      }
      extracted.push(safe);
      return true;
    },
  };

  try {
    await extract(extractOpts);
  } catch (error) {
    if (violation) throw violation;
    throw new PluginResolutionError(
      `Failed to extract archive ${label}: ${error instanceof Error ? error.message : String(error)}`,
      ExitCodes.SecurityValidationFailure,
    );
  }
  if (violation) {
    await fs.rm(destination, { recursive: true, force: true });
    throw violation;
  }

  assertNoPathCollisions(extracted);

  // Defense in depth: verify nothing on disk escaped or smuggled in a link.
  await assertTreeIsPlain(destination);
  return extracted.sort();
}

async function assertTreeIsPlain(root: string): Promise<void> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new PluginResolutionError(
        `Symlink "${path.join(entry.parentPath, entry.name)}" found after extraction`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    if (!entry.isFile() && !entry.isDirectory()) {
      throw new PluginResolutionError(
        `Special file "${path.join(entry.parentPath, entry.name)}" found after extraction`,
        ExitCodes.SecurityValidationFailure,
      );
    }
  }
}
