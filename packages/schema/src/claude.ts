import { z } from 'zod';

/**
 * Schemas for upstream Claude Code plugin and marketplace formats.
 * These describe *untrusted input*: parse strictly, never execute.
 */

export const claudePluginManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().optional(),
    description: z.string().optional(),
    author: z.union([z.string(), z.object({ name: z.string().optional() }).loose()]).optional(),
    homepage: z.string().optional(),
    repository: z.union([z.string(), z.object({}).loose()]).optional(),
    license: z.string().optional(),
    keywords: z.array(z.string()).optional(),
  })
  .loose();
export type ClaudePluginManifest = z.infer<typeof claudePluginManifestSchema>;

export const marketplacePluginEntrySchema = z
  .object({
    name: z.string().min(1),
    source: z.unknown(),
    description: z.string().optional(),
    version: z.string().optional(),
    author: z.union([z.string(), z.object({}).loose()]).optional(),
    category: z.string().optional(),
  })
  .loose();
export type MarketplacePluginEntry = z.infer<typeof marketplacePluginEntrySchema>;

export const marketplaceManifestSchema = z
  .object({
    name: z.string().min(1),
    owner: z.union([z.string(), z.object({ name: z.string().optional() }).loose()]).optional(),
    metadata: z.object({}).loose().optional(),
    plugins: z.array(marketplacePluginEntrySchema),
  })
  .loose();
export type MarketplaceManifest = z.infer<typeof marketplaceManifestSchema>;

export const skillFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().min(1),
    license: z.string().optional(),
    'allowed-tools': z.union([z.string(), z.array(z.string())]).optional(),
    permissions: z.union([z.string(), z.array(z.string())]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export const agentFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().min(1),
    tools: z.union([z.string(), z.array(z.string())]).optional(),
    model: z.string().optional(),
    memory: z.union([z.string(), z.array(z.string())]).optional(),
    async: z.boolean().optional(),
    endpoint: z.string().optional(),
  })
  .loose();
export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

export const memoryFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    kind: z
      .enum(['static-instructions', 'procedural', 'episodic-template', 'organization-template'])
      .optional(),
    loadMode: z.enum(['startup', 'on-demand']).optional(),
    scope: z.enum(['agent', 'user', 'tenant', 'organization']).optional(),
    access: z.enum(['read-only', 'read-write']).optional(),
  })
  .loose();
export type MemoryFrontmatter = z.infer<typeof memoryFrontmatterSchema>;

/** Plugin-shipped harness profile fragment `profiles/*.json` (untrusted). */
export const claudeProfileFileSchema = z
  .object({
    registrationKey: z.string().optional(),
    priority: z.number().int().optional(),
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
  })
  .loose();
export type ClaudeProfileFile = z.infer<typeof claudeProfileFileSchema>;

/** Plugin-shipped rubric template `rubrics/*.json` (untrusted). */
export const claudeRubricFileSchema = z
  .object({
    name: z.string().optional(),
    criteria: z.array(z.string()).min(1),
    recommendedGraderModel: z.string().optional(),
    maxIterations: z.number().int().positive().optional(),
    dataPolicy: z.object({ allowExternalGrader: z.boolean().optional() }).loose().optional(),
  })
  .loose();
export type ClaudeRubricFile = z.infer<typeof claudeRubricFileSchema>;

/** Plugin-shipped interpreter request `interpreter.json` (untrusted). */
export const claudeInterpreterFileSchema = z
  .object({
    persistence: z.enum(['thread', 'turn', 'call']).optional(),
    memoryLimitBytes: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    maxResultChars: z.number().int().positive().optional(),
    ptcTools: z.array(z.string()).optional(),
    dynamicSubagents: z.array(z.string()).optional(),
  })
  .loose();
export type ClaudeInterpreterFile = z.infer<typeof claudeInterpreterFileSchema>;

export const commandFrontmatterSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    'argument-hint': z.string().optional(),
    'allowed-tools': z.union([z.string(), z.array(z.string())]).optional(),
    model: z.string().optional(),
  })
  .loose();
export type CommandFrontmatter = z.infer<typeof commandFrontmatterSchema>;

export const mcpServerConfigSchema = z
  .object({
    type: z.string().optional(),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .loose();
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const mcpConfigFileSchema = z
  .object({
    mcpServers: z.record(z.string(), mcpServerConfigSchema),
  })
  .loose();
export type McpConfigFile = z.infer<typeof mcpConfigFileSchema>;

export const claudeHookDefinitionSchema = z
  .object({
    type: z.string().optional(),
    command: z.string().optional(),
    url: z.string().optional(),
    timeout: z.number().optional(),
  })
  .loose();

export const claudeHookMatcherSchema = z
  .object({
    matcher: z.string().optional(),
    hooks: z.array(claudeHookDefinitionSchema),
  })
  .loose();

export const claudeHooksFileSchema = z
  .object({
    hooks: z.record(z.string(), z.array(claudeHookMatcherSchema)),
  })
  .loose();
export type ClaudeHooksFile = z.infer<typeof claudeHooksFileSchema>;

/** Claude lifecycle events that can block a tool call vs. notify only. */
export const CLAUDE_BLOCKING_EVENTS = new Set(['PreToolUse', 'UserPromptSubmit']);

export const claudeSettingsFileSchema = z.object({}).loose();
export type ClaudeSettingsFile = z.infer<typeof claudeSettingsFileSchema>;
