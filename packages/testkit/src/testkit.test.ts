import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compilePluginSet, writeBundle } from '@deepagents-plugins/compiler';
import { PolicyEvaluator } from '@deepagents-plugins/policy';
import { DEFAULT_LIMITS, safeExtractTar } from '@deepagents-plugins/resolver';
import { PluginResolutionError, type LockedPlugin } from '@deepagents-plugins/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createCaseCollisionArchive,
  createSymlinkEscapeArchive,
  createTraversalArchive,
  writeMarketplaceFixture,
  writePluginFixture,
} from './fixtures.js';
import { compareGoldenFiles, snapshotTree, updateGoldenFiles } from './golden.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const fixturesDir = path.join(repoRoot, 'fixtures');

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-testkit-'));
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('malicious archive conformance (RFC 29.4)', () => {
  it('rejects traversal archives', async () => {
    const archive = await createTraversalArchive(path.join(tmpRoot, 'w1'));
    await expect(
      safeExtractTar(archive, path.join(tmpRoot, 'out1'), DEFAULT_LIMITS),
    ).rejects.toThrow(PluginResolutionError);
  });

  it('rejects symlink escape archives', async () => {
    const archive = await createSymlinkEscapeArchive(path.join(tmpRoot, 'w2'));
    await expect(
      safeExtractTar(archive, path.join(tmpRoot, 'out2'), DEFAULT_LIMITS),
    ).rejects.toThrow(/unsupported type/i);
  });

  it('rejects case-collision archives', async () => {
    const archive = await createCaseCollisionArchive(path.join(tmpRoot, 'w3'));
    await expect(
      safeExtractTar(archive, path.join(tmpRoot, 'out3'), DEFAULT_LIMITS),
    ).rejects.toThrow(/collision/i);
  });
});

describe('fixture builders', () => {
  it('produce valid plugin and marketplace layouts', async () => {
    const dir = path.join(tmpRoot, 'built-plugin');
    await writePluginFixture(dir, {
      name: 'built',
      skills: [{ name: 'demo', description: 'Demo skill' }],
    });
    await expect(fs.stat(path.join(dir, '.claude-plugin', 'plugin.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(dir, 'skills', 'demo', 'SKILL.md'))).resolves.toBeTruthy();

    const marketDir = path.join(tmpRoot, 'built-market');
    await writeMarketplaceFixture(marketDir, 'm', [{ name: 'built', source: './p' }]);
    const manifest = JSON.parse(
      await fs.readFile(path.join(marketDir, '.claude-plugin', 'marketplace.json'), 'utf8'),
    ) as { name: string };
    expect(manifest.name).toBe('m');
  });
});

describe('golden output for fixtures/plugins/example-plugin (RFC 29.2)', () => {
  it('compilation output matches the committed golden files byte for byte', async () => {
    const pluginDir = path.join(fixturesDir, 'plugins', 'example-plugin');
    // Synthetic locked record with fixed identities so goldens are machine-independent.
    const locked: LockedPlugin = {
      id: 'example-plugin@example-marketplace',
      policyProfile: 'trusted-internal',
      version: '1.4.0',
      source: {
        type: 'github',
        uri: 'https://github.com/example/plugin.git',
        requestedRef: 'v1.4.0',
        resolvedCommit: 'f'.repeat(40),
        pluginRoot: '.',
      },
      pluginRoot: '.',
      contentDigest: `sha256:${'1'.repeat(64)}`,
      manifestDigest: `sha256:${'2'.repeat(64)}`,
      files: {},
    };
    const compiled = await compilePluginSet(
      [
        {
          locked,
          rootDir: pluginDir,
          manifest: {
            name: 'example-plugin',
            version: '1.4.0',
            description: 'Example plugin used for golden tests',
            license: 'Apache-2.0',
          },
          runtimeNamespace: 'example-plugin',
        },
      ],
      {
        policy: new PolicyEvaluator(),
        compatibilityMode: 'permissive',
        pluginSetDigest: `sha256:${'3'.repeat(64)}`,
      },
    );
    const bundleDir = path.join(tmpRoot, 'golden-bundle');
    await writeBundle(compiled, { outputDir: bundleDir, reproducible: true });

    const actual: Record<string, string> = {
      'plugin-set.json': await fs.readFile(path.join(bundleDir, 'ir', 'plugin-set.json'), 'utf8'),
      'bundle-manifest.json': await fs.readFile(
        path.join(bundleDir, 'bundle-manifest.json'),
        'utf8',
      ),
      'compatibility.json': await fs.readFile(
        path.join(bundleDir, 'compatibility-report.json'),
        'utf8',
      ),
      'expected-tree.txt': await snapshotTree(bundleDir),
    };

    const goldenDir = path.join(fixturesDir, 'golden', 'example-plugin');
    if (process.env.UPDATE_GOLDEN === '1') {
      await updateGoldenFiles(goldenDir, actual);
      return;
    }
    const comparison = await compareGoldenFiles(goldenDir, actual);
    expect(comparison.differences).toEqual([]);
    expect(comparison.matches).toBe(true);
  });
});
