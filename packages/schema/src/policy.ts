import { z } from 'zod';

/** Policy documents and approvals (RFC section 17, Appendix D). */

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
  apiVersion: z.literal('deepagents.plugins/v1'),
  kind: z.literal('PluginPolicy'),
  defaults: policyRulesSchema.default({}),
  profiles: z.record(z.string(), policyRulesSchema).default({}),
});
export type PluginPolicyDocument = z.infer<typeof pluginPolicyDocumentSchema>;

export const pluginApprovalSchema = z.object({
  apiVersion: z.literal('deepagents.plugins/v1'),
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
