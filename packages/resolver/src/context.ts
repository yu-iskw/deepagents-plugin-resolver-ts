import type { ContentLimits } from './limits.js';
import type { PluginSourceSpec } from '@deepagents-plugins/schema';

/** Redact credential-looking material from messages (RFC 14.4, 23.3). */
export function redactSecrets(text: string): string {
  // Avoid nested quantifiers that can ReDoS on pathological inputs.
  let out = text;
  out = out.replaceAll(/https?:\/\/[^/\s]+@/g, (match) => {
    const schemeEnd = match.indexOf('://') + 3;
    return `${match.slice(0, schemeEnd)}<redacted>@`;
  });
  out = out.replaceAll(/\b(?:gh[pousr]_|npm_)[A-Za-z0-9_]{8,}\b/g, '<redacted-token>');
  out = out.replaceAll(/\b(?:Bearer|token)\s+\S{8,}/gi, (match) => {
    const space = match.search(/\s/);
    return `${match.slice(0, space)} <redacted>`;
  });
  return out;
}

export interface CredentialProvider {
  /** Token for a GitHub or git host, or undefined for anonymous access. */
  gitToken(host: string): string | undefined;
  /** Token for an npm registry, or undefined for anonymous access. */
  npmToken(registry: string): string | undefined;
}

/** Default provider: environment variables only, never persisted. */
export function envCredentialProvider(env: NodeJS.ProcessEnv = process.env): CredentialProvider {
  return {
    gitToken: (host) => {
      const normalized = host.toLowerCase();
      const isGitHub =
        normalized === 'github.com' ||
        normalized.endsWith('.github.com') ||
        normalized === 'www.github.com';
      return isGitHub ? (env.GITHUB_TOKEN ?? env.GH_TOKEN) : env.DEEPAGENTS_GIT_TOKEN;
    },
    npmToken: () => env.NPM_TOKEN ?? env.NODE_AUTH_TOKEN,
  };
}

export interface ResolveContext {
  limits: ContentLimits;
  credentials: CredentialProvider;
  offline: boolean;
  cacheDir: string;
  /** Base directory that relative local sources resolve against. */
  projectDir: string;
  workDir: string;
}

export interface ResolvedPluginSource {
  sourceType: string;
  requested: PluginSourceSpec;
  /** Immutable identity: commit SHA, exact version + integrity, or sha256. */
  immutableIdentity: string;
  version?: string;
  uri: string;
  expectedIntegrity?: string;
  requestedRef?: string;
  pluginRoot?: string;
  metadata: Record<string, string>;
}

export interface FetchedPluginSource {
  resolved: ResolvedPluginSource;
  /** Absolute path of the canonical plugin root on disk. */
  rootDir: string;
}

export interface PluginSourceResolver<TSpec extends PluginSourceSpec = PluginSourceSpec> {
  readonly type: TSpec['type'];
  canResolve(spec: PluginSourceSpec): spec is TSpec;
  resolve(spec: TSpec, context: ResolveContext): Promise<ResolvedPluginSource>;
  fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    context: ResolveContext,
  ): Promise<FetchedPluginSource>;
}
