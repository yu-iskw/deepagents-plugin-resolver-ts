import {
  createPluginRuntime,
  type CreatePluginRuntimeOptions,
  type LoadedPluginBundle,
  type PluginRuntime,
} from '@deepagents-plugins/runtime';
import {
  DiagnosticCodes,
  ExitCodes,
  PluginResolutionError,
  capabilityAvailable,
  type CompatibilityDiagnosticV2,
  type CompiledHarnessProfileV2,
  type CompiledStreamMetadataV2,
  type DeepAgentsCapabilities,
} from '@deepagents-plugins/schema';

import { detectDeepAgentsCapabilities, type DetectCapabilitiesOptions } from './capabilities.js';

/** Framework-neutral sync subagent descriptor for `createDeepAgent`. */
export interface SyncSubagentDescriptor {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
  memory: string[];
  pluginId: string;
}

/** Provenance attached to stream events by the generated transformers. */
export interface ProvenanceStreamEvent<T = unknown> {
  event: T;
  source: {
    pluginId: string;
    componentId: string;
    namespace: string[];
  };
  redaction?: { applied: boolean; fields?: string[] };
}

export interface CreateDeepAgentsContributionsOptions
  extends Omit<CreatePluginRuntimeOptions, 'bundle' | 'registeredAdapters'>,
    Pick<DetectCapabilitiesOptions, 'module' | 'autoImport' | 'registeredAdapters'> {
  bundle: LoadedPluginBundle;
  /** Pre-detected capability map; skips detection when provided. */
  capabilities?: DeepAgentsCapabilities;
  /** Called by registerHarnessProfiles when the runtime supports profiles. */
  profileRegistrar?: (profile: CompiledHarnessProfileV2) => void;
}

/** Runtime contributions for createDeepAgent (RFC v2 Appendix D). */
export interface DeepAgentRuntimeContributions {
  runtime: PluginRuntime;
  capabilities: DeepAgentsCapabilities;
  skillSources: string[];
  memorySources: string[];
  syncSubagents: SyncSubagentDescriptor[];
  asyncSubagents: PluginRuntime['asyncSubagents'];
  harnessProfiles: readonly CompiledHarnessProfileV2[];
  interruptRecommendations: Record<string, { risk: string; decisions: string[] }>;
  permissions: PluginRuntime['permissions'];
  streamTransformers: Array<<T>(event: T, componentId: string) => ProvenanceStreamEvent<T>>;
  registerHarnessProfiles(): void;
  diagnostics: readonly CompatibilityDiagnosticV2[];
}

/**
 * Negotiate bundle requirements against detected Deep Agents capabilities and
 * build framework-neutral contributions (RFC v2 sections 11, 30). Missing
 * required capabilities fail with DAP4210; missing optional capabilities
 * disable the component with a warning diagnostic.
 */
export async function createDeepAgentsContributions(
  options: CreateDeepAgentsContributionsOptions,
): Promise<DeepAgentRuntimeContributions> {
  const { bundle } = options;
  const capabilities =
    options.capabilities ??
    (await detectDeepAgentsCapabilities({
      module: options.module,
      autoImport: options.autoImport,
      registeredAdapters: options.registeredAdapters,
    }));

  const diagnostics: CompatibilityDiagnosticV2[] = [];
  const disabled = new Set<string>();
  for (const requirement of bundle.requiredCapabilities) {
    if (capabilityAvailable(capabilities, requirement.capability)) continue;
    if (requirement.required) {
      throw new PluginResolutionError(
        `${DiagnosticCodes.CapabilityMismatch}: the bundle requires Deep Agents capability "${requirement.capability}" (components: ${requirement.componentIds.join(', ')}), which the installed runtime does not expose.`,
        ExitCodes.CompatibilityFailure,
        'Install a Deep Agents JS version exposing this capability, or remove the components from the plugin set.',
      );
    }
    disabled.add(requirement.capability);
    for (const componentId of requirement.componentIds) {
      diagnostics.push({
        code: DiagnosticCodes.CapabilityMismatch,
        severity: 'warning',
        pluginId: componentId.split(':')[0] ?? componentId,
        component: componentId,
        compatibility: 'runtime-unavailable',
        message: `Optional capability "${requirement.capability}" is unavailable; component disabled.`,
        remediation:
          'Upgrade Deep Agents JS or register a matching adapter to enable this component.',
      });
    }
  }

  const adapterNames: Array<'interpreter' | 'asyncSubagents' | 'rubrics'> = [];
  if (options.registeredAdapters?.interpreter) adapterNames.push('interpreter');
  if (options.registeredAdapters?.asyncSubagents) adapterNames.push('asyncSubagents');
  if (options.registeredAdapters?.rubric) adapterNames.push('rubrics');
  const runtime = createPluginRuntime({
    bundle,
    middlewareAdapters: options.middlewareAdapters,
    onAuditEvent: options.onAuditEvent,
    registeredAdapters: adapterNames,
  });
  diagnostics.push(...runtime.runtimeDiagnostics);

  const syncSubagents: SyncSubagentDescriptor[] = disabled.has('syncSubagents')
    ? []
    : runtime.syncSubagents.map((subagent) => ({
        name: subagent.name,
        description: subagent.description,
        systemPrompt: subagent.systemPrompt,
        tools: subagent.toolRefs,
        skills: subagent.skillRefs,
        memory: subagent.memoryRefs,
        pluginId: subagent.pluginId,
      }));

  const interruptRecommendations: Record<string, { risk: string; decisions: string[] }> = {};
  if (!disabled.has('interruptOn')) {
    for (const policy of runtime.hitlPolicies) {
      interruptRecommendations[policy.toolRef] = {
        risk: policy.risk,
        decisions: policy.recommendedDecisions,
      };
    }
  }

  const streamByComponent = new Map<string, CompiledStreamMetadataV2>(
    runtime.streamMetadata.map((entry) => [entry.componentId, entry]),
  );
  const streamTransformers: DeepAgentRuntimeContributions['streamTransformers'] = disabled.has(
    'streamTransformers',
  )
    ? []
    : [
        <T,>(event: T, componentId: string): ProvenanceStreamEvent<T> => {
          const metadata = streamByComponent.get(componentId);
          return {
            event,
            source: {
              pluginId: metadata?.pluginId ?? 'unknown',
              componentId,
              namespace: metadata?.namespace ?? [],
            },
            redaction: metadata?.redactionFields
              ? { applied: true, fields: metadata.redactionFields }
              : undefined,
          };
        },
      ];

  let profilesRegistered = false;
  const registerHarnessProfiles = (): void => {
    if (profilesRegistered) return;
    profilesRegistered = true;
    if (!capabilities.harnessProfiles || options.profileRegistrar === undefined) {
      if (runtime.harnessProfiles.length > 0) {
        diagnostics.push({
          code: DiagnosticCodes.RuntimeUnavailable,
          severity: 'warning',
          pluginId: runtime.harnessProfiles[0]?.pluginId ?? 'unknown',
          component: 'harness-profiles',
          compatibility: 'runtime-unavailable',
          message:
            'Harness profiles were compiled but no profile registrar is available; profiles were not registered.',
          remediation:
            'Pass profileRegistrar to createDeepAgentsContributions, or upgrade Deep Agents JS.',
        });
      }
      return;
    }
    for (const profile of runtime.harnessProfiles) {
      options.profileRegistrar(profile);
    }
  };

  return {
    runtime,
    capabilities,
    skillSources: disabled.has('skills') ? [] : runtime.skillSources,
    memorySources: disabled.has('memory') ? [] : runtime.memorySources,
    syncSubagents,
    asyncSubagents: runtime.asyncSubagents,
    harnessProfiles: runtime.harnessProfiles,
    interruptRecommendations,
    permissions: disabled.has('permissions') ? [] : runtime.permissions,
    streamTransformers,
    registerHarnessProfiles,
    diagnostics,
  };
}
