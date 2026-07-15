import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ExitCodes,
  PluginResolutionError,
  claudePluginManifestSchema,
  normalizeName,
  parsePluginId,
  sha256Digest,
  sha256DigestOfJson,
  type ClaudePluginManifest,
  type LockedPlugin,
  type LockedSourceV1,
  type Lockfile,
  type MarketplaceManifest,
  type PluginSetManifest,
  type PluginSourceSpec,
} from '@deepagents-plugins/schema';

import { digestDirectory } from './directory-digest.js';
import { marketplaceEntryToSourceSpec, readMarketplaceManifest } from './marketplace.js';

import type { PluginSourceResolver, ResolveContext, ResolvedPluginSource } from './context.js';

export const RESOLVER_VERSION = '0.1.0';

export interface ResolvedPluginArtifact {
  locked: LockedPlugin;
  rootDir: string;
  manifest: ClaudePluginManifest;
  runtimeNamespace: string;
  requested: PluginSourceSpec;
}

export interface ResolvePluginSetResult {
  lockfile: Lockfile;
  artifacts: ResolvedPluginArtifact[];
}

function findResolver(
  resolvers: PluginSourceResolver[],
  spec: PluginSourceSpec,
): PluginSourceResolver {
  const resolver = resolvers.find((candidate) => candidate.canResolve(spec));
  if (!resolver) {
    throw new PluginResolutionError(
      `No resolver registered for source type "${spec.type}"`,
      ExitCodes.ConfigurationError,
    );
  }
  return resolver;
}

function toLockedSource(resolved: ResolvedPluginSource): LockedSourceV1 {
  return {
    type: resolved.sourceType,
    uri: resolved.uri,
    requestedRef: resolved.requestedRef,
    resolvedCommit: /^[0-9a-f]{40}$/.test(resolved.immutableIdentity)
      ? resolved.immutableIdentity
      : undefined,
    version: resolved.version,
    integrity: resolved.expectedIntegrity,
    pluginRoot: resolved.pluginRoot,
  };
}

async function readPluginManifest(rootDir: string): Promise<ClaudePluginManifest> {
  const manifestPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
  let text: string;
  try {
    text = await fs.readFile(manifestPath, 'utf8');
  } catch {
    throw new PluginResolutionError(
      `Plugin manifest not found at ${manifestPath}`,
      ExitCodes.ResolutionFailure,
      'Every Claude Code plugin must contain .claude-plugin/plugin.json.',
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PluginResolutionError(
      `Plugin manifest ${manifestPath} is not valid JSON`,
      ExitCodes.ResolutionFailure,
    );
  }
  const parsed = claudePluginManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new PluginResolutionError(
      `Plugin manifest ${manifestPath} is invalid: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
      ExitCodes.ResolutionFailure,
    );
  }
  return parsed.data;
}

/**
 * Full resolution pipeline (RFC section 11): discover marketplace entries,
 * pin sources, fetch into isolated directories, digest, and produce the
 * lockfile plus on-disk artifacts for compilation.
 */
export async function resolvePluginSet(
  manifest: PluginSetManifest,
  resolvers: PluginSourceResolver[],
  context: ResolveContext,
  options: { defaultPolicyProfile?: string } = {},
): Promise<ResolvePluginSetResult> {
  const lockfile: Lockfile = {
    lockfileVersion: 1,
    resolverVersion: RESOLVER_VERSION,
    pluginSetDigest: sha256DigestOfJson(manifest),
    marketplaces: [],
    plugins: [],
  };
  const artifacts: ResolvedPluginArtifact[] = [];
  const marketplaceRoots = new Map<string, string>();
  const marketplaceCatalogs = new Map<string, MarketplaceManifest>();

  for (const marketplace of manifest.marketplaces) {
    const resolver = findResolver(resolvers, marketplace.source);
    const resolved = await resolver.resolve(marketplace.source, context);
    const destination = path.join(context.workDir, 'marketplaces', normalizeName(marketplace.name));
    await fs.rm(destination, { recursive: true, force: true });
    const fetched = await resolver.fetch(resolved, destination, context);
    const digest = await digestDirectory(fetched.rootDir, context.limits);
    marketplaceRoots.set(marketplace.name, fetched.rootDir);
    marketplaceCatalogs.set(
      marketplace.name,
      await readMarketplaceManifest(fetched.rootDir, context.limits),
    );
    lockfile.marketplaces.push({
      name: marketplace.name,
      source: toLockedSource(resolved),
      contentDigest: digest.contentDigest,
    });
  }

  const seenNamespaces = new Map<string, string>();

  for (const declaration of manifest.plugins) {
    const { pluginName, marketplaceName } = parsePluginId(declaration.id);
    let sourceSpec = declaration.source;

    if (!sourceSpec) {
      const marketplaceRoot = marketplaceRoots.get(marketplaceName);
      const catalog = marketplaceCatalogs.get(marketplaceName);
      if (!marketplaceRoot || !catalog) {
        throw new PluginResolutionError(
          `Plugin "${declaration.id}" has no explicit source and marketplace "${marketplaceName}" is not declared`,
          ExitCodes.ConfigurationError,
          'Add the marketplace under "marketplaces:", or give the plugin an explicit "source:".',
        );
      }
      const entry = catalog.plugins.find((candidate) => candidate.name === pluginName);
      if (!entry) {
        throw new PluginResolutionError(
          `Plugin "${pluginName}" not found in marketplace "${marketplaceName}"`,
          ExitCodes.ResolutionFailure,
        );
      }
      sourceSpec = marketplaceEntryToSourceSpec(entry.source, marketplaceRoot);
    }

    const resolver = findResolver(resolvers, sourceSpec);
    const resolved = await resolver.resolve(sourceSpec, context);
    const destination = path.join(context.workDir, 'plugins', normalizeName(declaration.id));
    await fs.rm(destination, { recursive: true, force: true });
    const fetched = await resolver.fetch(resolved, destination, context);

    const pluginManifest = await readPluginManifest(fetched.rootDir);
    const digest = await digestDirectory(fetched.rootDir, context.limits);
    const manifestDigest = sha256Digest(
      await fs.readFile(path.join(fetched.rootDir, '.claude-plugin', 'plugin.json')),
    );

    const runtimeNamespace = normalizeName(declaration.alias ?? pluginManifest.name);
    const existing = seenNamespaces.get(runtimeNamespace);
    if (existing) {
      throw new PluginResolutionError(
        `Plugin namespace collision: "${declaration.id}" and "${existing}" both map to "${runtimeNamespace}"`,
        ExitCodes.ConfigurationError,
        'Configure an explicit "alias:" for one of the plugins.',
      );
    }
    seenNamespaces.set(runtimeNamespace, declaration.id);

    const locked: LockedPlugin = {
      id: declaration.id,
      alias: declaration.alias,
      version: pluginManifest.version ?? resolved.version,
      policyProfile:
        declaration.policyProfile ?? options.defaultPolicyProfile ?? 'third-party-restricted',
      source: toLockedSource(resolved),
      pluginRoot: resolved.pluginRoot ?? '.',
      contentDigest: digest.contentDigest,
      manifestDigest,
      files: digest.files,
    };
    lockfile.plugins.push(locked);
    artifacts.push({
      locked,
      rootDir: fetched.rootDir,
      manifest: pluginManifest,
      runtimeNamespace,
      requested: sourceSpec,
    });
  }

  lockfile.marketplaces.sort((a, b) => a.name.localeCompare(b.name));
  lockfile.plugins.sort((a, b) => a.id.localeCompare(b.id));
  artifacts.sort((a, b) => a.locked.id.localeCompare(b.locked.id));
  return { lockfile, artifacts };
}
