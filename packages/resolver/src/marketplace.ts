import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ExitCodes,
  PluginResolutionError,
  marketplaceManifestSchema,
  pluginSourceSpecSchema,
  type MarketplaceManifest,
  type PluginSourceSpec,
} from '@deepagents-plugins/schema';

import { assertInsideRoot } from './path-safety.js';

import type { ContentLimits } from './limits.js';

/**
 * Marketplace parsing (RFC section 13). A marketplace is a catalog, not a
 * trust authority: entries only yield source specs that are then resolved
 * and validated like any direct source.
 */

const MARKETPLACE_MANIFEST_PATHS = ['.claude-plugin/marketplace.json', 'marketplace.json'] as const;

export async function readMarketplaceManifest(
  rootDir: string,
  limits: ContentLimits,
): Promise<MarketplaceManifest> {
  for (const candidate of MARKETPLACE_MANIFEST_PATHS) {
    const filePath = path.join(rootDir, candidate);
    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    const parsed = marketplaceManifestSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      throw new PluginResolutionError(
        `Marketplace manifest "${candidate}" is invalid: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
        ExitCodes.ConfigurationError,
      );
    }
    if (parsed.data.plugins.length > limits.maxMarketplaceEntries) {
      throw new PluginResolutionError(
        `Marketplace lists more than ${limits.maxMarketplaceEntries} plugins`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    return parsed.data;
  }
  throw new PluginResolutionError(
    'No marketplace manifest found (.claude-plugin/marketplace.json)',
    ExitCodes.ResolutionFailure,
  );
}

/**
 * Convert an untrusted marketplace entry source to a typed source spec.
 * Marketplace-relative string sources (e.g. "./plugins/foo") resolve inside
 * the marketplace checkout itself.
 */
export function marketplaceEntryToSourceSpec(
  entrySource: unknown,
  marketplaceRootDir: string,
): PluginSourceSpec {
  if (typeof entrySource === 'string') {
    const absolute = path.resolve(marketplaceRootDir, entrySource);
    assertInsideRoot(marketplaceRootDir, absolute);
    return { type: 'local', path: absolute };
  }
  if (entrySource !== null && typeof entrySource === 'object') {
    const record = entrySource as Record<string, unknown>;
    const candidate =
      record.type === 'github' && typeof record.repo === 'string'
        ? { ...record, repository: record.repo }
        : record;
    const parsed = pluginSourceSpecSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  throw new PluginResolutionError(
    `Unsupported marketplace plugin source: ${JSON.stringify(entrySource)}`,
    ExitCodes.ResolutionFailure,
    'Declare the plugin with an explicit source in deepagents.plugins.yaml instead.',
  );
}
