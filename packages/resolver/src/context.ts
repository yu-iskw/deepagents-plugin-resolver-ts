import type { ContentLimits } from './limits.js';
import type { PluginSourceSpec } from '@deepagents-plugins/schema';

/** Redact credential-looking material from messages (RFC 14.4, 23.3). */
export function redactSecrets(text: string): string {
  return text
    .replaceAll(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1<redacted>@')
    .replaceAll(/\b(gh[pousr]_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,})\b/g, '<redacted-token>')
    .replaceAll(/\b(Bearer|token)\s+[A-Za-z0-9._-]{16,}/gi, '$1 <redacted>');
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
    gitToken: (host) =>
      host.endsWith('github.com') ? (env.GITHUB_TOKEN ?? env.GH_TOKEN) : env.DEEPAGENTS_GIT_TOKEN,
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
