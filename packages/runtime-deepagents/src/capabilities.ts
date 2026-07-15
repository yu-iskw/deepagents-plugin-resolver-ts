import {
  emptyDeepAgentsCapabilities,
  type DeepAgentsCapabilities,
} from '@deepagents-plugins/schema';

export interface DetectCapabilitiesOptions {
  /**
   * The `deepagents` module (or a compatible object) to probe. When omitted,
   * a guarded dynamic `import('deepagents')` is attempted; if that fails, an
   * all-false capability map is returned.
   */
  module?: unknown;
  /** Set false to skip the dynamic import fallback when no module is given. */
  autoImport?: boolean;
  /** Adapter-gated capabilities the application has registered adapters for. */
  registeredAdapters?: {
    interpreter?: { implementation?: string; ptc?: boolean; dynamicSubagents?: boolean };
    rubric?: { implementation?: string };
    asyncSubagents?: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasFunction(module: Record<string, unknown>, name: string): boolean {
  return typeof module[name] === 'function';
}

/**
 * Structural Deep Agents capability detection (RFC v2 section 11): inspect
 * actual exported APIs and registered adapters instead of trusting version
 * strings. Unknown or missing exports resolve to `false`, never a guess.
 */
export async function detectDeepAgentsCapabilities(
  options: DetectCapabilitiesOptions = {},
): Promise<DeepAgentsCapabilities> {
  let module = options.module;
  if (module === undefined && (options.autoImport ?? true)) {
    try {
      module = await import('deepagents');
    } catch {
      module = undefined;
    }
  }

  const capabilities = emptyDeepAgentsCapabilities();
  const adapters = options.registeredAdapters ?? {};
  if (adapters.interpreter) {
    capabilities.interpreter = {
      available: true,
      implementation: adapters.interpreter.implementation,
      ptc: adapters.interpreter.ptc ?? false,
      dynamicSubagents: adapters.interpreter.dynamicSubagents ?? false,
    };
  }
  if (adapters.rubric) {
    capabilities.rubric = { available: true, implementation: adapters.rubric.implementation };
  }

  if (!isRecord(module)) return capabilities;
  if (!hasFunction(module, 'createDeepAgent')) return capabilities;

  const version =
    typeof module['version'] === 'string' ? (module['version'] as string) : undefined;
  capabilities.version = version;

  // createDeepAgent existing implies the core option surface.
  capabilities.skills = true;
  capabilities.syncSubagents = true;
  capabilities.memory = true;
  capabilities.interruptOn = true;
  capabilities.permissions = true;
  capabilities.streamTransformers = true;
  capabilities.eventStreaming.langGraphV2 = true;

  // Optional surfaces probed by export shape.
  capabilities.harnessProfiles =
    hasFunction(module, 'registerHarnessProfile') || hasFunction(module, 'registerProfile');
  capabilities.asyncSubagents =
    adapters.asyncSubagents === true ||
    hasFunction(module, 'createAsyncSubagent') ||
    hasFunction(module, 'createAgentProtocolClient');
  capabilities.eventStreaming.subagentProjection = hasFunction(module, 'projectSubagentEvents');

  return capabilities;
}
