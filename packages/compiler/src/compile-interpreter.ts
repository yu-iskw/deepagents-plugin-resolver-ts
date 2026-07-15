import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  claudeInterpreterFileSchema,
  qualifiedComponentId,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, type PluginContext } from './compile-context.js';

const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULT_CHARS = 20_000;

/**
 * Compile interpreter requests into policy descriptors (RFC v2 section 16).
 * Interpreters are adapter-gated; PTC is an independent deny-by-default
 * boundary, never inherited from ordinary tool approval.
 */
export async function compileInterpreter(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  if (!inspection.hasInterpreterConfig) return;
  if (featureToggle(context, 'interpreter') === 'disabled') return;

  const component = 'interpreter.json';
  const raw: unknown = JSON.parse(
    await fs.readFile(path.join(input.rootDir, 'interpreter.json'), 'utf8'),
  );
  const parsed = claudeInterpreterFileSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.add({
      code: DiagnosticCodes.ManifestInvalid,
      severity: 'error',
      pluginId: input.locked.id,
      component,
      compatibility: 'unsupported',
      message: 'interpreter.json is not a valid interpreter configuration',
    });
    return;
  }

  const runtimeEnabled = context.options.runtime?.interpreter.enabled ?? false;
  if (!runtimeEnabled) {
    context.degraded = true;
    diagnostics.add({
      code: DiagnosticCodes.RuntimeUnavailable,
      severity: 'warning',
      pluginId: input.locked.id,
      component,
      compatibility: 'runtime-unavailable',
      message:
        'The plugin requests an interpreter, but runtime.interpreter.enabled is false and no JS interpreter adapter is configured.',
      remediation:
        'Enable runtime.interpreter and register an interpreter adapter, or disable the interpreter feature for this plugin.',
    });
    ir.interpreterPolicies.push(
      buildPolicy(context, parsed.data, { enabled: false, ptcAllowed: false, compatibility: 'runtime-unavailable' }),
    );
    return;
  }

  if (!policyGate(context, 'interpreter', component)) return;

  // PTC is a separate permission boundary (RFC 16): explicit allowlist only.
  const ptcRequested = (parsed.data.ptcTools ?? []).length > 0;
  let ptcAllowed = false;
  if (ptcRequested) {
    const ptcDefault = context.options.runtime?.interpreter.ptcDefault ?? 'deny';
    ptcAllowed = ptcDefault === 'allow' && policyGate(context, 'ptc', `${component}#ptc`);
    if (!ptcAllowed) {
      context.degraded = true;
      diagnostics.add({
        code: DiagnosticCodes.PolicyDenied,
        severity: 'warning',
        pluginId: input.locked.id,
        component: `${component}#ptc`,
        compatibility: 'blocked-by-policy',
        message: 'Programmatic tool calling is denied; ptcTools stripped from the compiled policy.',
        remediation:
          'Set runtime.interpreter.ptcDefault to "allow" and permit the "ptc" capability for this trust policy.',
      });
    }
  }

  context.degraded = true;
  diagnostics.add({
    code: DiagnosticCodes.RequiresAdapter,
    severity: 'warning',
    pluginId: input.locked.id,
    component,
    compatibility: 'requires-adapter',
    message: 'Interpreter policies activate only through a registered interpreter adapter.',
  });
  ir.interpreterPolicies.push(
    buildPolicy(context, parsed.data, { enabled: true, ptcAllowed, compatibility: 'requires-adapter' }),
  );
}

function buildPolicy(
  context: PluginContext,
  data: {
    persistence?: 'thread' | 'turn' | 'call';
    memoryLimitBytes?: number;
    timeoutMs?: number;
    maxResultChars?: number;
    ptcTools?: string[];
    dynamicSubagents?: string[];
  },
  outcome: {
    enabled: boolean;
    ptcAllowed: boolean;
    compatibility: 'runtime-unavailable' | 'requires-adapter';
  },
): (typeof context.ir.interpreterPolicies)[number] {
  return {
    id: qualifiedComponentId(context.input.runtimeNamespace, 'interpreter'),
    pluginId: context.input.locked.id,
    enabled: outcome.enabled,
    persistence: data.persistence ?? 'turn',
    memoryLimitBytes: Math.min(data.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES, DEFAULT_MEMORY_LIMIT_BYTES),
    timeoutMs: Math.min(data.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxResultChars: Math.min(data.maxResultChars ?? DEFAULT_MAX_RESULT_CHARS, DEFAULT_MAX_RESULT_CHARS),
    ptcTools: outcome.ptcAllowed ? [...(data.ptcTools ?? [])].sort() : [],
    dynamicSubagents: [...(data.dynamicSubagents ?? [])].sort(),
    compatibility: outcome.compatibility,
  };
}
