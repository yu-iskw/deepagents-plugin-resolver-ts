import path from 'node:path';

import {
  MiddlewareAdapterRegistry,
  type HookInvocation,
  type PortableMiddleware,
} from '@deepagents-plugins/adapter-hooks';
import {
  DiagnosticCodes,
  ExitCodes,
  PluginResolutionError,
  type CompatibilityDiagnosticV2,
  type CompiledAsyncSubagentV2,
  type CompiledCommandV2,
  type CompiledHarnessProfileV2,
  type CompiledHitlRecommendationV2,
  type CompiledHookV2,
  type CompiledMcpServerV2,
  type CompiledMemorySourceV2,
  type CompiledPermissionV2,
  type CompiledRubricTemplateV2,
  type CompiledSkillV2,
  type CompiledStreamMetadataV2,
  type CompiledSyncSubagentV2,
  type ProvenanceRecordV2,
} from '@deepagents-plugins/schema';

import type { LoadedPluginBundle } from './load-bundle.js';

export interface AuditEvent {
  type:
    | 'bundle-loaded'
    | 'integrity-verified'
    | 'command-invoked'
    | 'hook-triggered'
    | 'tool-registered';
  detail: Record<string, string>;
}

export interface CreatePluginRuntimeOptions {
  bundle: LoadedPluginBundle;
  middlewareAdapters?: MiddlewareAdapterRegistry;
  onAuditEvent?: (event: AuditEvent) => void;
  /**
   * Names of adapter-gated capabilities the application has registered
   * adapters for ('interpreter', 'asyncSubagents', 'rubrics'). Compiled
   * components without a registered adapter stay inert and produce
   * runtime diagnostics (RFC v2 sections 16, 17, 23).
   */
  registeredAdapters?: ReadonlyArray<'interpreter' | 'asyncSubagents' | 'rubrics'>;
}

export interface InvokeCommandRequest {
  command: string;
  arguments?: string | Record<string, string>;
}

export interface PluginRuntime {
  /** Absolute skill directories to pass to Deep Agents `skills:`. */
  skillSources: string[];
  /** Absolute paths of read-only memory files to expose via a backend. */
  memorySources: string[];
  skills: readonly CompiledSkillV2[];
  memory: readonly CompiledMemorySourceV2[];
  commands: readonly CompiledCommandV2[];
  syncSubagents: readonly CompiledSyncSubagentV2[];
  asyncSubagents: readonly CompiledAsyncSubagentV2[];
  mcpServers: readonly CompiledMcpServerV2[];
  hooks: readonly CompiledHookV2[];
  harnessProfiles: readonly CompiledHarnessProfileV2[];
  hitlPolicies: readonly CompiledHitlRecommendationV2[];
  permissions: readonly CompiledPermissionV2[];
  rubricTemplates: readonly CompiledRubricTemplateV2[];
  streamMetadata: readonly CompiledStreamMetadataV2[];
  provenance: readonly ProvenanceRecordV2[];
  /**
   * Diagnostics produced at load time, e.g. adapter-gated components
   * (interpreter, async subagents, rubrics) with no registered adapter.
   */
  runtimeDiagnostics: readonly CompatibilityDiagnosticV2[];
  /** System prompt fragment describing available plugin capabilities. */
  systemPromptPrefix: string;
  /** Application-registered middleware matching compiled middleware hooks. */
  middleware: PortableMiddleware[];
  /** Expand a compiled command template into a prompt string. */
  invokeCommand(request: InvokeCommandRequest): string;
  /** Dispatch a lifecycle event to compiled middleware hooks. */
  dispatchHookEvent(invocation: Omit<HookInvocation, 'hookId' | 'pluginId'>): Promise<void>;
}

/**
 * Runtime adapter (RFC section 18). Framework-agnostic: exposes compiled
 * plugin data for `createDeepAgent` without depending on Deep Agents itself.
 * Never resolves sources, installs packages, or mutates the bundle.
 */
export function createPluginRuntime(options: CreatePluginRuntimeOptions): PluginRuntime {
  const { bundle } = options;
  const compiled = bundle.compiled;
  const adapters = options.middlewareAdapters ?? new MiddlewareAdapterRegistry();
  const audit = options.onAuditEvent ?? ((): void => undefined);

  audit({ type: 'bundle-loaded', detail: { bundleDigest: bundle.manifest.bundleDigest } });

  // Exact skill directories only — not the namespace parent — so Deep Agents
  // cannot discover unmanifested sibling skill folders planted on disk.
  const skillSources = [
    ...new Set(compiled.skills.map((skill) => path.join(bundle.directory, skill.directory))),
  ].sort();
  const memorySources = [
    ...new Set(compiled.memorySources.map((memory) => path.join(bundle.directory, memory.path))),
  ].sort();

  // Adapter-gated capabilities stay inert without a registered adapter.
  const registered = new Set(options.registeredAdapters ?? []);
  const runtimeDiagnostics: CompatibilityDiagnosticV2[] = [];
  const gate = (
    capability: 'interpreter' | 'asyncSubagents' | 'rubrics',
    components: ReadonlyArray<{ id: string; pluginId: string }>,
  ): void => {
    if (registered.has(capability)) return;
    for (const component of components) {
      runtimeDiagnostics.push({
        code: DiagnosticCodes.RequiresAdapter,
        severity: 'warning',
        pluginId: component.pluginId,
        component: component.id,
        compatibility: 'requires-adapter',
        message: `Component "${component.id}" needs a registered "${capability}" adapter and stays inactive.`,
        remediation: `Register a ${capability} adapter via createPluginRuntime({ registeredAdapters: [...] }).`,
      });
    }
  };
  gate('interpreter', compiled.interpreterPolicies);
  gate('asyncSubagents', compiled.asyncSubagents);
  gate('rubrics', compiled.rubricTemplates);

  const commandsById = new Map<string, CompiledCommandV2>();
  for (const command of compiled.commands) {
    commandsById.set(command.id, command);
  }

  const middlewareHooks = compiled.hooks.filter((hook) => hook.action.type === 'middleware');
  const middleware: PortableMiddleware[] = [];
  for (const hook of middlewareHooks) {
    if (hook.action.type !== 'middleware') continue;
    const adapter = adapters.get(hook.action.adapter);
    if (adapter) middleware.push(adapter);
  }

  const promptLines = compiled.plugins.map(
    (plugin) =>
      `- ${plugin.name}${plugin.version ? ` v${plugin.version}` : ''}: ${plugin.description ?? 'no description'}`,
  );

  return {
    skillSources,
    memorySources,
    skills: compiled.skills,
    memory: compiled.memorySources,
    commands: compiled.commands,
    syncSubagents: compiled.syncSubagents,
    asyncSubagents: registered.has('asyncSubagents') ? compiled.asyncSubagents : [],
    mcpServers: compiled.mcpServers,
    hooks: compiled.hooks,
    harnessProfiles: compiled.harnessProfiles,
    hitlPolicies: compiled.hitlPolicies,
    permissions: compiled.permissions,
    rubricTemplates: compiled.rubricTemplates,
    streamMetadata: compiled.streamMetadata,
    provenance: compiled.provenance,
    runtimeDiagnostics,
    middleware,
    systemPromptPrefix:
      compiled.plugins.length > 0
        ? `The following pre-approved plugins are installed:\n${promptLines.join('\n')}\n`
        : '',
    invokeCommand(request: InvokeCommandRequest): string {
      const command =
        commandsById.get(request.command) ??
        compiled.commands.find((candidate) => candidate.name === request.command);
      if (!command) {
        throw new PluginResolutionError(
          `Unknown plugin command "${request.command}"`,
          ExitCodes.GeneralFailure,
        );
      }
      audit({ type: 'command-invoked', detail: { command: command.id } });
      const args =
        typeof request.arguments === 'string'
          ? request.arguments
          : Object.entries(request.arguments ?? {})
              .map(([key, value]) => `${key}=${value}`)
              .join(' ');
      return command.promptTemplate.replaceAll('$ARGUMENTS', args);
    },
    async dispatchHookEvent(invocation): Promise<void> {
      for (const hook of middlewareHooks) {
        if (hook.event !== invocation.event || hook.action.type !== 'middleware') continue;
        const adapter = adapters.get(hook.action.adapter);
        if (!adapter) continue;
        audit({ type: 'hook-triggered', detail: { hookId: hook.id, event: hook.event } });
        await adapter({ ...invocation, hookId: hook.id, pluginId: hook.pluginId });
      }
    },
  };
}
