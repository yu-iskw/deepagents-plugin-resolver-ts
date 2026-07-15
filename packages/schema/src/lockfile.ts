import { z } from 'zod';

import { lockedSourceSchema } from './source.js';

/** Lockfile v1 (RFC section 10). */

export const LOCKFILE_VERSION = 1;
export const LOCKFILE_NAME = 'deepagents.plugins.lock.json';

export const lockedMarketplaceSchema = z.object({
  name: z.string(),
  source: lockedSourceSchema,
  contentDigest: z.string(),
});
export type LockedMarketplace = z.infer<typeof lockedMarketplaceSchema>;

export const lockedPluginSchema = z.object({
  id: z.string(),
  alias: z.string().optional(),
  version: z.string().optional(),
  policyProfile: z.string(),
  source: lockedSourceSchema,
  pluginRoot: z.string(),
  contentDigest: z.string(),
  manifestDigest: z.string(),
  files: z.record(z.string(), z.string()),
});
export type LockedPlugin = z.infer<typeof lockedPluginSchema>;

export const lockfileSchema = z.object({
  lockfileVersion: z.literal(LOCKFILE_VERSION),
  resolverVersion: z.string(),
  pluginSetDigest: z.string(),
  marketplaces: z.array(lockedMarketplaceSchema),
  plugins: z.array(lockedPluginSchema),
});
export type Lockfile = z.infer<typeof lockfileSchema>;
