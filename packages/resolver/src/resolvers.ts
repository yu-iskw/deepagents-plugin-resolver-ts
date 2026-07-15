import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ExitCodes,
  PluginResolutionError,
  digestsEqual,
  normalizeSha256Digest,
  sha256Digest,
  sha256DigestOfFile,
  type GitSourceSpec,
  type GithubSourceSpec,
  type LocalArchiveSourceSpec,
  type LocalSourceSpec,
  type NpmSourceSpec,
  type PluginSourceSpec,
  type RemoteArchiveSourceSpec,
} from '@deepagents-plugins/schema';

import { createGitClient, isFullCommitSha, type GitClient } from './git.js';
import { fetchBytes, fetchJson } from './http.js';
import { assertInsideRoot } from './path-safety.js';
import { safeExtractTar, safeExtractTarBytes } from './safe-extract.js';
import { resolveVersionRange } from './semver.js';

import type {
  FetchedPluginSource,
  PluginSourceResolver,
  ResolveContext,
  ResolvedPluginSource,
} from './context.js';

function pluginRootOf(checkoutDir: string, pluginRoot: string | undefined): string {
  const root = path.join(checkoutDir, pluginRoot ?? '.');
  assertInsideRoot(checkoutDir, root);
  return root;
}

async function assertDirectoryExists(dir: string, label: string): Promise<void> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      throw new PluginResolutionError(
        `${label} "${dir}" does not exist or is not a directory`,
        ExitCodes.ResolutionFailure,
      );
    }
  } catch (error) {
    if (error instanceof PluginResolutionError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') {
      throw new PluginResolutionError(
        `${label} "${dir}" does not exist or is not a directory`,
        ExitCodes.ResolutionFailure,
      );
    }
    throw error;
  }
}

async function extractVerifiedArchive(
  bytes: Uint8Array,
  destination: string,
  context: ResolveContext,
  extractOptions?: { stripComponents?: number },
): Promise<void> {
  await safeExtractTarBytes(bytes, destination, context.limits, extractOptions);
}

async function cloneDetached(
  git: GitClient,
  uri: string,
  commit: string,
  destination: string,
  pluginRoot: string | undefined,
  resolved: ResolvedPluginSource,
): Promise<FetchedPluginSource> {
  await git.clone(uri, commit, destination);
  await fs.rm(path.join(destination, '.git'), { recursive: true, force: true });
  return { resolved, rootDir: pluginRootOf(destination, pluginRoot) };
}

async function resolveGitCommit(
  git: GitClient,
  url: string,
  spec: { ref?: string; commit?: string },
  context: ResolveContext,
): Promise<string> {
  if (spec.commit) {
    if (!isFullCommitSha(spec.commit)) {
      throw new PluginResolutionError(
        `Git commit "${spec.commit}" must be a full 40-character SHA`,
        ExitCodes.ConfigurationError,
      );
    }
    return spec.commit;
  }
  if (context.offline) {
    throw new PluginResolutionError(
      `Offline mode: cannot resolve ref "${spec.ref ?? 'HEAD'}" for ${url}`,
      ExitCodes.OfflineCacheMiss,
      'Pin a full commit SHA or resolve online first.',
    );
  }
  const sha = await git.lsRemote(url, spec.ref ?? 'HEAD');
  if (!sha || !isFullCommitSha(sha)) {
    throw new PluginResolutionError(
      `Could not resolve ref "${spec.ref ?? 'HEAD'}" for ${url}`,
      ExitCodes.ResolutionFailure,
    );
  }
  return sha;
}

/* ------------------------------ local ------------------------------ */

export class LocalDirectoryResolver implements PluginSourceResolver<LocalSourceSpec> {
  readonly type = 'local' as const;

  canResolve(spec: PluginSourceSpec): spec is LocalSourceSpec {
    return spec.type === 'local';
  }

  async resolve(spec: LocalSourceSpec, context: ResolveContext): Promise<ResolvedPluginSource> {
    const absolute = path.resolve(context.projectDir, spec.path);
    await assertDirectoryExists(absolute, 'Local plugin source');
    return {
      sourceType: 'local',
      requested: spec,
      immutableIdentity: `local:${spec.path}`,
      uri: absolute,
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: {},
    };
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    _context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    await fs.mkdir(destination, { recursive: true });
    await fs.cp(resolved.uri, destination, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !source.split(path.sep).includes('.git'),
    });
    return { resolved, rootDir: pluginRootOf(destination, resolved.pluginRoot) };
  }
}

/* --------------------------- local archive -------------------------- */

export class LocalArchiveResolver implements PluginSourceResolver<LocalArchiveSourceSpec> {
  readonly type = 'local-archive' as const;

  canResolve(spec: PluginSourceSpec): spec is LocalArchiveSourceSpec {
    return spec.type === this.type;
  }

  async resolve(
    spec: LocalArchiveSourceSpec,
    context: ResolveContext,
  ): Promise<ResolvedPluginSource> {
    const absolute = path.resolve(context.projectDir, spec.path);
    const digest = await sha256DigestOfFile(absolute);
    if (spec.sha256 && !digestsEqual(digest, normalizeSha256Digest(spec.sha256))) {
      throw new PluginResolutionError(
        `Archive "${spec.path}" digest ${digest} does not match declared sha256`,
        ExitCodes.IntegrityMismatch,
        'Update the declared sha256 or replace the archive with the expected content.',
      );
    }
    return {
      sourceType: this.type,
      requested: spec,
      immutableIdentity: digest,
      uri: absolute,
      expectedIntegrity: digest,
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: {},
    };
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    const digest = await sha256DigestOfFile(resolved.uri);
    if (resolved.expectedIntegrity && !digestsEqual(digest, resolved.expectedIntegrity)) {
      throw new PluginResolutionError(
        `Archive digest changed between resolve and fetch: ${digest}`,
        ExitCodes.IntegrityMismatch,
      );
    }
    await safeExtractTar(resolved.uri, destination, context.limits);
    return { resolved, rootDir: pluginRootOf(destination, resolved.pluginRoot) };
  }
}

/* --------------------------- remote archive ------------------------- */

export class RemoteArchiveResolver implements PluginSourceResolver<RemoteArchiveSourceSpec> {
  readonly type = 'remote-archive' as const;

  canResolve(spec: PluginSourceSpec): spec is RemoteArchiveSourceSpec {
    return spec.type === this.type;
  }

  resolve(spec: RemoteArchiveSourceSpec, _context: ResolveContext): Promise<ResolvedPluginSource> {
    const digest = normalizeSha256Digest(spec.sha256);
    return Promise.resolve({
      sourceType: 'remote-archive',
      requested: spec,
      immutableIdentity: digest,
      uri: spec.url,
      expectedIntegrity: digest,
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: {},
    });
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    const bytes = await fetchBytes(resolved.uri, context.limits, { offline: context.offline });
    const digest = sha256Digest(bytes);
    if (!resolved.expectedIntegrity || !digestsEqual(digest, resolved.expectedIntegrity)) {
      throw new PluginResolutionError(
        `Remote archive digest mismatch: expected ${resolved.expectedIntegrity}, got ${digest}`,
        ExitCodes.IntegrityMismatch,
        'The remote archive changed. Verify the publisher and update the pinned sha256 deliberately.',
      );
    }
    await extractVerifiedArchive(bytes, destination, context);
    return { resolved, rootDir: pluginRootOf(destination, resolved.pluginRoot) };
  }
}

/* -------------------------------- git ------------------------------- */

export class GitResolver implements PluginSourceResolver<GitSourceSpec> {
  readonly type = 'git' as const;
  protected readonly git: GitClient;

  constructor(git: GitClient = createGitClient()) {
    this.git = git;
  }

  canResolve(spec: PluginSourceSpec): spec is GitSourceSpec {
    return spec.type === 'git';
  }

  async resolve(spec: GitSourceSpec, context: ResolveContext): Promise<ResolvedPluginSource> {
    const commit = await resolveGitCommit(this.git, spec.url, spec, context);
    return {
      sourceType: 'git',
      requested: spec,
      immutableIdentity: commit,
      uri: spec.url,
      requestedRef: spec.ref ?? spec.commit ?? 'HEAD',
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: {},
    };
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    _context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    return cloneDetached(
      this.git,
      resolved.uri,
      resolved.immutableIdentity,
      destination,
      resolved.pluginRoot,
      resolved,
    );
  }
}

/* ------------------------------- github ----------------------------- */

export class GitHubResolver implements PluginSourceResolver<GithubSourceSpec> {
  readonly type = 'github' as const;
  private readonly git: GitClient;

  constructor(git: GitClient = createGitClient()) {
    this.git = git;
  }

  canResolve(spec: PluginSourceSpec): spec is GithubSourceSpec {
    return spec.type === 'github';
  }

  async resolve(spec: GithubSourceSpec, context: ResolveContext): Promise<ResolvedPluginSource> {
    const url = this.cloneUrl(spec, context);
    const commit = await resolveGitCommit(this.git, url, spec, context);
    return {
      sourceType: 'github',
      requested: spec,
      immutableIdentity: commit,
      uri: `https://${spec.host ?? 'github.com'}/${spec.repository}.git`,
      requestedRef: spec.ref ?? spec.commit ?? 'HEAD',
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: { repository: spec.repository },
    };
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    if (resolved.requested.type !== 'github') {
      throw new PluginResolutionError(
        `GitHubResolver cannot fetch source type "${resolved.requested.type}"`,
        ExitCodes.ResolutionFailure,
      );
    }
    const url = this.cloneUrl(resolved.requested, context);
    return cloneDetached(
      this.git,
      url,
      resolved.immutableIdentity,
      destination,
      resolved.pluginRoot,
      resolved,
    );
  }

  private cloneUrl(spec: GithubSourceSpec, context: ResolveContext): string {
    const host = spec.host ?? 'github.com';
    const token = context.credentials.gitToken(host);
    const auth = token ? `x-access-token:${token}@` : '';
    return `https://${auth}${host}/${spec.repository}.git`;
  }
}

/* -------------------------------- npm ------------------------------- */

interface NpmPackument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<
    string,
    { version: string; dist?: { tarball?: string; integrity?: string; shasum?: string } }
  >;
}

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export class NpmResolver implements PluginSourceResolver<NpmSourceSpec> {
  readonly type = 'npm' as const;

  canResolve(spec: PluginSourceSpec): spec is NpmSourceSpec {
    return spec.type === 'npm';
  }

  async resolve(spec: NpmSourceSpec, context: ResolveContext): Promise<ResolvedPluginSource> {
    const registry = (spec.registry ?? DEFAULT_REGISTRY).replace(/\/$/, '');
    const packumentUrl = `${registry}/${spec.package.replaceAll('/', '%2f')}`;
    const packument = (await fetchJson(packumentUrl, context.limits, {
      headers: this.headers(registry, context),
      offline: context.offline,
    })) as NpmPackument;

    const versions = Object.keys(packument.versions ?? {});
    const requested = spec.version ?? packument['dist-tags']?.latest;
    if (!requested) {
      throw new PluginResolutionError(
        `npm package "${spec.package}" has no latest dist-tag; pin a version`,
        ExitCodes.ResolutionFailure,
      );
    }
    const version = packument['dist-tags']?.[requested] ?? resolveVersionRange(requested, versions);
    const manifest = packument.versions?.[version];
    const tarball = manifest?.dist?.tarball;
    const integrity = manifest?.dist?.integrity;
    if (!manifest || !tarball) {
      throw new PluginResolutionError(
        `npm package "${spec.package}@${version}" has no tarball metadata`,
        ExitCodes.ResolutionFailure,
      );
    }
    if (!integrity) {
      throw new PluginResolutionError(
        `npm package "${spec.package}@${version}" is missing dist.integrity; refusing unverifiable source`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    return {
      sourceType: 'npm',
      requested: spec,
      immutableIdentity: `${spec.package}@${version}`,
      version,
      uri: tarball,
      expectedIntegrity: integrity,
      requestedRef: spec.version ?? 'latest',
      pluginRoot: spec.pluginRoot ?? '.',
      metadata: { registry },
    };
  }

  async fetch(
    resolved: ResolvedPluginSource,
    destination: string,
    context: ResolveContext,
  ): Promise<FetchedPluginSource> {
    if (!resolved.expectedIntegrity) {
      throw new PluginResolutionError(
        `npm source "${resolved.immutableIdentity}" is missing expected integrity`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    const registry = resolved.metadata.registry ?? DEFAULT_REGISTRY;
    const bytes = await fetchBytes(resolved.uri, context.limits, {
      headers: this.headers(registry, context),
      offline: context.offline,
    });
    verifySri(bytes, resolved.expectedIntegrity);

    // npm tarballs nest everything under "package/"; never run lifecycle scripts.
    await extractVerifiedArchive(bytes, destination, context, { stripComponents: 1 });
    return { resolved, rootDir: pluginRootOf(destination, resolved.pluginRoot) };
  }

  private headers(registry: string, context: ResolveContext): Record<string, string> {
    const token = context.credentials.npmToken(registry);
    return token ? { authorization: `Bearer ${token}` } : {};
  }
}

/** Verify a Subresource Integrity string (e.g. `sha512-<base64>`). */
export function verifySri(bytes: Uint8Array, integrity: string): void {
  const [algorithm, expected] = integrity.split('-', 2);
  if (!algorithm || !expected || !['sha512', 'sha384', 'sha256'].includes(algorithm)) {
    throw new PluginResolutionError(
      `Unsupported integrity string "${integrity}"`,
      ExitCodes.SecurityValidationFailure,
    );
  }
  const actual = createHash(algorithm).update(bytes).digest('base64');
  if (actual !== expected) {
    throw new PluginResolutionError(
      `npm tarball integrity mismatch (${algorithm}): expected ${expected}, got ${actual}`,
      ExitCodes.IntegrityMismatch,
      'The registry served different bytes than the lockfile expects. Investigate before updating.',
    );
  }
}

export function builtinResolvers(git: GitClient = createGitClient()): PluginSourceResolver[] {
  return [
    new LocalDirectoryResolver(),
    new LocalArchiveResolver(),
    new RemoteArchiveResolver(),
    new GitResolver(git),
    new GitHubResolver(git),
    new NpmResolver(),
  ];
}
