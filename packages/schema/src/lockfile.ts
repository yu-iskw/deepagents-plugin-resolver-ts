import { z } from 'zod';

import { lockedSourceSchema } from './source.js';

/** Lockfile v2 (RFC v2 section 9). */

export const LOCKFILE_VERSION = 2;
export const LOCKFILE_NAME = 'deepagents.plugins.lock.json';

/** Claude plugin input profile the compiler targets (RFC section 33). */
export const COMPILER_PROFILE = 'claude-plugin-v2026-07';

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
  trustPolicy: z.string(),
  source: lockedSourceSchema,
  pluginRoot: z.string(),
  contentDigest: z.string(),
  manifestDigest: z.string(),
  detectedCapabilities: z.array(z.string()),
  compilerProfile: z.string(),
  approvalDigest: z.string().optional(),
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
