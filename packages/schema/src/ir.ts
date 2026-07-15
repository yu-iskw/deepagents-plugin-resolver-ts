import { z } from 'zod';

import { compatibilityDiagnosticSchema, compatibilityLevelSchema } from './diagnostics.js';
import { lockedSourceSchema } from './source.js';

/** Portable intermediate representation v1 (RFC sections 15 and 16). */

export const IR_SCHEMA_VERSION = '1.0';

const pluginCompatibilitySchema = z.enum(['native', 'translated', 'partial', 'unsupported']);

export const compiledPluginSchema = z.object({
  id: z.string(),
  runtimeNamespace: z.string(),
  name: z.string(),
  version: z.string().optional(),
  description: z.string().optional(),
  license: z.string().optional(),
  source: lockedSourceSchema,
  contentDigest: z.string(),
  policyProfile: z.string(),
  capabilities: z.array(z.string()),
  compatibility: pluginCompatibilitySchema,
});
export type CompiledPluginV1 = z.infer<typeof compiledPluginSchema>;

export const compiledSkillSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  originalName: z.string(),
  runtimeName: z.string(),
  description: z.string(),
  directory: z.string(),
  skillFile: z.string(),
  allowedTools: z.array(z.string()).optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledSkillV1 = z.infer<typeof compiledSkillSchema>;

export const compiledCommandSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  promptTemplate: z.string(),
  argumentHint: z.string().optional(),
  usesArguments: z.boolean(),
  requiredSkills: z.array(z.string()).optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledCommandV1 = z.infer<typeof compiledCommandSchema>;

export const modelSelectorSchema = z.object({
  requested: z.string(),
  advisory: z.literal(true),
});
export type ModelSelectorV1 = z.infer<typeof modelSelectorSchema>;

export const compiledSubagentSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  model: modelSelectorSchema.optional(),
  allowedTools: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  middlewareIds: z.array(z.string()).optional(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledSubagentV1 = z.infer<typeof compiledSubagentSchema>;

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
export type CompiledMcpServerV1 = z.infer<typeof compiledMcpServerSchema>;

export const portableHookEventSchema = z.enum([
  'beforeAgentInvoke',
  'afterAgentInvoke',
  'beforeToolCall',
  'afterToolCall',
  'onToolError',
  'beforeSubagentInvoke',
  'afterSubagentInvoke',
]);
export type PortableHookEventV1 = z.infer<typeof portableHookEventSchema>;

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
export type CompiledHookActionV1 = z.infer<typeof compiledHookActionSchema>;

export const compiledHookSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  event: portableHookEventSchema,
  matcher: z.string().optional(),
  action: compiledHookActionSchema,
  originalEvent: z.string(),
  compatibility: compatibilityLevelSchema,
});
export type CompiledHookV1 = z.infer<typeof compiledHookSchema>;

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
export type CompiledExecutableAssetV1 = z.infer<typeof compiledExecutableAssetSchema>;

export const compiledAssetSchema = z.object({
  id: z.string(),
  pluginId: z.string(),
  relativePath: z.string(),
  sha256: z.string(),
});
export type CompiledAssetV1 = z.infer<typeof compiledAssetSchema>;

export const provenanceRecordSchema = z.object({
  pluginId: z.string(),
  sourceType: z.string(),
  sourceIdentity: z.string(),
  contentDigest: z.string(),
  resolverVersion: z.string(),
  policyProfile: z.string(),
});
export type ProvenanceRecordV1 = z.infer<typeof provenanceRecordSchema>;

export const compiledPluginSetSchema = z.object({
  schemaVersion: z.literal(IR_SCHEMA_VERSION),
  generatedBy: z.object({
    name: z.string(),
    version: z.string(),
  }),
  pluginSetDigest: z.string(),
  plugins: z.array(compiledPluginSchema),
  skills: z.array(compiledSkillSchema),
  commands: z.array(compiledCommandSchema),
  subagents: z.array(compiledSubagentSchema),
  mcpServers: z.array(compiledMcpServerSchema),
  hooks: z.array(compiledHookSchema),
  assets: z.array(compiledAssetSchema),
  executableAssets: z.array(compiledExecutableAssetSchema),
  diagnostics: z.array(compatibilityDiagnosticSchema),
  provenance: z.array(provenanceRecordSchema),
});
export type CompiledPluginSetV1 = z.infer<typeof compiledPluginSetSchema>;
