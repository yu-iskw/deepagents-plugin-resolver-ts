import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from './canonical-json.js';
import { DiagnosticCollector, DiagnosticCodes } from './diagnostics.js';
import { ExitCodes, PluginResolutionError } from './exit-codes.js';
import { isSha256Digest, sha256Digest, sha256DigestOfJson } from './hash.js';
import {
  formatPluginId,
  isReservedNamespace,
  normalizeName,
  parsePluginId,
  qualifiedToolId,
} from './ids.js';
import {
  capabilityAvailable,
  emptyDeepAgentsCapabilities,
  requiredCapabilitiesFromIr,
} from './capabilities.js';
import { compiledPluginSetSchema, IR_SCHEMA_VERSION } from './ir.js';
import { COMPILER_PROFILE, lockfileSchema } from './lockfile.js';
import { pluginSetManifestSchema } from './manifest.js';
import { pluginPolicyDocumentSchema } from './policy.js';

describe('canonicalJsonStringify', () => {
  it('sorts keys at every depth and appends a trailing newline', () => {
    const a = canonicalJsonStringify({ b: { d: 1, c: 2 }, a: [3, { z: 1, y: 2 }] });
    const b = canonicalJsonStringify({ a: [3, { y: 2, z: 1 }], b: { c: 2, d: 1 } });
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    expect(a.indexOf('"a"')).toBeLessThan(a.indexOf('"b"'));
  });

  it('drops undefined values and rejects non-finite numbers', () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe(canonicalJsonStringify({ b: 1 }));
    expect(() => canonicalJsonStringify({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});

describe('hash', () => {
  it('produces stable sha256 digests', () => {
    const digest = sha256Digest('hello');
    expect(digest).toBe('sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(isSha256Digest(digest)).toBe(true);
    expect(isSha256Digest('sha256:zz')).toBe(false);
  });

  it('hashes canonical JSON independent of key order', () => {
    expect(sha256DigestOfJson({ a: 1, b: 2 })).toBe(sha256DigestOfJson({ b: 2, a: 1 }));
  });
});

describe('ids', () => {
  it('normalizes names to kebab identifiers', () => {
    expect(normalizeName('My Plugin!!')).toBe('my-plugin');
    expect(() => normalizeName('!!!')).toThrow();
  });

  it('detects reserved namespaces', () => {
    expect(isReservedNamespace('deepagents')).toBe(true);
    expect(isReservedNamespace('plugin.review')).toBe(true);
    expect(isReservedNamespace('acme')).toBe(false);
  });

  it('formats and parses plugin ids', () => {
    expect(formatPluginId('review', 'market')).toBe('review@market');
    expect(formatPluginId('review')).toBe('review@direct');
    expect(parsePluginId('review@market')).toEqual({
      pluginName: 'review',
      marketplaceName: 'market',
    });
    expect(parsePluginId('review')).toEqual({ pluginName: 'review', marketplaceName: 'direct' });
    expect(qualifiedToolId('acme', 'scan')).toBe('plugin.acme.scan');
  });
});

describe('manifest schema', () => {
  it('parses a minimal v2 manifest with defaults', () => {
    const parsed = pluginSetManifestSchema.parse({
      apiVersion: 'deepagents.plugins/v2',
      kind: 'PluginSet',
      metadata: { name: 'test' },
      plugins: [{ id: 'p@direct', source: { type: 'local', path: './p' } }],
    });
    expect(parsed.output.directory).toBe('.deepagents/plugins');
    expect(parsed.collisionPolicy.tools).toBe('error');
    expect(parsed.runtime.compatibilityMode).toBe('standard');
    expect(parsed.runtime.interpreter.enabled).toBe(false);
    expect(parsed.runtime.interpreter.ptcDefault).toBe('deny');
    expect(parsed.runtime.asyncSubagents.allowedHosts).toEqual([]);
    expect(parsed.runtime.streaming.attachPluginProvenance).toBe(true);
  });

  it('parses per-plugin trustPolicy and feature toggles', () => {
    const parsed = pluginSetManifestSchema.parse({
      apiVersion: 'deepagents.plugins/v2',
      kind: 'PluginSet',
      metadata: { name: 'test' },
      plugins: [
        {
          id: 'p@direct',
          source: { type: 'local', path: './p' },
          trustPolicy: 'third-party-restricted',
          features: { memory: 'static-only', rubrics: 'templates-only', hooks: 'disabled' },
        },
      ],
    });
    expect(parsed.plugins[0]?.trustPolicy).toBe('third-party-restricted');
    expect(parsed.plugins[0]?.features?.memory).toBe('static-only');
  });

  it('rejects v1 and unknown api versions', () => {
    for (const apiVersion of ['deepagents.plugins/v1', 'other/v1']) {
      expect(() =>
        pluginSetManifestSchema.parse({
          apiVersion,
          kind: 'PluginSet',
          metadata: { name: 'x' },
          plugins: [{ id: 'a' }],
        }),
      ).toThrow();
    }
  });
});

describe('lockfile and policy schemas', () => {
  it('parses a v2 lockfile and rejects v1', () => {
    const lock = lockfileSchema.parse({
      lockfileVersion: 2,
      resolverVersion: '0.2.0',
      pluginSetDigest: 'sha256:abc',
      marketplaces: [],
      plugins: [
        {
          id: 'p@direct',
          trustPolicy: 'default',
          source: { type: 'local', uri: './p' },
          pluginRoot: '.',
          contentDigest: 'sha256:abc',
          manifestDigest: 'sha256:def',
          detectedCapabilities: ['skills', 'commands'],
          compilerProfile: COMPILER_PROFILE,
          files: {},
        },
      ],
    });
    expect(lock.lockfileVersion).toBe(2);
    expect(lock.plugins[0]?.detectedCapabilities).toContain('skills');
    expect(() =>
      lockfileSchema.parse({
        lockfileVersion: 1,
        resolverVersion: '0.1.0',
        pluginSetDigest: 'sha256:abc',
        marketplaces: [],
        plugins: [],
      }),
    ).toThrow();
  });

  it('parses a v2 policy document with new capability rules', () => {
    const policy = pluginPolicyDocumentSchema.parse({
      apiVersion: 'deepagents.plugins/v2',
      kind: 'PluginPolicy',
      defaults: {
        skills: 'allow',
        mcp: { stdio: 'deny' },
        memory: { static: 'allow', writable: 'deny' },
        profiles: { basePromptReplacement: 'deny', promptSuffix: 'review' },
        interpreter: 'deny',
        ptc: 'deny',
        rubrics: 'review',
        asyncSubagents: 'deny',
      },
      profiles: { internal: { subagents: 'allow' } },
    });
    expect(policy.defaults.mcp?.stdio).toBe('deny');
    expect(policy.defaults.memory?.writable).toBe('deny');
    expect(policy.defaults.profiles?.basePromptReplacement).toBe('deny');
  });
});

const EMPTY_IR = {
  schemaVersion: IR_SCHEMA_VERSION,
  compiler: { name: 'test', version: '0.0.0', compilerProfile: COMPILER_PROFILE },
  pluginSetDigest: 'sha256:abc',
  plugins: [],
  skills: [],
  memorySources: [],
  commands: [],
  syncSubagents: [],
  asyncSubagents: [],
  mcpServers: [],
  hooks: [],
  harnessProfiles: [],
  hitlPolicies: [],
  permissions: [],
  interpreterPolicies: [],
  rubricTemplates: [],
  streamMetadata: [],
  assets: [],
  executableAssets: [],
  diagnostics: [],
  provenance: [],
};

describe('IR schema', () => {
  it('validates an empty compiled plugin set v2', () => {
    const set = compiledPluginSetSchema.parse(EMPTY_IR);
    expect(set.schemaVersion).toBe('2.0');
    expect(set.compiler.compilerProfile).toBe(COMPILER_PROFILE);
  });

  it('validates v2 component schemas', () => {
    const set = compiledPluginSetSchema.parse({
      ...EMPTY_IR,
      memorySources: [
        {
          id: 'p/mem',
          pluginId: 'p@direct',
          path: 'memory/p/guidelines.md',
          kind: 'static-instructions',
          loadMode: 'on-demand',
          scope: 'agent',
          access: 'read-only',
          compatibility: 'translated',
        },
      ],
      harnessProfiles: [
        {
          id: 'p/profile',
          pluginId: 'p@direct',
          registrationKey: 'anthropic',
          priority: 0,
          config: { systemPromptSuffix: 'Be careful.' },
          compatibility: 'translated',
        },
      ],
      hitlPolicies: [
        {
          id: 'p/hitl',
          pluginId: 'p@direct',
          toolRef: 'plugin.p.write',
          risk: 'high',
          recommendedDecisions: ['approve', 'reject'],
        },
      ],
      interpreterPolicies: [
        {
          id: 'p/interp',
          pluginId: 'p@direct',
          enabled: false,
          persistence: 'turn',
          memoryLimitBytes: 1_000_000,
          timeoutMs: 5000,
          maxResultChars: 20_000,
          ptcTools: [],
          dynamicSubagents: [],
          compatibility: 'requires-adapter',
        },
      ],
      rubricTemplates: [
        {
          id: 'p/rubric',
          pluginId: 'p@direct',
          name: 'review-quality',
          criteria: ['is accurate'],
          compatibility: 'requires-adapter',
        },
      ],
      streamMetadata: [
        {
          id: 'p/stream',
          pluginId: 'p@direct',
          componentId: 'p/skill',
          namespace: ['p', 'skill'],
          provenanceTags: { pluginId: 'p@direct' },
          redactionFields: ['toolArguments'],
        },
      ],
    });
    expect(set.memorySources[0]?.access).toBe('read-only');
    expect(set.interpreterPolicies[0]?.compatibility).toBe('requires-adapter');
  });

  it('rejects v1-shaped plugin sets', () => {
    expect(() =>
      compiledPluginSetSchema.parse({
        schemaVersion: '1.0',
        generatedBy: { name: 'test', version: '0.0.0' },
        pluginSetDigest: 'sha256:abc',
        plugins: [],
        skills: [],
        commands: [],
        subagents: [],
        mcpServers: [],
        hooks: [],
        assets: [],
        executableAssets: [],
        diagnostics: [],
        provenance: [],
      }),
    ).toThrow();
  });
});

describe('capabilities', () => {
  it('derives requirements from IR arrays', () => {
    const ir = compiledPluginSetSchema.parse({
      ...EMPTY_IR,
      skills: [
        {
          id: 'p/skill',
          pluginId: 'p@direct',
          originalName: 'skill',
          runtimeName: 'p-skill',
          description: 'd',
          directory: 'skills/p/skill',
          skillFile: 'skills/p/skill/SKILL.md',
          compatibility: 'native',
        },
      ],
      rubricTemplates: [
        {
          id: 'p/rubric',
          pluginId: 'p@direct',
          name: 'r',
          criteria: ['c'],
          compatibility: 'requires-adapter',
        },
      ],
    });
    const requirements = requiredCapabilitiesFromIr(ir);
    expect(requirements).toEqual([
      { capability: 'rubric', required: false, componentIds: ['p/rubric'] },
      { capability: 'skills', required: true, componentIds: ['p/skill'] },
    ]);
  });

  it('checks availability against a capability map', () => {
    const none = emptyDeepAgentsCapabilities();
    expect(capabilityAvailable(none, 'skills')).toBe(false);
    expect(capabilityAvailable({ ...none, skills: true }, 'skills')).toBe(true);
    expect(
      capabilityAvailable(
        { ...none, interpreter: { available: true, ptc: false, dynamicSubagents: false } },
        'interpreter',
      ),
    ).toBe(true);
    expect(capabilityAvailable(none, 'unknown-capability')).toBe(false);
  });
});

describe('diagnostics', () => {
  it('sorts deterministically and reports errors', () => {
    const collector = new DiagnosticCollector();
    collector.add({
      code: DiagnosticCodes.PolicyDenied,
      severity: 'error',
      pluginId: 'b@direct',
      compatibility: 'blocked-by-policy',
      message: 'denied',
    });
    collector.add({
      code: DiagnosticCodes.ComponentUnsupported,
      severity: 'warning',
      pluginId: 'a@direct',
      compatibility: 'unsupported',
      message: 'monitors unsupported',
    });
    expect(collector.all[0]?.pluginId).toBe('a@direct');
    expect(collector.hasErrors()).toBe(true);
  });
});

describe('errors', () => {
  it('carries exit codes', () => {
    const error = new PluginResolutionError('bad digest', ExitCodes.IntegrityMismatch, 'refetch');
    expect(error.exitCode).toBe(4);
    expect(error.remediation).toBe('refetch');
  });
});
