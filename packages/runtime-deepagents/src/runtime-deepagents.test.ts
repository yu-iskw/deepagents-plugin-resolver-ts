import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compilePluginSet, writeBundle } from '@deepagents-plugins/compiler';
import { PolicyEvaluator } from '@deepagents-plugins/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { detectDeepAgentsCapabilities } from './capabilities.js';
import { createDeepAgentsContributions } from './contributions.js';
import { loadPluginBundle } from './load-plugin-bundle.js';

import type { LockedPlugin } from '@deepagents-plugins/schema';

let tmpRoot: string;
let bundleDir: string;

const fakeDeepAgents = {
  createDeepAgent: (): void => undefined,
  registerHarnessProfile: (): void => undefined,
  version: '0.5.0',
};

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-rda-'));
  const pluginDir = path.join(tmpRoot, 'plugin');
  const write = async (relative: string, content: string): Promise<void> => {
    const filePath = path.join(pluginDir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  };
  await write(
    '.claude-plugin/plugin.json',
    JSON.stringify({ name: 'demo', version: '1.0.0', description: 'Demo plugin' }),
  );
  await write('skills/hello/SKILL.md', '---\ndescription: Say hello\n---\n\nGreet the user.\n');
  await write(
    'memory/guidelines.md',
    '---\nkind: procedural\n---\n\nAlways greet politely.\n',
  );
  await write(
    'profiles/anthropic.json',
    JSON.stringify({ registrationKey: 'anthropic', systemPromptSuffix: 'Be nice.' }),
  );
  await write(
    'agents/helper.md',
    '---\nname: helper\ndescription: Helps\ntools: Read\n---\n\nHelp out.\n',
  );

  const locked: LockedPlugin = {
    id: 'demo@direct',
    trustPolicy: 'development',
    version: '1.0.0',
    source: { type: 'local', uri: pluginDir },
    pluginRoot: '.',
    contentDigest: 'sha256:' + 'a'.repeat(64),
    manifestDigest: 'sha256:' + 'b'.repeat(64),
    detectedCapabilities: ['agents', 'memory', 'profiles', 'skills'],
    compilerProfile: 'claude-plugin-v2026-07',
    files: {},
  };
  const compiled = await compilePluginSet(
    [
      {
        locked,
        rootDir: pluginDir,
        manifest: { name: 'demo', version: '1.0.0', description: 'Demo plugin' },
        runtimeNamespace: 'demo',
        requested: { type: 'local', path: pluginDir },
      },
    ],
    {
      policy: new PolicyEvaluator(),
      compatibilityMode: 'permissive',
      pluginSetDigest: 'sha256:' + 'c'.repeat(64),
    },
  );
  bundleDir = path.join(tmpRoot, 'bundle');
  await writeBundle(compiled, { outputDir: bundleDir, reproducible: true });
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('detectDeepAgentsCapabilities', () => {
  it('returns all-false when no module is available', async () => {
    const capabilities = await detectDeepAgentsCapabilities({ autoImport: false });
    expect(capabilities.skills).toBe(false);
    expect(capabilities.interpreter.available).toBe(false);
    expect(capabilities.version).toBeUndefined();
  });

  it('probes exports structurally from an injected module', async () => {
    const capabilities = await detectDeepAgentsCapabilities({ module: fakeDeepAgents });
    expect(capabilities.skills).toBe(true);
    expect(capabilities.syncSubagents).toBe(true);
    expect(capabilities.harnessProfiles).toBe(true);
    expect(capabilities.asyncSubagents).toBe(false);
    expect(capabilities.version).toBe('0.5.0');
  });

  it('treats registered adapters as capabilities', async () => {
    const capabilities = await detectDeepAgentsCapabilities({
      module: fakeDeepAgents,
      registeredAdapters: {
        interpreter: { implementation: 'quickjs-worker', ptc: true },
        rubric: { implementation: 'llm-judge' },
      },
    });
    expect(capabilities.interpreter).toEqual({
      available: true,
      implementation: 'quickjs-worker',
      ptc: true,
      dynamicSubagents: false,
    });
    expect(capabilities.rubric.available).toBe(true);
  });

  it('ignores objects without createDeepAgent', async () => {
    const capabilities = await detectDeepAgentsCapabilities({ module: { other: true } });
    expect(capabilities.skills).toBe(false);
  });
});

describe('createDeepAgentsContributions', () => {
  it('builds contributions when capabilities match', async () => {
    const bundle = await loadPluginBundle({ directory: bundleDir });
    const registered: string[] = [];
    const contributions = await createDeepAgentsContributions({
      bundle,
      module: fakeDeepAgents,
      profileRegistrar: (profile) => registered.push(profile.registrationKey),
    });

    expect(contributions.skillSources).toHaveLength(1);
    expect(contributions.memorySources[0]).toContain(
      path.join('memory', 'demo', 'guidelines.md'),
    );
    expect(contributions.syncSubagents).toEqual([
      {
        name: 'helper',
        description: 'Helps',
        systemPrompt: 'Help out.',
        tools: ['Read'],
        skills: ['demo:hello'],
        memory: [],
        pluginId: 'demo@direct',
      },
    ]);
    expect(contributions.interruptRecommendations).toEqual({});

    contributions.registerHarnessProfiles();
    expect(registered).toEqual(['anthropic']);

    const transformer = contributions.streamTransformers[0];
    expect(transformer).toBeDefined();
    const tagged = transformer?.({ token: 'hi' }, 'demo:hello');
    expect(tagged?.source).toMatchObject({
      pluginId: 'demo@direct',
      componentId: 'demo:hello',
      namespace: ['demo', 'skill'],
    });
    expect(tagged?.redaction).toEqual({ applied: true, fields: ['tool-call.arguments'] });
  });

  it('fails with DAP4210 when a required capability is missing', async () => {
    const bundle = await loadPluginBundle({ directory: bundleDir });
    await expect(
      createDeepAgentsContributions({ bundle, autoImport: false }),
    ).rejects.toThrow(/DAP4210.*skills/);
  });

  it('disables optional capabilities with warnings instead of failing', async () => {
    const bundle = await loadPluginBundle({ directory: bundleDir });
    const noProfiles = { ...fakeDeepAgents, registerHarnessProfile: undefined };
    const contributions = await createDeepAgentsContributions({
      bundle,
      module: noProfiles,
    });
    expect(contributions.skillSources).toHaveLength(1);
    expect(
      contributions.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === 'DAP4210' && diagnostic.compatibility === 'runtime-unavailable',
      ),
    ).toBe(true);
    // Without a registrar, registering profiles records a diagnostic.
    contributions.registerHarnessProfiles();
    expect(
      contributions.diagnostics.some((diagnostic) => diagnostic.component === 'harness-profiles'),
    ).toBe(true);
  });
});
