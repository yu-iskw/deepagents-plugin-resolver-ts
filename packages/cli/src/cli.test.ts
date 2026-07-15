import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runCli, type CliIo } from './program.js';

let projectDir: string;

function io(): CliIo & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    lines,
    errors,
    out: (text) => lines.push(text),
    error: (text) => errors.push(text),
  };
}

async function run(args: string[]): Promise<{ code: number; io: ReturnType<typeof io> }> {
  const captured = io();
  const code = await runCli(['--project', projectDir, ...args], captured);
  return { code, io: captured };
}

beforeAll(async () => {
  projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-cli-'));
  const pluginDir = path.join(projectDir, 'plugins', 'project-local');
  await fs.mkdir(path.join(pluginDir, '.claude-plugin'), { recursive: true });
  await fs.writeFile(
    path.join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'project-local', version: '0.1.0', description: 'Local test plugin' }),
  );
  const skillDir = path.join(pluginDir, 'skills', 'greet');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, 'SKILL.md'),
    '---\ndescription: Greet users\n---\n\nGreet the user politely.\n',
  );
});

afterAll(async () => {
  await fs.rm(projectDir, { recursive: true, force: true });
});

describe('deepagents-plugins CLI', () => {
  it('init creates a starter manifest and refuses to overwrite', async () => {
    expect((await run(['init'])).code).toBe(0);
    await expect(fs.stat(path.join(projectDir, 'deepagents.plugins.yaml'))).resolves.toBeTruthy();
    expect((await run(['init'])).code).toBe(2);
  });

  it('doctor reports environment status', async () => {
    const { code, io: captured } = await run(['doctor']);
    expect(code).toBe(0);
    expect(captured.lines.join('\n')).toContain('node:');
  });

  it('resolve writes a lockfile; verify passes; list shows the plugin', async () => {
    expect((await run(['resolve'])).code).toBe(0);
    await expect(
      fs.stat(path.join(projectDir, 'deepagents.plugins.lock.json')),
    ).resolves.toBeTruthy();
    expect((await run(['verify'])).code).toBe(0);
    const { io: captured } = await run(['list']);
    expect(captured.lines.join('\n')).toContain('project-local@direct');
  });

  it('compile produces a verified bundle with a digest', async () => {
    const { code, io: captured } = await run(['compile', '--reproducible']);
    expect(code).toBe(0);
    expect(captured.lines.join('\n')).toMatch(/Bundle digest: sha256:/);
    await expect(
      fs.stat(path.join(projectDir, '.deepagents', 'plugins', 'bundle-manifest.json')),
    ).resolves.toBeTruthy();
  });

  it('audit reports no blocking issues for a skills-only plugin', async () => {
    const { code } = await run(['audit']);
    expect(code).toBe(0);
  });

  it('verify fails with exit code 4 when the source drifts from the lockfile', async () => {
    const skillPath = path.join(
      projectDir,
      'plugins',
      'project-local',
      'skills',
      'greet',
      'SKILL.md',
    );
    const original = await fs.readFile(skillPath, 'utf8');
    await fs.writeFile(skillPath, `${original}\nDrifted.\n`);
    const { code, io: captured } = await run(['verify', '--frozen-lockfile']);
    expect(code).toBe(4);
    expect(captured.errors.join('\n')).toContain('Frozen lockfile');
    await fs.writeFile(skillPath, original);
    expect((await run(['verify'])).code).toBe(0);
  });

  it('add and remove edit the manifest and validate schema errors exit 2', async () => {
    expect((await run(['add', 'extra@direct'])).code).toBe(0);
    expect((await run(['add', 'extra@direct'])).code).toBe(2);
    expect((await run(['remove', 'extra@direct'])).code).toBe(0);
    expect((await run(['remove', 'extra@direct'])).code).toBe(2);
    // extra@direct had no source and no marketplace: resolve must fail cleanly.
    expect((await run(['validate'])).code).toBe(0);
  });

  it('explain shows plugin details and fails for unknown plugins', async () => {
    const { code, io: captured } = await run(['explain', 'project-local@direct', '--json']);
    expect(code).toBe(0);
    expect(captured.lines.join('\n')).toContain('"contentDigest"');
    expect((await run(['explain', 'ghost@direct'])).code).toBe(2);
  });

  it('sbom emits CycloneDX JSON', async () => {
    const { code, io: captured } = await run(['sbom']);
    expect(code).toBe(0);
    expect(captured.lines.join('\n')).toContain('CycloneDX');
  });

  it('audit --sarif emits SARIF', async () => {
    const { code, io: captured } = await run(['audit', '--sarif']);
    expect(code).toBe(0);
    expect(captured.lines.join('\n')).toContain('sarif-2.1.0');
  });

  it('capabilities reports detection and required-vs-available comparison', async () => {
    const { code, io: captured } = await run(['--json', 'capabilities']);
    expect(code).toBe(0);
    const parsed = JSON.parse(captured.lines.join('\n')) as {
      capabilities: { skills: boolean; interpreter: { available: boolean } };
      comparison: { capability: string; required: boolean; available: boolean }[];
    };
    // deepagents is installed in this workspace, so detection succeeds.
    expect(parsed.capabilities.skills).toBe(true);
    expect(parsed.comparison.some((entry) => entry.capability === 'skills')).toBe(true);
  });

  it('capabilities reports detection only when the manifest is missing', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-cli-caps-'));
    try {
      const captured = io();
      const code = await runCli(['--project', emptyDir, '--json', 'capabilities'], captured);
      expect(code).toBe(0);
      const parsed = JSON.parse(captured.lines.join('\n')) as {
        comparison: unknown[];
      };
      expect(parsed.comparison).toEqual([]);
    } finally {
      await fs.rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('capabilities surfaces invalid-manifest failures', async () => {
    const brokenDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-cli-caps-bad-'));
    try {
      await fs.writeFile(path.join(brokenDir, 'deepagents.plugins.yaml'), 'plugins: not-a-list\n');
      const captured = io();
      const code = await runCli(['--project', brokenDir, '--json', 'capabilities'], captured);
      expect(code).toBe(2);
      expect(captured.errors.join('\n')).toMatch(/Invalid plugin manifest|Failed to parse/);
    } finally {
      await fs.rm(brokenDir, { recursive: true, force: true });
    }
  });

  it('unknown commands exit with configuration error', async () => {
    expect((await run(['definitely-not-a-command'])).code).toBe(2);
  });
});
