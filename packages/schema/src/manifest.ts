import { z } from 'zod';

import { pluginSourceSpecSchema } from './source.js';

/** Project manifest `deepagents.plugins.yaml` (RFC section 9). */

export const API_VERSION = 'deepagents.plugins/v1';

export const marketplaceDeclarationSchema = z.object({
  name: z.string().min(1),
  source: pluginSourceSpecSchema,
});
export type MarketplaceDeclaration = z.infer<typeof marketplaceDeclarationSchema>;

export const pluginDeclarationSchema = z.object({
  id: z.string().min(1),
  source: pluginSourceSpecSchema.optional(),
  alias: z.string().optional(),
  policyProfile: z.string().optional(),
});
export type PluginDeclaration = z.infer<typeof pluginDeclarationSchema>;

export const collisionActionSchema = z.enum(['error', 'qualify']);

export const collisionPolicySchema = z.object({
  tools: collisionActionSchema.default('error'),
  skills: collisionActionSchema.default('qualify'),
  subagents: collisionActionSchema.default('qualify'),
  commands: collisionActionSchema.default('qualify'),
});
export type CollisionPolicy = z.infer<typeof collisionPolicySchema>;

export const outputConfigSchema = z.object({
  directory: z.string().default('.deepagents/plugins'),
  reproducible: z.boolean().default(true),
  includeSourceFiles: z.boolean().default(true),
  emitCompatibilityReport: z.boolean().default(true),
  emitSbom: z.boolean().default(false),
});

export const pluginSetManifestSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal('PluginSet'),
  metadata: z.object({
    name: z.string().min(1),
  }),
  marketplaces: z.array(marketplaceDeclarationSchema).default([]),
  plugins: z.array(pluginDeclarationSchema).min(1),
  collisionPolicy: collisionPolicySchema.default({
    tools: 'error',
    skills: 'qualify',
    subagents: 'qualify',
    commands: 'qualify',
  }),
  output: outputConfigSchema.default({
    directory: '.deepagents/plugins',
    reproducible: true,
    includeSourceFiles: true,
    emitCompatibilityReport: true,
    emitSbom: false,
  }),
});
export type PluginSetManifest = z.infer<typeof pluginSetManifestSchema>;
