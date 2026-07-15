import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';
import * as tar from 'tar';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { envCredentialProvider, redactSecrets, type ResolveContext } from './context.js';
import { digestDirectory } from './directory-digest.js';
import { DEFAULT_LIMITS, mergeLimits } from './limits.js';
import { assertLockfilesMatch } from './lockfile-engine.js';
import { marketplaceEntryToSourceSpec } from './marketplace.js';
import { assertNoPathCollisions, assertSafeRelativePath } from './path-safety.js';
import { resolvePluginSet } from './resolve-plugin-set.js';
import {
  GitResolver,
  LocalDirectoryResolver,
  NpmResolver,
  builtinResolvers,
  verifySri,
} from './resolvers.js';
import { safeExtractTar } from './safe-extract.js';
import { resolveVersionRange } from './semver.js';

let tmpRoot: string;

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-resolver-'));
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function makeContext(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    limits: DEFAULT_LIMITS,
    credentials: envCredentialProvider({}),
    offline: false,
    cacheDir: path.join(tmpRoot, 'cache'),
    projectDir: tmpRoot,
    workDir: path.join(tmpRoot, 'work'),
    ...overrides,
  };
}

async function writePluginFixture(root: string, name: string): Promise<void> {
  await fs.mkdir(path.join(root, '.claude-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: 'fixture' }),
  );
  const skillDir = path.join(root, 'skills', 'hello');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    '---\nname: hello\ndescription: Say hello\n---\n\nSay hello politely.\n',
  );
}

describe('path safety', () => {
  it('rejects traversal, absolute, drive, and UNC paths', () => {
    for (const bad of [
      '../etc/passwd',
      '/abs/path',
      'C:\\evil',
      String.raw`\\server\share`,
      'a/../../b',
    ]) {
      expect(() => assertSafeRelativePath(bad, DEFAULT_LIMITS)).toThrow(PluginResolutionError);
    }
    expect(assertSafeRelativePath('skills/x/SKILL.md', DEFAULT_LIMITS)).toBe('skills/x/SKILL.md');
  });

  it('rejects case and unicode collisions and duplicates', () => {
    expect(() => assertNoPathCollisions(['a/B.md', 'A/b.md'])).toThrow(/collision/i);
    expect(() => assertNoPathCollisions(['café.md', 'café.md'])).toThrow(/collision/i);
    expect(() => assertNoPathCollisions(['same.md', 'same.md'])).toThrow(/duplicate/i);
    expect(() => assertNoPathCollisions(['a.md', 'b.md'])).not.toThrow();
  });

  it('enforces lower-only limit overrides', () => {
    const merged = mergeLimits({
      maxFileCount: 10,
      maxTotalBytes: DEFAULT_LIMITS.maxTotalBytes * 2,
    });
    expect(merged.maxFileCount).toBe(10);
    expect(merged.maxTotalBytes).toBe(DEFAULT_LIMITS.maxTotalBytes);
  });
});

describe('safeExtractTar', () => {
  it('rejects zip-slip style traversal entries', async () => {
    const dir = path.join(tmpRoot, 'slip-src');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'ok.txt'), 'ok');
    const archive = path.join(tmpRoot, 'slip.tgz');
    await tar.create({ file: archive, cwd: dir, gzip: true }, ['ok.txt']);
    // Manually forge a traversal entry by rewriting paths during creation.
    const evil = path.join(tmpRoot, 'evil.tgz');
    await tar.create(
      {
        file: evil,
        cwd: dir,
        gzip: true,
        onWriteEntry: (entry) => {
          entry.path = '../escape.txt';
        },
      },
      ['ok.txt'],
    );
    await expect(
      safeExtractTar(evil, path.join(tmpRoot, 'slip-out'), DEFAULT_LIMITS),
    ).rejects.toThrow(PluginResolutionError);
  });

  it('rejects symlink entries', async () => {
    const dir = path.join(tmpRoot, 'link-src');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'file.txt'), 'x');
    await fs.symlink('/etc/passwd', path.join(dir, 'evil-link'));
    const archive = path.join(tmpRoot, 'link.tgz');
    await tar.create({ file: archive, cwd: dir, gzip: true }, ['file.txt', 'evil-link']);
    await expect(
      safeExtractTar(archive, path.join(tmpRoot, 'link-out'), DEFAULT_LIMITS),
    ).rejects.toThrow(/unsupported type/i);
  });

  it('enforces file count limits', async () => {
    const dir = path.join(tmpRoot, 'many-src');
    await fs.mkdir(dir, { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      await fs.writeFile(path.join(dir, `f${index}.txt`), String(index));
    }
    const archive = path.join(tmpRoot, 'many.tgz');
    await tar.create({ file: archive, cwd: dir, gzip: true }, ['.']);
    await expect(
      safeExtractTar(archive, path.join(tmpRoot, 'many-out'), mergeLimits({ maxFileCount: 2 })),
    ).rejects.toThrow(/more than 2 files/);
  });

  it('extracts a benign archive', async () => {
    const dir = path.join(tmpRoot, 'ok-src');
    await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(dir, 'nested', 'a.md'), 'A');
    const archive = path.join(tmpRoot, 'ok.tgz');
    await tar.create({ file: archive, cwd: dir, gzip: true }, ['.']);
    const files = await safeExtractTar(archive, path.join(tmpRoot, 'ok-out'), DEFAULT_LIMITS);
    expect(files).toContain('nested/a.md');
  });
});

describe('digestDirectory', () => {
  it('is deterministic and rejects symlinks', async () => {
    const dir = path.join(tmpRoot, 'digest-src');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'b.txt'), 'b');
    await fs.writeFile(path.join(dir, 'a.txt'), 'a');
    const first = await digestDirectory(dir, DEFAULT_LIMITS);
    const second = await digestDirectory(dir, DEFAULT_LIMITS);
    expect(first.contentDigest).toBe(second.contentDigest);
    expect(Object.keys(first.files)).toEqual(['a.txt', 'b.txt']);

    await fs.symlink('/etc', path.join(dir, 'link'));
    await expect(digestDirectory(dir, DEFAULT_LIMITS)).rejects.toThrow(/symlink/i);
    await fs.rm(path.join(dir, 'link'));
  });
});

describe('semver', () => {
  it('resolves exact, caret, and tilde ranges', () => {
    const versions = [
      '1.0.0',
      '1.2.0',
      '1.2.5',
      '1.3.0-beta.1',
      '2.0.0',
      '0.3.1',
      '0.3.9',
      '0.4.0',
    ];
    expect(resolveVersionRange('1.2.0', versions)).toBe('1.2.0');
    expect(resolveVersionRange('^1.0.0', versions)).toBe('1.2.5');
    expect(resolveVersionRange('~1.2.0', versions)).toBe('1.2.5');
    expect(resolveVersionRange('^0.3.0', versions)).toBe('0.3.9');
    expect(() => resolveVersionRange('^3.0.0', versions)).toThrow(/No published/);
    expect(() => resolveVersionRange('>=1.0.0', versions)).toThrow(/Unsupported/);
  });
});

describe('redaction', () => {
  it('redacts URL credentials and tokens', () => {
    expect(redactSecrets('https://user:secret@github.com/x')).not.toContain('secret');
    expect(redactSecrets('token ghp_0123456789012345678901234567890123')).not.toContain('ghp_');
  });
});

describe('verifySri', () => {
  it('accepts matching and rejects mismatched integrity', () => {
    const bytes = new TextEncoder().encode('payload');
    const good = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    expect(() => verifySri(bytes, good)).not.toThrow();
    expect(() => verifySri(bytes, 'sha512-AAAA')).toThrow(/integrity mismatch/i);
    expect(() => verifySri(bytes, 'md5-AAAA')).toThrow(/Unsupported/);
  });
});

describe('git resolver', () => {
  it('pins refs to commits and fetches a detached checkout', async () => {
    const repoDir = path.join(tmpRoot, 'git-repo');
    await writePluginFixture(repoDir, 'git-plugin');
    const git = (args: string[]) =>
      execFileSync('git', args, {
        cwd: repoDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    git(['init', '--quiet', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    git(['add', '.']);
    git(['commit', '--quiet', '-m', 'init']);

    const resolver = new GitResolver();
    const context = makeContext();
    const resolved = await resolver.resolve({ type: 'git', url: repoDir, ref: 'main' }, context);
    expect(resolved.immutableIdentity).toMatch(/^[0-9a-f]{40}$/);

    const out = path.join(tmpRoot, 'git-out');
    const fetched = await resolver.fetch(resolved, out, context);
    await expect(
      fs.stat(path.join(fetched.rootDir, '.claude-plugin', 'plugin.json')),
    ).resolves.toBeTruthy();
    await expect(fs.stat(path.join(fetched.rootDir, '.git'))).rejects.toThrow();
  });

  it('fails offline when a ref is not pinned', async () => {
    const resolver = new GitResolver();
    await expect(
      resolver.resolve(
        { type: 'git', url: 'https://example.com/x.git', ref: 'main' },
        makeContext({ offline: true }),
      ),
    ).rejects.toMatchObject({ exitCode: 8 });
  });
});

describe('npm resolver against a local fake registry', () => {
  let server: http.Server;
  let registry: string;
  let tarballBytes: Buffer;

  beforeAll(async () => {
    const packageDir = path.join(tmpRoot, 'npm-pkg', 'package');
    await writePluginFixture(packageDir, 'npm-plugin');
    const tarballPath = path.join(tmpRoot, 'npm-pkg.tgz');
    await tar.create(
      { file: tarballPath, cwd: path.join(tmpRoot, 'npm-pkg'), gzip: true, portable: true },
      ['package'],
    );
    tarballBytes = Buffer.from(await fs.readFile(tarballPath));
    const integrity = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`;

    server = http.createServer((request, response) => {
      if (request.url?.endsWith('.tgz')) {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(tarballBytes);
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              version: '1.0.0',
              dist: { tarball: `${registry}/pkg/-/pkg-1.0.0.tgz`, integrity },
            },
          },
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no address');
    registry = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it('resolves, verifies integrity, and extracts without scripts', async () => {
    const resolver = new NpmResolver();
    const context = makeContext();
    const resolved = await resolver.resolve(
      { type: 'npm', package: '@acme/npm-plugin', version: '1.0.0', registry },
      context,
    );
    expect(resolved.immutableIdentity).toBe('@acme/npm-plugin@1.0.0');
    expect(resolved.expectedIntegrity).toMatch(/^sha512-/);

    const out = path.join(tmpRoot, 'npm-out');
    const fetched = await resolver.fetch(resolved, out, context);
    await expect(
      fs.stat(path.join(fetched.rootDir, '.claude-plugin', 'plugin.json')),
    ).resolves.toBeTruthy();
  });
});

describe('resolvePluginSet end to end (local + marketplace)', () => {
  it('produces a deterministic lockfile and detects namespace collisions', async () => {
    const projectDir = path.join(tmpRoot, 'project');
    const pluginDir = path.join(projectDir, 'plugins', 'demo');
    await writePluginFixture(pluginDir, 'demo-plugin');

    const marketDir = path.join(projectDir, 'market');
    await fs.mkdir(path.join(marketDir, '.claude-plugin'), { recursive: true });
    const marketPluginDir = path.join(marketDir, 'plugins', 'from-market');
    await writePluginFixture(marketPluginDir, 'from-market');
    await fs.writeFile(
      path.join(marketDir, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'test-market',
        owner: 'tester',
        plugins: [{ name: 'from-market', source: './plugins/from-market' }],
      }),
    );

    const manifest = {
      apiVersion: 'deepagents.plugins/v2' as const,
      kind: 'PluginSet' as const,
      metadata: { name: 'test-set' },
      marketplaces: [{ name: 'test-market', source: { type: 'local' as const, path: './market' } }],
      plugins: [
        { id: 'demo-plugin@direct', source: { type: 'local' as const, path: './plugins/demo' } },
        { id: 'from-market@test-market' },
      ],
      collisionPolicy: {
        tools: 'error' as const,
        skills: 'qualify' as const,
        subagents: 'qualify' as const,
        commands: 'qualify' as const,
      },
      output: {
        directory: '.deepagents/plugins',
        reproducible: true,
        includeSourceFiles: true,
        emitCompatibilityReport: true,
        emitSbom: false,
      },
    };

    const context = makeContext({ projectDir, workDir: path.join(projectDir, '.work') });
    const result = await resolvePluginSet(manifest, builtinResolvers(), context);
    expect(result.lockfile.plugins).toHaveLength(2);
    expect(result.lockfile.marketplaces).toHaveLength(1);
    expect(result.artifacts.map((artifact) => artifact.runtimeNamespace).sort()).toEqual([
      'demo-plugin',
      'from-market',
    ]);

    expect(result.lockfile.lockfileVersion).toBe(2);
    expect(result.lockfile.plugins[0]?.trustPolicy).toBe('third-party-restricted');
    expect(result.lockfile.plugins[0]?.detectedCapabilities).toEqual(['skills']);
    expect(result.lockfile.plugins[0]?.compilerProfile).toMatch(/^claude-plugin-/);

    const rerun = await resolvePluginSet(manifest, builtinResolvers(), context);
    expect(() => assertLockfilesMatch(result.lockfile, rerun.lockfile)).not.toThrow();

    const capabilityDrift = structuredClone(result.lockfile);
    const driftPlugin = capabilityDrift.plugins[0];
    if (driftPlugin) driftPlugin.detectedCapabilities = ['skills', 'mcp'];
    expect(() => assertLockfilesMatch(result.lockfile, capabilityDrift)).toThrow(
      /detected capabilities changed/,
    );

    const tampered = structuredClone(result.lockfile);
    const firstPlugin = tampered.plugins[0];
    if (firstPlugin) firstPlugin.contentDigest = 'sha256:tampered';
    expect(() => assertLockfilesMatch(tampered, rerun.lockfile)).toThrow(/Frozen lockfile/);

    const collisionManifest = {
      ...manifest,
      plugins: [
        { id: 'demo-plugin@direct', source: { type: 'local' as const, path: './plugins/demo' } },
        {
          id: 'demo-plugin-copy@direct',
          source: { type: 'local' as const, path: './plugins/demo' },
        },
      ],
    };
    await expect(resolvePluginSet(collisionManifest, builtinResolvers(), context)).rejects.toThrow(
      /namespace collision/i,
    );
  });

  it('rejects unsupported marketplace source shapes', () => {
    expect(() => marketplaceEntryToSourceSpec(42, '/tmp')).toThrow(/Unsupported marketplace/);
    const spec = marketplaceEntryToSourceSpec({ type: 'github', repo: 'acme/x' }, '/tmp');
    expect(spec).toMatchObject({ type: 'github', repository: 'acme/x' });
  });

  it('rejects marketplace-relative paths that escape the marketplace root', () => {
    expect(() => marketplaceEntryToSourceSpec('../../outside', '/tmp/marketplace')).toThrow(
      /escapes extraction root/,
    );
  });

  it('skips resolve/fetch when assertSourceAllowed denies a source', async () => {
    const context = makeContext();
    const denier = (): never => {
      throw new PluginResolutionError('source denied by test', ExitCodes.PolicyDenial);
    };
    await expect(
      resolvePluginSet(
        {
          schemaVersion: 1,
          plugins: [
            {
              id: 'demo@direct',
              source: { type: 'local', path: path.join(tmpRoot, 'does-not-matter') },
            },
          ],
          marketplaces: [],
        },
        builtinResolvers(),
        context,
        { assertSourceAllowed: denier },
      ),
    ).rejects.toMatchObject({ exitCode: ExitCodes.PolicyDenial });
  });
});

describe('LocalDirectoryResolver', () => {
  it('copies without .git and reports missing directories', async () => {
    const resolver = new LocalDirectoryResolver();
    await expect(
      resolver.resolve({ type: 'local', path: './does-not-exist' }, makeContext()),
    ).rejects.toMatchObject({ exitCode: 3 });
  });
});
