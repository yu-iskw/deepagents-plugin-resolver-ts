import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  type ClaudePluginManifest,
  type CompiledPluginSetV2,
  type DiagnosticCollector,
  type LockedPlugin,
  type PluginFeatures,
  type PluginSourceSpec,
  type RuntimeConfig,
} from '@deepagents-plugins/schema';

import type { PluginInspection } from './inspect.js';
import type { PolicyEvaluator } from '@deepagents-plugins/policy';

export type CompatibilityMode = 'permissive' | 'standard' | 'strict';

export interface PluginCompileInput {
  locked: LockedPlugin;
  rootDir: string;
  manifest: ClaudePluginManifest;
  runtimeNamespace: string;
  /** Original requested source; used for source-trust policy checks. */
  requested?: PluginSourceSpec;
  /** Per-plugin feature toggles from the project manifest (RFC section 8). */
  features?: PluginFeatures;
}

export interface CompileOptions {
  policy: PolicyEvaluator;
  compatibilityMode?: CompatibilityMode;
  compiler?: { name: string; version: string };
  pluginSetDigest: string;
  /** Runtime integration settings from the project manifest. */
  runtime?: RuntimeConfig;
}

/** Shared state threaded through the per-component compilation helpers. */
export interface PluginContext {
  input: PluginCompileInput;
  inspection: PluginInspection;
  ir: CompiledPluginSetV2;
  diagnostics: DiagnosticCollector;
  filesToCopy: Map<string, string>;
  inlineJsonFiles: Map<string, unknown>;
  options: CompileOptions;
  capabilities: Set<string>;
  degraded: boolean;
  blocked: boolean;
}

/** Evaluate policy for a capability, recording a diagnostic on non-allow. */
export function policyGate(context: PluginContext, capability: string, component: string): boolean {
  const { locked } = context.input;
  const decision = context.options.policy.evaluate({
    pluginId: locked.id,
    profile: locked.trustPolicy,
    capability,
    contentDigest: locked.contentDigest,
  });
  if (decision.effect === 'allow') {
    context.capabilities.add(capability);
    return true;
  }
  context.blocked = true;
  context.diagnostics.add({
    code:
      decision.effect === 'deny' ? DiagnosticCodes.PolicyDenied : DiagnosticCodes.RequiresApproval,
    severity: decision.effect === 'deny' ? 'error' : 'warning',
    pluginId: locked.id,
    component,
    compatibility: decision.effect === 'deny' ? 'blocked-by-policy' : 'requires-approval',
    message: decision.reason,
    remediation: decision.remediation,
  });
  return false;
}

/**
 * Per-plugin feature toggle (RFC section 8). Returns the configured value;
 * `disabled` components are skipped before any policy evaluation.
 */
export function featureToggle<K extends keyof PluginFeatures>(
  context: PluginContext,
  feature: K,
): PluginFeatures[K] | undefined {
  return context.input.features?.[feature];
}

export function stageFile(context: PluginContext, absolute: string, bundlePath: string): void {
  context.filesToCopy.set(bundlePath, absolute);
}

export async function stageDirectory(
  filesToCopy: Map<string, string>,
  sourceDir: string,
  bundleDir: string,
): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    const relative = path.relative(sourceDir, absolute).split(path.sep).join('/');
    filesToCopy.set(`${bundleDir}/${relative}`, absolute);
  }
}
