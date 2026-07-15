import fs from 'node:fs/promises';
import path from 'node:path';

import {
  BUILD_INFO_NAME,
  BUNDLE_MANIFEST_NAME,
  COMPATIBILITY_REPORT_NAME,
  IR_RELATIVE_PATH,
  PROVENANCE_NAME,
  SBOM_NAME,
  canonicalJsonStringify,
  sha256DigestOfFile,
  sha256DigestOfJson,
  type BundleManifest,
  type CompiledPluginSetV1,
} from '@deepagents-plugins/schema';

import type { CompileResult } from './compile-plugin-set.js';

export interface BundleOptions {
  outputDir: string;
  emitSbom?: boolean;
  /** Reproducible mode omits wall-clock data from all hashed artifacts. */
  reproducible?: boolean;
  now?: () => Date;
}

export interface BundleOutput {
  bundleDigest: string;
  manifest: BundleManifest;
}

/**
 * Materialize a deterministic bundle (RFC sections 22, 25, Appendix A).
 * All hashed files are canonical JSON or verbatim source bytes; the only
 * timestamped file, build-info.json, is excluded from the manifest.
 */
export async function writeBundle(
  compiled: CompileResult,
  options: BundleOptions,
): Promise<BundleOutput> {
  const { outputDir } = options;
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  // 1. Plugin source/asset files.
  for (const [bundlePath, source] of [...compiled.filesToCopy.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const target = path.join(outputDir, bundlePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    await fs.chmod(target, 0o644);
  }

  for (const [bundlePath, value] of [...compiled.inlineJsonFiles.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const target = path.join(outputDir, bundlePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, canonicalJsonStringify(value), 'utf8');
  }

  // 2. IR, compatibility report, provenance.
  const irPath = path.join(outputDir, IR_RELATIVE_PATH);
  await fs.mkdir(path.dirname(irPath), { recursive: true });
  await fs.writeFile(irPath, canonicalJsonStringify(compiled.ir), 'utf8');
  await fs.writeFile(
    path.join(outputDir, COMPATIBILITY_REPORT_NAME),
    canonicalJsonStringify({ diagnostics: compiled.ir.diagnostics }),
    'utf8',
  );
  await fs.writeFile(
    path.join(outputDir, PROVENANCE_NAME),
    canonicalJsonStringify({ provenance: compiled.ir.provenance }),
    'utf8',
  );

  // 3. Optional CycloneDX SBOM.
  if (options.emitSbom) {
    await fs.writeFile(
      path.join(outputDir, SBOM_NAME),
      canonicalJsonStringify(buildSbom(compiled.ir)),
      'utf8',
    );
  }

  // 4. Bundle manifest with per-file digests, then the bundle digest.
  const files: { path: string; sha256: string }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const relative = path.relative(outputDir, absolute).split(path.sep).join('/');
        if (relative === BUNDLE_MANIFEST_NAME || relative === BUILD_INFO_NAME) continue;
        files.push({ path: relative, sha256: await sha256DigestOfFile(absolute) });
      }
    }
  };
  await walk(outputDir);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const manifest: BundleManifest = {
    schemaVersion: 1,
    bundleDigest: sha256DigestOfJson(files),
    files,
  };
  await fs.writeFile(
    path.join(outputDir, BUNDLE_MANIFEST_NAME),
    canonicalJsonStringify(manifest),
    'utf8',
  );

  // 5. Non-hashed build metadata (RFC 25).
  if (!options.reproducible) {
    await fs.writeFile(
      path.join(outputDir, BUILD_INFO_NAME),
      canonicalJsonStringify({ builtAt: (options.now?.() ?? new Date()).toISOString() }),
      'utf8',
    );
  }

  return { bundleDigest: manifest.bundleDigest, manifest };
}

function buildSbom(ir: CompiledPluginSetV1): Record<string, unknown> {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      tools: [{ name: ir.generatedBy.name, version: ir.generatedBy.version }],
    },
    components: ir.plugins.map((plugin) => ({
      type: 'library',
      name: plugin.name,
      version: plugin.version ?? '0.0.0',
      'bom-ref': plugin.id,
      purl: undefined,
      hashes: [{ alg: 'SHA-256', content: plugin.contentDigest.replace('sha256:', '') }],
      properties: [
        { name: 'deepagents:sourceType', value: plugin.source.type },
        { name: 'deepagents:policyProfile', value: plugin.policyProfile },
      ],
    })),
  };
}
