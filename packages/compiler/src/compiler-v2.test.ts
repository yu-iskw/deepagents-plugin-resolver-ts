import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PolicyEvaluator } from '@deepagents-plugins/policy';
import { DEFAULT_RUNTIME_CONFIG, type LockedPlugin } from '@deepagents-plugins/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeBundle } from './bundler.js';
import {
  compilePluginSet,
  type CompileOptions,
  type PluginCompileInput,
} from './compile-plugin-set.js';

let tmpRoot: string;
let pluginDir: string;

async function write(root: string, relative: string, content: string): Promise<void> {
  const filePath = path.join(root, relative);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function writeV2Plugin(root: string): Promise<void> {
  await write(
    root,
    '.claude-plugin/plugin.json',
    JSON.stringify({ name: 'v2-plugin', version: '1.0.0', description: 'v2 features' }),
  );
  await write(
    root,
    'skills/review/SKILL.md',
    '---\nname: review\ndescription: Review things\n---\n\nReview carefully.\n',
  );
  await write(
    root,
    'memory/guidelines.md',
    '---\nkind: procedural\nloadMode: startup\n---\n\nAlways follow the checklist.\n',
  );
  await write(
    root,
    'memory/scratch.md',
    '---\naccess: read-write\n---\n\nPlugin wants to write here.\n',
  );
  await write(
    root,
    'profiles/anthropic.json',
    JSON.stringify({
      registrationKey: 'anthropic',
      baseSystemPrompt: 'REPLACE EVERYTHING',
      systemPromptSuffix: 'Be careful.',
      toolDescriptionOverrides: {
        'plugin.v2-plugin.scan': 'Scan plugin files',
        'application.dangerous': 'hijacked',
      },
      excludedTools: ['plugin.v2-plugin.scan', 'application.dangerous'],
    }),
  );
  await write(
    root,
    'rubrics/review-quality.json',
    JSON.stringify({ name: 'review-quality', criteria: ['accurate', 'complete'], maxIterations: 99 }),
  );
  await write(
    root,
    'agents/helper.md',
    '---\nname: helper\ndescription: Sync helper\ntools: Read\nmemory: guidelines\n---\n\nHelp out.\n',
  );
  await write(
    root,
    'agents/researcher.md',
    '---\nname: researcher\ndescription: Long-running researcher\nendpoint: https://agents.internal.example.com/researcher\n---\n\nResearch deeply.\n',
  );
  await write(
    root,
    'interpreter.json',
    JSON.stringify({ persistence: 'thread', ptcTools: ['plugin.v2-plugin.scan'] }),
  );
}

function makeInput(rootDir: string, trustPolicy = 'development'): PluginCompileInput {
  const locked: LockedPlugin = {
    id: 'v2-plugin@direct',
    trustPolicy,
    version: '1.0.0',
    source: { type: 'local', uri: rootDir },
    pluginRoot: '.',
    contentDigest: 'sha256:' + 'a'.repeat(64),
    manifestDigest: 'sha256:' + 'b'.repeat(64),
    detectedCapabilities: [],
    compilerProfile: 'claude-plugin-v2026-07',
    files: {},
  };
  return {
    locked,
    rootDir,
    manifest: { name: 'v2-plugin', version: '1.0.0' },
    runtimeNamespace: 'v2-plugin',
    requested: { type: 'local', path: rootDir },
  };
}

function options(overrides: Partial<CompileOptions> = {}): CompileOptions {
  return {
    // asyncSubagents are deny-by-default (Appendix A); these tests opt in so
    // the endpoint-allowlist and adapter-gating paths are exercised.
    policy: new PolicyEvaluator({
      document: {
        apiVersion: 'deepagents.plugins/v2',
        kind: 'PluginPolicy',
        defaults: { asyncSubagents: 'allow' },
        profiles: {},
      },
    }),
    compatibilityMode: 'permissive',
    pluginSetDigest: 'sha256:' + 'c'.repeat(64),
    runtime: {
      ...DEFAULT_RUNTIME_CONFIG,
      asyncSubagents: { allowedHosts: ['agents.internal.example.com'] },
    },
    ...overrides,
  };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-compiler-v2-'));
  pluginDir = path.join(tmpRoot, 'plugin');
  await writeV2Plugin(pluginDir);
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('memory compilation (RFC 13)', () => {
  it('compiles read-only agent-scoped memory and denies writable requests', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    expect(ir.memorySources).toHaveLength(2);
    for (const memory of ir.memorySources) {
      expect(memory.access).toBe('read-only');
      expect(memory.path.startsWith('memory/v2-plugin/')).toBe(true);
    }
    const guidelines = ir.memorySources.find((memory) => memory.id.includes('guidelines'));
    expect(guidelines).toMatchObject({ kind: 'procedural', loadMode: 'startup', scope: 'agent' });
    const denial = ir.diagnostics.find((diagnostic) => diagnostic.code === 'DAP2307');
    expect(denial?.compatibility).toBe('blocked-by-policy');
    expect(denial?.severity).toBe('warning');
  });

  it('skips memory entirely when the feature toggle disables it', async () => {
    const input = { ...makeInput(pluginDir), features: { memory: 'disabled' as const } };
    const { ir } = await compilePluginSet([input], options());
    expect(ir.memorySources).toHaveLength(0);
  });
});

describe('harness profile governance (RFC 14)', () => {
  it('strips denied fields with DAP2308 and keeps governed ones', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    expect(ir.harnessProfiles).toHaveLength(1);
    const profile = ir.harnessProfiles[0];
    expect(profile?.registrationKey).toBe('anthropic');
    // development policy allows suffix; base prompt replacement stays denied.
    expect(profile?.config.baseSystemPrompt).toBeUndefined();
    expect(profile?.config.systemPromptSuffix).toBe('Be careful.');
    // Plugin-owned tool overrides/exclusions allowed; application ones stripped.
    expect(profile?.config.toolDescriptionOverrides).toEqual({
      'plugin.v2-plugin.scan': 'Scan plugin files',
    });
    expect(profile?.config.excludedTools).toEqual(['plugin.v2-plugin.scan']);
    expect(profile?.compatibility).toBe('partial');
    const denied = ir.diagnostics.filter((diagnostic) => diagnostic.code === 'DAP2308');
    expect(denied.length).toBeGreaterThanOrEqual(3);
  });
});

describe('sync and async subagents (RFC 15, 17)', () => {
  it('compiles sync subagents with refs and async subagents as requires-adapter', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    const sync = ir.syncSubagents.find((subagent) => subagent.name === 'helper');
    expect(sync).toMatchObject({
      toolRefs: ['Read'],
      skillRefs: ['v2-plugin:review'],
      memoryRefs: ['v2-plugin:guidelines'],
      middlewareAdapterRefs: [],
    });
    const asyncAgent = ir.asyncSubagents.find((subagent) => subagent.name === 'researcher');
    expect(asyncAgent).toMatchObject({
      transport: 'http',
      endpointRef: 'https://agents.internal.example.com/researcher',
      compatibility: 'requires-adapter',
    });
    expect(ir.diagnostics.some((diagnostic) => diagnostic.code === 'DAP4208')).toBe(true);
  });

  it('blocks async endpoints outside the allowlist', async () => {
    const { ir } = await compilePluginSet(
      [makeInput(pluginDir)],
      options({ runtime: { ...DEFAULT_RUNTIME_CONFIG, asyncSubagents: { allowedHosts: [] } } }),
    );
    expect(ir.asyncSubagents).toHaveLength(0);
    expect(
      ir.diagnostics.some(
        (diagnostic) =>
          diagnostic.component === 'agents/researcher.md' &&
          diagnostic.compatibility === 'blocked-by-policy' &&
          diagnostic.severity === 'error',
      ),
    ).toBe(true);
  });
});

describe('interpreter policies (RFC 16)', () => {
  it('emits runtime-unavailable when runtime.interpreter is disabled', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    expect(ir.interpreterPolicies).toHaveLength(1);
    expect(ir.interpreterPolicies[0]).toMatchObject({
      enabled: false,
      ptcTools: [],
      compatibility: 'runtime-unavailable',
    });
    expect(ir.diagnostics.some((diagnostic) => diagnostic.code === 'DAP4207')).toBe(true);
  });

  it('keeps PTC denied even when the interpreter is enabled', async () => {
    const { ir } = await compilePluginSet(
      [makeInput(pluginDir)],
      options({
        policy: new PolicyEvaluator({
          document: {
            apiVersion: 'deepagents.plugins/v2',
            kind: 'PluginPolicy',
            defaults: { interpreter: 'allow' },
            profiles: {},
          },
        }),
        runtime: {
          ...DEFAULT_RUNTIME_CONFIG,
          interpreter: { enabled: true, ptcDefault: 'deny' },
        },
      }),
    );
    expect(ir.interpreterPolicies[0]).toMatchObject({
      enabled: true,
      ptcTools: [],
      compatibility: 'requires-adapter',
    });
  });
});

describe('rubric templates (RFC 23)', () => {
  it('compiles templates as data with a clamped iteration cap', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    expect(ir.rubricTemplates).toHaveLength(1);
    expect(ir.rubricTemplates[0]).toMatchObject({
      name: 'review-quality',
      criteria: ['accurate', 'complete'],
      maxIterations: 5,
      dataPolicy: { allowExternalGrader: false },
      compatibility: 'requires-adapter',
    });
  });
});

describe('stream metadata (RFC 20)', () => {
  it('attaches provenance and redaction fields per component', async () => {
    const { ir } = await compilePluginSet([makeInput(pluginDir)], options());
    expect(ir.streamMetadata.length).toBeGreaterThan(0);
    const skillStream = ir.streamMetadata.find((entry) => entry.componentId === 'v2-plugin:review');
    expect(skillStream).toMatchObject({
      namespace: ['v2-plugin', 'skill'],
      redactionFields: ['tool-call.arguments'],
    });
    expect(skillStream?.provenanceTags.pluginId).toBe('v2-plugin@direct');
  });
});

describe('strict mode with v2 statuses', () => {
  it('fails on requires-adapter and runtime-unavailable diagnostics', async () => {
    await expect(
      compilePluginSet([makeInput(pluginDir)], options({ compatibilityMode: 'strict' })),
    ).rejects.toMatchObject({ exitCode: 6 });
  });
});

describe('bundler v2 outputs', () => {
  it('writes harness profiles, memory, and rubric files into the bundle', async () => {
    const compiled = await compilePluginSet([makeInput(pluginDir)], options());
    const outputDir = path.join(tmpRoot, 'bundle');
    const bundle = await writeBundle(compiled, { outputDir, reproducible: true });
    expect(bundle.manifest.schemaVersion).toBe(2);
    await expect(
      fs.stat(path.join(outputDir, 'profiles', 'harness-profiles.json')),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputDir, 'memory', 'v2-plugin', 'guidelines.md')),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(outputDir, 'rubrics', 'v2-plugin', 'review-quality.json')),
    ).resolves.toBeTruthy();
  });
});
