import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  compilePluginSet,
  writeBundle,
  type CompatibilityMode,
  type CompileResult,
} from '@deepagents-plugins/compiler';
import { PolicyEvaluator } from '@deepagents-plugins/policy';
import {
  MANIFEST_NAME,
  builtinResolvers,
  envCredentialProvider,
  loadApprovals,
  loadPluginSetManifest,
  loadPolicyDocument,
  mergeLimits,
  readLockfile,
  resolvePluginSet,
  writeLockfile,
  assertLockfilesMatch,
  type ContentLimits,
  type PluginSourceResolver,
  type ResolvePluginSetResult,
} from '@deepagents-plugins/resolver';
import {
  createPluginRuntime,
  loadCompiledPluginSet,
  type CreatePluginRuntimeOptions,
  type PluginRuntime,
} from '@deepagents-plugins/runtime';
import {
  LOCKFILE_NAME,
  sha256DigestOfJson,
  type BundleManifest,
  type PluginSetManifest,
} from '@deepagents-plugins/schema';

export {
  compilePluginSet,
  writeBundle,
  loadCompiledPluginSet,
  createPluginRuntime,
  loadPluginSetManifest,
  loadPolicyDocument,
  readLockfile,
  MANIFEST_NAME,
  LOCKFILE_NAME,
};
export type { PluginRuntime, CompileResult };

export interface PipelineOptions {
  projectDir: string;
  manifestPath?: string;
  lockfilePath?: string;
  policyPath?: string;
  approvalPaths?: string[];
  frozen?: boolean;
  offline?: boolean;
  strict?: boolean;
  compatibilityMode?: CompatibilityMode;
  outputDir?: string;
  emitSbom?: boolean;
  reproducible?: boolean;
  cacheDir?: string;
  limits?: Partial<ContentLimits>;
  extraResolvers?: PluginSourceResolver[];
}

export interface PipelineResult {
  manifest: PluginSetManifest;
  resolution: ResolvePluginSetResult;
  compiled: CompileResult;
  bundle: BundleManifest;
  outputDir: string;
}

async function buildPolicyEvaluator(options: PipelineOptions): Promise<PolicyEvaluator> {
  const document = options.policyPath ? await loadPolicyDocument(options.policyPath) : undefined;
  const approvals = options.approvalPaths ? await loadApprovals(options.approvalPaths) : [];
  return new PolicyEvaluator({ document, strict: options.strict ?? false, approvals });
}

/** Resolve the plugin set and write (or verify) the lockfile. */
export async function resolvePluginSetFromProject(
  options: PipelineOptions,
): Promise<{ manifest: PluginSetManifest; resolution: ResolvePluginSetResult }> {
  const manifestPath = options.manifestPath ?? path.join(options.projectDir, MANIFEST_NAME);
  const lockfilePath = options.lockfilePath ?? path.join(options.projectDir, LOCKFILE_NAME);
  const manifest = await loadPluginSetManifest(manifestPath);

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepagents-plugins-'));
  const context = {
    limits: mergeLimits(options.limits),
    credentials: envCredentialProvider(),
    offline: options.offline ?? false,
    cacheDir: options.cacheDir ?? path.join(os.homedir(), '.cache', 'deepagents-plugins'),
    projectDir: options.projectDir,
    workDir,
  };
  const resolvers = [...builtinResolvers(), ...(options.extraResolvers ?? [])];
  const resolution = await resolvePluginSet(manifest, resolvers, context);

  const existing = await readLockfile(lockfilePath);
  if (options.frozen) {
    if (!existing) {
      throw new Error(`--frozen-lockfile requires an existing ${LOCKFILE_NAME}`);
    }
    assertLockfilesMatch(existing, resolution.lockfile);
  } else {
    await writeLockfile(lockfilePath, resolution.lockfile);
  }
  return { manifest, resolution };
}

/** Resolve and compile without bundling — used by `audit` (RFC 24.1). */
export async function auditPluginSetFromProject(options: PipelineOptions): Promise<{
  manifest: PluginSetManifest;
  resolution: ResolvePluginSetResult;
  compiled: CompileResult;
}> {
  const { manifest, resolution } = await resolvePluginSetFromProject(options);
  const policy = await buildPolicyEvaluator(options);
  const compiled = await compilePluginSet(resolution.artifacts, {
    policy,
    compatibilityMode: 'permissive',
    pluginSetDigest: sha256DigestOfJson(manifest),
  });
  return { manifest, resolution, compiled };
}

/** Full resolve → policy → compile → bundle pipeline (RFC section 11). */
export async function compilePluginSetFromProject(
  options: PipelineOptions,
): Promise<PipelineResult> {
  const { manifest, resolution } = await resolvePluginSetFromProject(options);
  const policy = await buildPolicyEvaluator(options);

  const compiled = await compilePluginSet(resolution.artifacts, {
    policy,
    compatibilityMode: options.compatibilityMode ?? 'standard',
    pluginSetDigest: sha256DigestOfJson(manifest),
  });

  const outputDir = path.resolve(
    options.projectDir,
    options.outputDir ?? manifest.output.directory,
  );
  const bundle = await writeBundle(compiled, {
    outputDir,
    emitSbom: options.emitSbom ?? manifest.output.emitSbom,
    reproducible: options.reproducible ?? manifest.output.reproducible,
  });
  return { manifest, resolution, compiled, bundle: bundle.manifest, outputDir };
}

export interface CreatePluginRuntimeFromDirectoryOptions extends Omit<
  CreatePluginRuntimeOptions,
  'bundle'
> {
  directory: string;
  verifyIntegrity?: boolean;
}

/** Convenience loader: verify a bundle directory and create the runtime. */
export async function createPluginRuntimeFromDirectory(
  options: CreatePluginRuntimeFromDirectoryOptions,
): Promise<PluginRuntime> {
  const { directory, verifyIntegrity, ...rest } = options;
  const bundle = await loadCompiledPluginSet({ directory, verifyIntegrity });
  return createPluginRuntime({ bundle, ...rest });
}
