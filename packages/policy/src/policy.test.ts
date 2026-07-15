import { describe, expect, it } from 'vitest';

import { PolicyEvaluator } from './evaluator.js';
import { evaluateSourceTrust } from './source-trust.js';

describe('PolicyEvaluator', () => {
  it('applies RFC Appendix D defaults', () => {
    const evaluator = new PolicyEvaluator();
    const query = { pluginId: 'p@direct', profile: 'unknown-profile' };
    expect(evaluator.evaluate({ ...query, capability: 'skills' }).effect).toBe('allow');
    expect(evaluator.evaluate({ ...query, capability: 'mcp.stdio' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'hooks.command' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'monitors' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'subagents' }).effect).toBe('review');
    expect(evaluator.evaluate({ ...query, capability: 'not-a-capability' }).effect).toBe('deny');
  });

  it('lets profiles override defaults but never lets plugins pick profiles', () => {
    const evaluator = new PolicyEvaluator({
      document: {
        apiVersion: 'deepagents.plugins/v2',
        kind: 'PluginPolicy',
        defaults: { subagents: 'deny' },
        profiles: { internal: { subagents: 'allow' } },
      },
    });
    expect(
      evaluator.evaluate({ pluginId: 'p', profile: 'internal', capability: 'subagents' }).effect,
    ).toBe('allow');
    expect(
      evaluator.evaluate({ pluginId: 'p', profile: 'other', capability: 'subagents' }).effect,
    ).toBe('deny');
  });

  it('fails review in strict mode without a digest-bound approval', () => {
    const strict = new PolicyEvaluator({ strict: true });
    const decision = strict.evaluate({
      pluginId: 'p@direct',
      profile: 'third-party-restricted',
      capability: 'subagents',
      contentDigest: 'sha256:aaa',
    });
    expect(decision.effect).toBe('deny');
    expect(decision.remediation).toContain('PluginApproval');
  });

  it('accepts matching, unexpired approvals in strict mode', () => {
    const strict = new PolicyEvaluator({
      strict: true,
      approvals: [
        {
          apiVersion: 'deepagents.plugins/v2',
          kind: 'PluginApproval',
          pluginDigest: 'sha256:aaa',
          approvedCapabilities: ['subagents'],
          approvedBy: 'security@example.com',
          expiresAt: '2100-01-01T00:00:00Z',
        },
      ],
    });
    const decision = strict.evaluate({
      pluginId: 'p@direct',
      profile: 'third-party-restricted',
      capability: 'subagents',
      contentDigest: 'sha256:aaa',
    });
    expect(decision.effect).toBe('allow');
  });

  it('rejects expired approvals', () => {
    const strict = new PolicyEvaluator({
      strict: true,
      approvals: [
        {
          apiVersion: 'deepagents.plugins/v2',
          kind: 'PluginApproval',
          pluginDigest: 'sha256:aaa',
          approvedCapabilities: ['subagents'],
          approvedBy: 'security@example.com',
          expiresAt: '2000-01-01T00:00:00Z',
        },
      ],
    });
    expect(
      strict.evaluate({
        pluginId: 'p',
        profile: 'x',
        capability: 'subagents',
        contentDigest: 'sha256:aaa',
      }).effect,
    ).toBe('deny');
  });
});

describe('PolicyEvaluator v2 capabilities', () => {
  it('applies RFC v2 Appendix A defaults for new capabilities', () => {
    const evaluator = new PolicyEvaluator();
    const query = { pluginId: 'p@direct', profile: 'unknown-profile' };
    expect(evaluator.evaluate({ ...query, capability: 'memory.static' }).effect).toBe('review');
    expect(evaluator.evaluate({ ...query, capability: 'memory.writable' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'interpreter' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'ptc' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'asyncSubagents' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'rubrics' }).effect).toBe('review');
    expect(evaluator.evaluate({ ...query, capability: 'hitl' }).effect).toBe('allow');
    expect(evaluator.evaluate({ ...query, capability: 'profiles.fragment' }).effect).toBe('review');
  });

  it('governs harness profile fields per RFC section 14', () => {
    const evaluator = new PolicyEvaluator();
    const base = { pluginId: 'p@direct', profile: 'third-party-restricted' } as const;
    expect(evaluator.evaluateProfileField({ ...base, field: 'basePromptReplacement' }).effect).toBe(
      'deny',
    );
    expect(evaluator.evaluateProfileField({ ...base, field: 'promptSuffix' }).effect).toBe(
      'review',
    );
    expect(
      evaluator.evaluateProfileField({ ...base, field: 'overridePluginToolDescription' }).effect,
    ).toBe('allow');
    expect(
      evaluator.evaluateProfileField({ ...base, field: 'overrideApplicationToolDescription' })
        .effect,
    ).toBe('deny');
    expect(evaluator.evaluateProfileField({ ...base, field: 'excludeMiddleware' }).effect).toBe(
      'deny',
    );
    expect(
      evaluator.evaluateProfileField({ ...base, field: 'generalPurposeSubagent' }).effect,
    ).toBe('deny');
  });

  it('allows governed profile fields through digest-bound approvals in strict mode', () => {
    const strict = new PolicyEvaluator({
      strict: true,
      approvals: [
        {
          apiVersion: 'deepagents.plugins/v2',
          kind: 'PluginApproval',
          pluginDigest: 'sha256:aaa',
          approvedCapabilities: ['profiles.promptSuffix'],
          approvedBy: 'security@example.com',
        },
      ],
    });
    const approved = strict.evaluateProfileField({
      pluginId: 'p@direct',
      profile: 'third-party-restricted',
      field: 'promptSuffix',
      contentDigest: 'sha256:aaa',
    });
    expect(approved.effect).toBe('allow');
    const denied = strict.evaluateProfileField({
      pluginId: 'p@direct',
      profile: 'third-party-restricted',
      field: 'promptSuffix',
      contentDigest: 'sha256:bbb',
    });
    expect(denied.effect).toBe('deny');
  });

  it('permits development trust policy to relax memory and rubrics', () => {
    const evaluator = new PolicyEvaluator();
    const query = { pluginId: 'p@direct', profile: 'development' };
    expect(evaluator.evaluate({ ...query, capability: 'memory.static' }).effect).toBe('allow');
    expect(evaluator.evaluate({ ...query, capability: 'rubrics' }).effect).toBe('allow');
    expect(evaluator.evaluate({ ...query, capability: 'memory.writable' }).effect).toBe('deny');
    expect(evaluator.evaluate({ ...query, capability: 'ptc' }).effect).toBe('deny');
  });
});

describe('evaluateSourceTrust', () => {
  it('enforces npm scope allowlists', () => {
    const denied = evaluateSourceTrust(
      { type: 'npm', package: 'evil-package' },
      { npmScopes: ['@acme'] },
      'trusted-internal',
    );
    expect(denied.effect).toBe('deny');
    const allowed = evaluateSourceTrust(
      { type: 'npm', package: '@acme/security' },
      { npmScopes: ['@acme'] },
      'trusted-internal',
    );
    expect(allowed.effect).toBe('allow');
  });

  it('enforces github owner allowlists', () => {
    expect(
      evaluateSourceTrust(
        { type: 'github', repository: 'stranger/repo' },
        { githubOwners: ['acme'] },
        'p',
      ).effect,
    ).toBe('deny');
  });

  it('denies remote archives unless explicitly enabled', () => {
    expect(
      evaluateSourceTrust(
        { type: 'remote-archive', url: 'https://example.com/a.tgz', sha256: 'abc' },
        undefined,
        'p',
      ).effect,
    ).toBe('deny');
    expect(
      evaluateSourceTrust(
        { type: 'remote-archive', url: 'https://example.com/a.tgz', sha256: 'abc' },
        { allowRemoteArchives: true },
        'p',
      ).effect,
    ).toBe('allow');
  });
});
