import { z } from 'zod';

import { pluginSourceSpecSchema } from './source.js';

/** Project manifest `deepagents.plugins.yaml` (RFC v2 section 8). */

export const API_VERSION = 'deepagents.plugins/v2';

export const marketplaceDeclarationSchema = z.object({
  name: z.string().min(1),
  source: pluginSourceSpecSchema,
});
export type MarketplaceDeclaration = z.infer<typeof marketplaceDeclarationSchema>;

const featureToggleSchema = z.enum(['enabled', 'disabled', 'review']);
export type FeatureToggle = z.infer<typeof featureToggleSchema>;

/** Per-plugin feature toggles (RFC section 8). Values narrow per feature. */
export const pluginFeaturesSchema = z.object({
  skills: featureToggleSchema.optional(),
  commands: featureToggleSchema.optional(),
  syncSubagents: featureToggleSchema.optional(),
  asyncSubagents: featureToggleSchema.optional(),
  mcp: featureToggleSchema.optional(),
  hooks: featureToggleSchema.optional(),
  profiles: featureToggleSchema.optional(),
  memory: z.enum(['enabled', 'disabled', 'review', 'static-only']).optional(),
  interpreter: featureToggleSchema.optional(),
  rubrics: z.enum(['enabled', 'disabled', 'review', 'templates-only']).optional(),
});
export type PluginFeatures = z.infer<typeof pluginFeaturesSchema>;

export const pluginDeclarationSchema = z.object({
  id: z.string().min(1),
  source: pluginSourceSpecSchema.optional(),
  alias: z.string().optional(),
  trustPolicy: z.string().optional(),
  features: pluginFeaturesSchema.optional(),
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

export const compatibilityModeSchema = z.enum(['strict', 'standard', 'permissive']);
export type CompatibilityModeSetting = z.infer<typeof compatibilityModeSchema>;

const featurePolicyEffectSchema = z.enum(['explicit', 'allow', 'deny']);

/** Runtime integration settings (RFC section 8, `runtime:` block). */
export const runtimeConfigSchema = z.object({
  compatibilityMode: compatibilityModeSchema.default('standard'),
  deepAgents: z
    .object({
      requiredVersion: z.string().optional(),
      featurePolicy: z
        .object({
          beta: featurePolicyEffectSchema.default('explicit'),
          preview: featurePolicyEffectSchema.default('explicit'),
        })
        .default({ beta: 'explicit', preview: 'explicit' }),
    })
    .default({ featurePolicy: { beta: 'explicit', preview: 'explicit' } }),
  context: z
    .object({
      maxPluginPromptChars: z.number().int().positive().default(30_000),
      maxLoadedMemoryChars: z.number().int().positive().default(20_000),
      collisionPolicy: collisionActionSchema.default('qualify'),
    })
    .default({ maxPluginPromptChars: 30_000, maxLoadedMemoryChars: 20_000, collisionPolicy: 'qualify' }),
  interpreter: z
    .object({
      enabled: z.boolean().default(false),
      ptcDefault: z.enum(['allow', 'deny']).default('deny'),
    })
    .default({ enabled: false, ptcDefault: 'deny' }),
  asyncSubagents: z
    .object({
      allowedHosts: z.array(z.string()).default([]),
    })
    .default({ allowedHosts: [] }),
  streaming: z
    .object({
      attachPluginProvenance: z.boolean().default(true),
      redactToolArguments: z.boolean().default(true),
    })
    .default({ attachPluginProvenance: true, redactToolArguments: true }),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  compatibilityMode: 'standard',
  deepAgents: { featurePolicy: { beta: 'explicit', preview: 'explicit' } },
  context: { maxPluginPromptChars: 30_000, maxLoadedMemoryChars: 20_000, collisionPolicy: 'qualify' },
  interpreter: { enabled: false, ptcDefault: 'deny' },
  asyncSubagents: { allowedHosts: [] },
  streaming: { attachPluginProvenance: true, redactToolArguments: true },
};

export const outputConfigSchema = z.object({
  directory: z.string().default('.deepagents/plugins'),
  reproducible: z.boolean().default(true),
  includeSourceFiles: z.boolean().default(true),
  emitCompatibilityReport: z.boolean().default(true),
  emitSbom: z.boolean().default(false),
  emitSarif: z.boolean().default(false),
  emitConformanceTests: z.boolean().default(false),
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
  runtime: runtimeConfigSchema.default(DEFAULT_RUNTIME_CONFIG),
  output: outputConfigSchema.default({
    directory: '.deepagents/plugins',
    reproducible: true,
    includeSourceFiles: true,
    emitCompatibilityReport: true,
    emitSbom: false,
    emitSarif: false,
    emitConformanceTests: false,
  }),
});
export type PluginSetManifest = z.infer<typeof pluginSetManifestSchema>;
