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
import { compiledPluginSetSchema, IR_SCHEMA_VERSION } from './ir.js';
import { lockfileSchema } from './lockfile.js';
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
  it('parses a minimal manifest with defaults', () => {
    const parsed = pluginSetManifestSchema.parse({
      apiVersion: 'deepagents.plugins/v1',
      kind: 'PluginSet',
      metadata: { name: 'test' },
      plugins: [{ id: 'p@direct', source: { type: 'local', path: './p' } }],
    });
    expect(parsed.output.directory).toBe('.deepagents/plugins');
    expect(parsed.collisionPolicy.tools).toBe('error');
  });

  it('rejects unknown api versions', () => {
    expect(() =>
      pluginSetManifestSchema.parse({
        apiVersion: 'other/v1',
        kind: 'PluginSet',
        metadata: { name: 'x' },
        plugins: [{ id: 'a' }],
      }),
    ).toThrow();
  });
});

describe('lockfile and policy schemas', () => {
  it('parses a lockfile', () => {
    const lock = lockfileSchema.parse({
      lockfileVersion: 1,
      resolverVersion: '0.1.0',
      pluginSetDigest: 'sha256:abc',
      marketplaces: [],
      plugins: [],
    });
    expect(lock.lockfileVersion).toBe(1);
  });

  it('parses a policy document', () => {
    const policy = pluginPolicyDocumentSchema.parse({
      apiVersion: 'deepagents.plugins/v1',
      kind: 'PluginPolicy',
      defaults: { skills: 'allow', mcp: { stdio: 'deny' } },
      profiles: { internal: { subagents: 'allow' } },
    });
    expect(policy.defaults.mcp?.stdio).toBe('deny');
  });
});

describe('IR schema', () => {
  it('validates an empty compiled plugin set', () => {
    const set = compiledPluginSetSchema.parse({
      schemaVersion: IR_SCHEMA_VERSION,
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
    });
    expect(set.schemaVersion).toBe('1.0');
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
