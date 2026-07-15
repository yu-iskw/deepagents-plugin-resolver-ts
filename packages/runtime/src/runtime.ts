import path from 'node:path';

import {
  MiddlewareAdapterRegistry,
  type HookInvocation,
  type PortableMiddleware,
} from '@deepagents-plugins/adapter-hooks';
import {
  ExitCodes,
  PluginResolutionError,
  type CompiledCommandV1,
  type CompiledHookV1,
  type CompiledMcpServerV1,
  type CompiledSkillV1,
  type CompiledSubagentV1,
  type ProvenanceRecordV1,
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
}

export interface InvokeCommandRequest {
  command: string;
  arguments?: string | Record<string, string>;
}

export interface PluginRuntime {
  /** Absolute skill directories to pass to Deep Agents `skills:`. */
  skillSources: string[];
  skills: readonly CompiledSkillV1[];
  commands: readonly CompiledCommandV1[];
  subagents: readonly CompiledSubagentV1[];
  mcpServers: readonly CompiledMcpServerV1[];
  hooks: readonly CompiledHookV1[];
  provenance: readonly ProvenanceRecordV1[];
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

  const commandsById = new Map<string, CompiledCommandV1>();
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
    skills: compiled.skills,
    commands: compiled.commands,
    subagents: compiled.subagents,
    mcpServers: compiled.mcpServers,
    hooks: compiled.hooks,
    provenance: compiled.provenance,
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
