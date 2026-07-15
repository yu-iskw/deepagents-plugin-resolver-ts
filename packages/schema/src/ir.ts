import { z } from 'zod';

import { compatibilityDiagnosticSchema, compatibilityLevelSchema } from './diagnostics.js';
import { lockedSourceSchema } from './source.js';

/** Portable intermediate representation v2 (RFC v2 section 10). */

export const IR_SCHEMA_VERSION = '2.0';

const pluginCompatibilitySchema = z.enum(['native', 'translated', 'partial', 'unsupported']);

export const compilerIdentitySchema = z.object({
  name: z.string(),
  version: z.string(),
  compilerProfile: z.string(),
});
export type CompilerIdentityV2 = z.infer<typeof compilerIdentitySchema>;

export const compiledPluginSchema = z.object({
  id: z.string(),
  runtimeNamespace: z.string(),
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  source: lockedSourceSchema,
  contentDigest: z.string(),
  trustPolicy: z.string(),
  capabilities: z.array(z.string()),
  compatibility: pluginCompatibilitySchema,
});
export type CompiledPluginV2 = z.infer<typeof compiledPluginSchema>;

export const contextBudgetSchema = z.object({
  metadataChars: z.number().int().nonnegative(),
  bodyChars: z.number().int().nonnegative(),
});

export const compiledSkillSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  originalName: z.string(),
  runtimeName: z.string(),
  description: z.string(),
  directory: z.string(),
  skillFile: z.string(),
  allowedTools: z.array(z.string()).optional(),
  requiredPermissions: z.array(z.string()).optional(),
  contextBudget: contextBudgetSchema.optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledSkillV2 = z.infer<typeof compiledSkillSchema>;

export const compiledCommandSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  promptTemplate: z.string(),
  argumentHint: z.string().optional(),
  usesArguments: z.boolean(),
  argumentsSchema: z.record(z.string(), z.unknown()).optional(),
  requiredSkills: z.array(z.string()).optional(),
  defaultRubricRef: z.string().optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledCommandV2 = z.infer<typeof compiledCommandSchema>;

export const modelSelectorSchema = z.object({
  requested: z.string(),
  advisory: z.literal(true),
});
export type ModelSelectorV2 = z.infer<typeof modelSelectorSchema>;

export const compiledSyncSubagentSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  modelRef: modelSelectorSchema.optional(),
  toolRefs: z.array(z.string()),
  skillRefs: z.array(z.string()),
  memoryRefs: z.array(z.string()),
  middlewareAdapterRefs: z.array(z.string()),
  interruptPolicyRef: z.string().optional(),
  responseSchema: z.record(z.string(), z.unknown()).optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledSyncSubagentV2 = z.infer<typeof compiledSyncSubagentSchema>;

export const compiledAsyncSubagentSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string(),
  graphId: z.string(),
  transport: z.enum(['co-deployed', 'http']),
  endpointRef: z.string().optional(),
  authProfile: z.string().optional(),
  allowedOperations: z.array(z.enum(['launch', 'status', 'update', 'cancel'])),
  dataClassification: z.string().optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledAsyncSubagentV2 = z.infer<typeof compiledAsyncSubagentSchema>;

export const compiledMemorySourceSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  path: z.string(),
  kind: z.enum([
    'static-instructions',
    'procedural',
    'episodic-template',
    'organization-template',
  ]),
  loadMode: z.enum(['startup', 'on-demand']),
  scope: z.enum(['agent', 'user', 'tenant', 'organization']),
  access: z.enum(['read-only', 'read-write']),
  writableLocationRef: z.string().optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledMemorySourceV2 = z.infer<typeof compiledMemorySourceSchema>;

export const compiledHarnessProfileSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  registrationKey: z.string(),
  priority: z.number().int(),
  config: z.object({
    baseSystemPrompt: z.string().optional(),
    systemPromptSuffix: z.string().optional(),
    toolDescriptionOverrides: z.record(z.string(), z.string()).optional(),
    excludedTools: z.array(z.string()).optional(),
    excludedMiddleware: z.array(z.string()).optional(),
    generalPurposeSubagent: z
      .object({
        enabled: z.boolean().optional(),
        description: z.string().optional(),
        systemPrompt: z.string().optional(),
      })
      .optional(),
  }),
  compatibility: compatibilityLevelSchema,
});
export type CompiledHarnessProfileV2 = z.infer<typeof compiledHarnessProfileSchema>;

export const compiledHitlRecommendationSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  toolRef: z.string(),
  risk: z.enum(['low', 'medium', 'high', 'critical']),
  recommendedDecisions: z.array(z.enum(['approve', 'edit', 'reject', 'respond'])),
  conditionRef: z.string().optional(),
});
export type CompiledHitlRecommendationV2 = z.infer<typeof compiledHitlRecommendationSchema>;

export const compiledPermissionSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  toolRef: z.string(),
  permission: z.string(),
  rationale: z.string().optional(),
});
export type CompiledPermissionV2 = z.infer<typeof compiledPermissionSchema>;

export const compiledInterpreterPolicySchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  enabled: z.boolean(),
  persistence: z.enum(['thread', 'turn', 'call']),
  memoryLimitBytes: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  maxResultChars: z.number().int().positive(),
  ptcTools: z.array(z.string()),
  dynamicSubagents: z.array(z.string()),
  compatibility: compatibilityLevelSchema,
});
export type CompiledInterpreterPolicyV2 = z.infer<typeof compiledInterpreterPolicySchema>;

export const compiledRubricTemplateSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  criteria: z.array(z.string()).min(1),
  recommendedGraderModel: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  dataPolicy: z
    .object({
      allowExternalGrader: z.boolean(),
    })
    .optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledRubricTemplateV2 = z.infer<typeof compiledRubricTemplateSchema>;

export const compiledStreamMetadataSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  componentId: z.string(),
  namespace: z.array(z.string()),
  provenanceTags: z.record(z.string(), z.string()),
  redactionFields: z.array(z.string()).optional(),
});
export type CompiledStreamMetadataV2 = z.infer<typeof compiledStreamMetadataSchema>;

export const compiledMcpServerSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  transport: z.enum(['streamable-http', 'sse', 'stdio']),
  endpoint: z.string().optional(),
  commandAssetId: z.string().optional(),
  args: z.array(z.string()).optional(),
  environmentRefs: z.array(z.string()).optional(),
  headerRefs: z.record(z.string(), z.string()).optional(),
  toolAllowlist: z.array(z.string()).optional(),
  authProfile: z.string().optional(),
  startupPolicy: z.enum(['eager', 'lazy']).optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledMcpServerV2 = z.infer<typeof compiledMcpServerSchema>;

export const portableHookEventSchema = z.enum([
  'beforeAgentInvoke',
  'afterAgentInvoke',
  'beforeToolCall',
  'afterToolCall',
  'onToolError',
  'beforeSubagentInvoke',
  'afterSubagentInvoke',
  'onInterrupt',
  'onRubricEvaluation',
]);
export type PortableHookEventV2 = z.infer<typeof portableHookEventSchema>;

export const compiledHookActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('middleware'),
    adapter: z.string(),
    config: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('webhook'),
    endpointRef: z.string(),
    payloadTemplate: z.string().optional(),
  }),
  z.object({
    type: z.literal('command'),
    executableAssetId: z.string(),
    args: z.array(z.string()),
    sandboxProfile: z.string(),
  }),
  z.object({
    type: z.literal('unsupported'),
    reason: z.string(),
  }),
]);
export type CompiledHookActionV2 = z.infer<typeof compiledHookActionSchema>;

export const compiledHookSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  event: portableHookEventSchema,
  matcher: z.string().optional(),
  action: compiledHookActionSchema,
  originalEvent: z.string(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledHookV2 = z.infer<typeof compiledHookSchema>;

export const compiledExecutableAssetSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  relativePath: z.string(),
  sha256: z.string(),
  platform: z
    .object({
      os: z.array(z.string()).optional(),
      arch: z.array(z.string()).optional(),
    })
    .optional(),
  allowedArguments: z.array(z.string()).optional(),
  sandboxProfile: z.string(),
});
export type CompiledExecutableAssetV2 = z.infer<typeof compiledExecutableAssetSchema>;

export const compiledAssetSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  relativePath: z.string(),
  sha256: z.string(),
});
export type CompiledAssetV2 = z.infer<typeof compiledAssetSchema>;

export const provenanceRecordSchema = z.object({
  pluginId: z.string(),
  sourceType: z.string(),
  sourceIdentity: z.string(),
  contentDigest: z.string(),
  resolverVersion: z.string(),
  trustPolicy: z.string(),
});
export type ProvenanceRecordV2 = z.infer<typeof provenanceRecordSchema>;

export const compiledPluginSetSchema = z.object({
  schemaVersion: z.literal(IR_SCHEMA_VERSION),
  compiler: compilerIdentitySchema,
  pluginSetDigest: z.string(),
  plugins: z.array(compiledPluginSchema),
  skills: z.array(compiledSkillSchema),
  memorySources: z.array(compiledMemorySourceSchema),
  commands: z.array(compiledCommandSchema),
  syncSubagents: z.array(compiledSyncSubagentSchema),
  asyncSubagents: z.array(compiledAsyncSubagentSchema),
  mcpServers: z.array(compiledMcpServerSchema),
  hooks: z.array(compiledHookSchema),
  harnessProfiles: z.array(compiledHarnessProfileSchema),
  hitlPolicies: z.array(compiledHitlRecommendationSchema),
  permissions: z.array(compiledPermissionSchema),
  interpreterPolicies: z.array(compiledInterpreterPolicySchema),
  rubricTemplates: z.array(compiledRubricTemplateSchema),
  streamMetadata: z.array(compiledStreamMetadataSchema),
  assets: z.array(compiledAssetSchema),
  executableAssets: z.array(compiledExecutableAssetSchema),
  diagnostics: z.array(compatibilityDiagnosticSchema),
  provenance: z.array(provenanceRecordSchema),
});
export type CompiledPluginSetV2 = z.infer<typeof compiledPluginSetSchema>;
