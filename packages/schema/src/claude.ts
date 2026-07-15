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
  })
  .loose();
export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

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
