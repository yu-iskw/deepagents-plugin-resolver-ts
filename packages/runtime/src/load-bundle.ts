import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILD_INFO_NAME,
  BUNDLE_MANIFEST_NAME,
  ExitCodes,
  IR_RELATIVE_PATH,
  PluginResolutionError,
  bundleManifestSchema,
  compiledPluginSetSchema,
  digestsEqual,
  sha256DigestOfFile,
  type BundleManifest,
  type CompiledPluginSetV1,
} from '@deepagents-plugins/schema';

export interface LoadCompiledPluginSetOptions {
  directory: string;
  /** Stream-hash every bundle file against the manifest (default true). */
  verifyIntegrity?: boolean;
}

export interface LoadedPluginBundle {
  directory: string;
  compiled: CompiledPluginSetV1;
  manifest: BundleManifest;
}

/**
 * Load and verify a compiled plugin bundle (RFC sections 18 and 22.1).
 * Fails closed on any digest mismatch, missing file, or unknown IR version.
 * Performs no network access, git operations, or package installation.
 */
export async function loadCompiledPluginSet(
  options: LoadCompiledPluginSetOptions,
): Promise<LoadedPluginBundle> {
  const directory = path.resolve(options.directory);
  const verify = options.verifyIntegrity ?? true;

  const manifestPath = path.join(directory, BUNDLE_MANIFEST_NAME);
  let manifestText: string;
  try {
    manifestText = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new PluginResolutionError(
      `Bundle manifest not found at ${manifestPath}`,
      ExitCodes.IntegrityMismatch,
      'Rebuild the plugin bundle with "deepagents-plugins compile".',
    );
  }
  const manifestParsed = bundleManifestSchema.safeParse(JSON.parse(manifestText));
  if (!manifestParsed.success) {
    throw new PluginResolutionError(
      `Bundle manifest ${manifestPath} is invalid`,
      ExitCodes.IntegrityMismatch,
    );
  }
  const manifest = manifestParsed.data;

  if (verify) {
    const listed = new Set(manifest.files.map((entry) => entry.path));
    for (const onDisk of await listBundleFiles(directory)) {
      if (!listed.has(onDisk)) {
        throw new PluginResolutionError(
          `Bundle contains unmanifested file "${onDisk}"`,
          ExitCodes.IntegrityMismatch,
          'The bundle was tampered with or corrupted. Rebuild and redeploy the image.',
        );
      }
    }
    for (const entry of manifest.files) {
      const filePath = path.join(directory, entry.path);
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(directory + path.sep)) {
        throw new PluginResolutionError(
          `Bundle manifest entry "${entry.path}" escapes the bundle directory`,
          ExitCodes.IntegrityMismatch,
        );
      }
      let digest: string;
      try {
        digest = await sha256DigestOfFile(resolved);
      } catch {
        throw new PluginResolutionError(
          `Bundle file "${entry.path}" is missing`,
          ExitCodes.IntegrityMismatch,
          'The bundle was modified after compilation. Rebuild and redeploy the image.',
        );
      }
      if (!digestsEqual(digest, entry.sha256)) {
        throw new PluginResolutionError(
          `Bundle file "${entry.path}" failed integrity verification`,
          ExitCodes.IntegrityMismatch,
          'The bundle was tampered with or corrupted. Rebuild and redeploy the image.',
        );
      }
    }
  }

  const irText = await fs.readFile(path.join(directory, IR_RELATIVE_PATH), 'utf8');
  const irParsed = compiledPluginSetSchema.safeParse(JSON.parse(irText));
  if (!irParsed.success) {
    throw new PluginResolutionError(
      `Compiled plugin set is invalid or uses an unsupported schema version: ${irParsed.error.issues[0]?.message ?? 'schema error'}`,
      ExitCodes.IntegrityMismatch,
      'Recompile the bundle with a compatible compiler version.',
    );
  }

  return { directory, compiled: irParsed.data, manifest };
}

/** Relative posix paths of on-disk files, excluding meta files the bundler omits from digests. */
async function listBundleFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(directory, absolute).split(path.sep).join('/');
        if (relative === BUNDLE_MANIFEST_NAME || relative === BUILD_INFO_NAME) continue;
        files.push(relative);
      }
    }
  };
  await walk(directory);
  return files;
}
