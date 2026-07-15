import type { PolicyRules } from '@deepagents-plugins/schema';

/** Security defaults (RFC v2 Appendix A). Deny-by-default for executable behavior. */
export const DEFAULT_POLICY_RULES: Required<Omit<PolicyRules, 'source' | 'sourceTrust'>> &
  Pick<PolicyRules, 'sourceTrust'> = {
  sourceTrust: 'untrusted',
  skills: 'allow',
  commands: 'allow',
  subagents: 'review',
  asyncSubagents: 'deny',
  memory: {
    static: 'review',
    writable: 'deny',
  },
  profiles: {
    fragment: 'review',
    basePromptReplacement: 'deny',
    promptSuffix: 'review',
    overridePluginToolDescription: 'allow',
    overrideApplicationToolDescription: 'deny',
    excludePluginTool: 'allow',
    excludeApplicationTool: 'deny',
    excludeMiddleware: 'deny',
    addMiddleware: 'review',
    generalPurposeSubagent: 'deny',
  },
  interpreter: 'deny',
  ptc: 'deny',
  rubrics: 'review',
  hitl: 'allow',
  mcp: {
    remoteHttp: 'review',
    stdio: 'deny',
  },
  hooks: {
    middleware: 'allow',
    webhook: 'review',
    command: 'deny',
  },
  lsp: 'deny',
  monitors: 'deny',
  binaries: 'deny',
  settings: 'allow',
  unknownComponents: 'deny',
};

/** Built-in trust policies usable without a policy file. */
export const BUILTIN_PROFILES: Record<string, PolicyRules> = {
  development: {
    subagents: 'allow',
    memory: { static: 'allow' },
    profiles: { fragment: 'allow', promptSuffix: 'allow' },
    rubrics: 'allow',
    mcp: { remoteHttp: 'allow', stdio: 'review' },
    hooks: { middleware: 'allow', webhook: 'allow', command: 'review' },
    binaries: 'review',
  },
  'third-party-restricted': {
    skills: 'allow',
    commands: 'allow',
    subagents: 'review',
    asyncSubagents: 'deny',
    memory: { static: 'review', writable: 'deny' },
    interpreter: 'deny',
    ptc: 'deny',
    rubrics: 'review',
    mcp: { remoteHttp: 'review', stdio: 'deny' },
  },
  'trusted-internal': {
    subagents: 'allow',
    memory: { static: 'allow' },
    profiles: { fragment: 'allow', promptSuffix: 'allow', addMiddleware: 'review' },
    rubrics: 'allow',
    asyncSubagents: 'review',
    mcp: { remoteHttp: 'allow', stdio: 'review' },
    hooks: { middleware: 'allow', webhook: 'allow', command: 'review' },
  },
};

export const DEFAULT_PROFILE_NAME = 'third-party-restricted';
