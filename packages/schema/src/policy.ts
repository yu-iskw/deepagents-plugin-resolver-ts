import { z } from 'zod';

/** Policy documents and approvals (RFC v2 sections 8, 14, 25, Appendix A). */

export const policyEffectSchema = z.enum(['allow', 'review', 'deny']);
export type PolicyEffect = z.infer<typeof policyEffectSchema>;

export const mcpPolicySchema = z.object({
  remoteHttp: policyEffectSchema.optional(),
  stdio: policyEffectSchema.optional(),
});

export const hooksPolicySchema = z.object({
  middleware: policyEffectSchema.optional(),
  webhook: policyEffectSchema.optional(),
  command: policyEffectSchema.optional(),
});

export const memoryPolicySchema = z.object({
  static: policyEffectSchema.optional(),
  writable: policyEffectSchema.optional(),
});

/** Harness-profile field governance (RFC section 14 table). */
export const profilesPolicySchema = z.object({
  fragment: policyEffectSchema.optional(),
  basePromptReplacement: policyEffectSchema.optional(),
  promptSuffix: policyEffectSchema.optional(),
  overridePluginToolDescription: policyEffectSchema.optional(),
  overrideApplicationToolDescription: policyEffectSchema.optional(),
  excludePluginTool: policyEffectSchema.optional(),
  excludeApplicationTool: policyEffectSchema.optional(),
  excludeMiddleware: policyEffectSchema.optional(),
  addMiddleware: policyEffectSchema.optional(),
  generalPurposeSubagent: policyEffectSchema.optional(),
});
export type ProfilesPolicy = z.infer<typeof profilesPolicySchema>;

export const sourceTrustSchema = z.object({
  npmScopes: z.array(z.string()).optional(),
  githubOwners: z.array(z.string()).optional(),
  marketplaceOwners: z.array(z.string()).optional(),
  allowRemoteArchives: z.boolean().optional(),
  allowLocal: z.boolean().optional(),
});
export type SourceTrust = z.infer<typeof sourceTrustSchema>;

export const policyRulesSchema = z.object({
  sourceTrust: z.enum(['trusted', 'untrusted']).optional(),
  source: sourceTrustSchema.optional(),
  skills: policyEffectSchema.optional(),
  commands: policyEffectSchema.optional(),
  subagents: policyEffectSchema.optional(),
  asyncSubagents: policyEffectSchema.optional(),
  memory: memoryPolicySchema.optional(),
  profiles: profilesPolicySchema.optional(),
  interpreter: policyEffectSchema.optional(),
  ptc: policyEffectSchema.optional(),
  rubrics: policyEffectSchema.optional(),
  hitl: policyEffectSchema.optional(),
  mcp: mcpPolicySchema.optional(),
  hooks: hooksPolicySchema.optional(),
  lsp: policyEffectSchema.optional(),
  monitors: policyEffectSchema.optional(),
  binaries: policyEffectSchema.optional(),
  settings: policyEffectSchema.optional(),
  unknownComponents: policyEffectSchema.optional(),
});
export type PolicyRules = z.infer<typeof policyRulesSchema>;

export const pluginPolicyDocumentSchema = z.object({
  apiVersion: z.literal('deepagents.plugins/v2'),
  kind: z.literal('PluginPolicy'),
  defaults: policyRulesSchema.default({}),
  profiles: z.record(z.string(), policyRulesSchema).default({}),
});
export type PluginPolicyDocument = z.infer<typeof pluginPolicyDocumentSchema>;

export const pluginApprovalSchema = z.object({
  apiVersion: z.literal('deepagents.plugins/v2'),
  kind: z.literal('PluginApproval'),
  pluginDigest: z.string(),
  approvedCapabilities: z.array(z.string()).min(1),
  approvedBy: z.string(),
  expiresAt: z.string().optional(),
});
export type PluginApproval = z.infer<typeof pluginApprovalSchema>;

export const policyDecisionSchema = z.object({
  effect: policyEffectSchema,
  ruleId: z.string(),
  reason: z.string(),
  remediation: z.string().optional(),
});
export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

/** Capability identifiers evaluated against policy. */
export const PluginCapabilities = {
  Skills: 'skills',
  Commands: 'commands',
  Subagents: 'subagents',
  AsyncSubagents: 'asyncSubagents',
  MemoryStatic: 'memory.static',
  MemoryWritable: 'memory.writable',
  HarnessProfiles: 'profiles.fragment',
  Interpreter: 'interpreter',
  Ptc: 'ptc',
  Rubrics: 'rubrics',
  Hitl: 'hitl',
  McpRemoteHttp: 'mcp.remoteHttp',
  McpStdio: 'mcp.stdio',
  HookMiddleware: 'hooks.middleware',
  HookWebhook: 'hooks.webhook',
  HookCommand: 'hooks.command',
  Lsp: 'lsp',
  Monitors: 'monitors',
  Binaries: 'binaries',
  Settings: 'settings',
  UnknownComponent: 'unknownComponents',
} as const;
export type PluginCapability = (typeof PluginCapabilities)[keyof typeof PluginCapabilities];

/** Harness-profile governance fields (RFC section 14). */
export const ProfileFields = {
  BasePromptReplacement: 'basePromptReplacement',
  PromptSuffix: 'promptSuffix',
  OverridePluginToolDescription: 'overridePluginToolDescription',
  OverrideApplicationToolDescription: 'overrideApplicationToolDescription',
  ExcludePluginTool: 'excludePluginTool',
  ExcludeApplicationTool: 'excludeApplicationTool',
  ExcludeMiddleware: 'excludeMiddleware',
  AddMiddleware: 'addMiddleware',
  GeneralPurposeSubagent: 'generalPurposeSubagent',
} as const;
export type ProfileField = (typeof ProfileFields)[keyof typeof ProfileFields];
