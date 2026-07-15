import type { PolicyRules } from '@deepagents-plugins/schema';

/** Security defaults (RFC Appendix D). Deny-by-default for executable behavior. */
export const DEFAULT_POLICY_RULES: Required<Omit<PolicyRules, 'source' | 'sourceTrust'>> &
  Pick<PolicyRules, 'sourceTrust'> = {
  sourceTrust: 'untrusted',
  skills: 'allow',
  commands: 'allow',
  subagents: 'review',
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

/** Built-in profiles usable without a policy file. */
export const BUILTIN_PROFILES: Record<string, PolicyRules> = {
  development: {
    subagents: 'allow',
    mcp: { remoteHttp: 'allow', stdio: 'review' },
    hooks: { middleware: 'allow', webhook: 'allow', command: 'review' },
    binaries: 'review',
  },
  'third-party-restricted': {
    skills: 'allow',
    commands: 'allow',
    subagents: 'review',
    mcp: { remoteHttp: 'review', stdio: 'deny' },
  },
  'trusted-internal': {
    subagents: 'allow',
    mcp: { remoteHttp: 'allow', stdio: 'review' },
    hooks: { middleware: 'allow', webhook: 'allow', command: 'review' },
  },
};

export const DEFAULT_PROFILE_NAME = 'third-party-restricted';
