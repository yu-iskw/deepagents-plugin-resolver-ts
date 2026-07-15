import { z } from 'zod';

/**
 * Plugin source specifications (RFC section 12). Every mutable reference is
 * pinned during resolution; these schemas describe the *requested* source.
 */

export const localSourceSchema = z.object({
  type: z.literal('local'),
  path: z.string().min(1),
  pluginRoot: z.string().optional(),
});

export const localArchiveSourceSchema = z.object({
  type: z.literal('local-archive'),
  path: z.string().min(1),
  sha256: z.string().optional(),
  pluginRoot: z.string().optional(),
});

export const remoteArchiveSourceSchema = z.object({
  type: z.literal('remote-archive'),
  url: z.url(),
  sha256: z.string().min(1),
  pluginRoot: z.string().optional(),
});

export const gitSourceSchema = z.object({
  type: z.literal('git'),
  url: z.string().min(1),
  ref: z.string().optional(),
  commit: z.string().optional(),
  pluginRoot: z.string().optional(),
});

export const githubSourceSchema = z.object({
  type: z.literal('github'),
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  ref: z.string().optional(),
  commit: z.string().optional(),
  pluginRoot: z.string().optional(),
  host: z.string().optional(),
});

export const npmSourceSchema = z.object({
  type: z.literal('npm'),
  package: z.string().min(1),
  version: z.string().optional(),
  registry: z.url().optional(),
  pluginRoot: z.string().optional(),
});

export const pluginSourceSpecSchema = z.discriminatedUnion('type', [
  localSourceSchema,
  localArchiveSourceSchema,
  remoteArchiveSourceSchema,
  gitSourceSchema,
  githubSourceSchema,
  npmSourceSchema,
]);
export type PluginSourceSpec = z.infer<typeof pluginSourceSpecSchema>;
export type LocalSourceSpec = z.infer<typeof localSourceSchema>;
export type LocalArchiveSourceSpec = z.infer<typeof localArchiveSourceSchema>;
export type RemoteArchiveSourceSpec = z.infer<typeof remoteArchiveSourceSchema>;
export type GitSourceSpec = z.infer<typeof gitSourceSchema>;
export type GithubSourceSpec = z.infer<typeof githubSourceSchema>;
export type NpmSourceSpec = z.infer<typeof npmSourceSchema>;

/** An immutable, pinned source identity recorded in lockfiles and the IR. */
export const lockedSourceSchema = z.object({
  type: z.string(),
  uri: z.string(),
  requestedRef: z.string().optional(),
  resolvedCommit: z.string().optional(),
  version: z.string().optional(),
  integrity: z.string().optional(),
  pluginRoot: z.string().optional(),
});
export type LockedSourceV1 = z.infer<typeof lockedSourceSchema>;
