import {
  CLAUDE_BLOCKING_EVENTS,
  qualifiedComponentId,
  type CompiledHookActionV1,
  type CompiledHookV1,
  type PortableHookEventV1,
} from '@deepagents-plugins/schema';

/**
 * Hook translation (RFC section 16.5). Claude lifecycle events map onto a
 * smaller portable lifecycle by *semantics*, not by name: only events that
 * can actually block a tool call become `beforeToolCall` hooks. Command
 * hooks are compiled as descriptors but denied by default policy; shell
 * strings are never preserved.
 */

const EVENT_MAP: Record<string, PortableHookEventV1 | undefined> = {
  PreToolUse: 'beforeToolCall',
  PostToolUse: 'afterToolCall',
  UserPromptSubmit: 'beforeAgentInvoke',
  SessionStart: 'beforeAgentInvoke',
  Stop: 'afterAgentInvoke',
  SubagentStop: 'afterSubagentInvoke',
};

export interface HookTranslation {
  hook: CompiledHookV1;
  /** Capability required by this hook's action type. */
  capability: 'hooks.middleware' | 'hooks.webhook' | 'hooks.command';
}

export function mapClaudeHookEvent(event: string): PortableHookEventV1 | undefined {
  return EVENT_MAP[event];
}

export function translateClaudeHook(
  pluginId: string,
  pluginNamespace: string,
  claudeEvent: string,
  index: number,
  definition: { type?: string; command?: string; url?: string },
  matcher?: string,
): HookTranslation {
  const id = qualifiedComponentId(pluginNamespace, `hook-${claudeEvent.toLowerCase()}-${index}`);
  const portableEvent = mapClaudeHookEvent(claudeEvent);

  const base = {
    id,
    pluginId,
    matcher,
    originalEvent: claudeEvent,
  };

  if (!portableEvent) {
    return {
      capability: 'hooks.middleware',
      hook: {
        ...base,
        event: 'afterToolCall',
        action: {
          type: 'unsupported',
          reason: `Claude event "${claudeEvent}" has no portable equivalent (notification-only events are never treated as authorization hooks)`,
        },
        compatibility: 'unsupported',
      },
    };
  }

  // A hook that would block a tool call must come from a blocking-capable
  // Claude event; otherwise it is advisory only.
  const event: PortableHookEventV1 =
    portableEvent === 'beforeToolCall' && !CLAUDE_BLOCKING_EVENTS.has(claudeEvent)
      ? 'afterToolCall'
      : portableEvent;

  let action: CompiledHookActionV1;
  let capability: HookTranslation['capability'];
  let compatibility: CompiledHookV1['compatibility'];

  if (definition.url) {
    capability = 'hooks.webhook';
    compatibility = 'translated';
    action = {
      type: 'webhook',
      endpointRef: `hooks.${pluginNamespace}.${claudeEvent}.${index}.endpoint`,
    };
  } else if (definition.command) {
    // Claude command hooks are shell strings; we never execute them. They
    // compile to descriptors referencing a bundled executable asset with
    // typed arguments, and remain denied by default policy.
    capability = 'hooks.command';
    compatibility = 'partial';
    action = {
      type: 'command',
      executableAssetId: `${pluginNamespace}:hook:${claudeEvent}:${index}`,
      args: [],
      sandboxProfile: 'default-deny',
    };
  } else {
    capability = 'hooks.middleware';
    compatibility = 'unsupported';
    action = {
      type: 'unsupported',
      reason: 'Hook declares neither a command nor a url',
    };
  }

  return { capability, hook: { ...base, event, action, compatibility } };
}

/* ------------------------- runtime middleware ------------------------- */

export interface HookInvocation {
  event: PortableHookEventV1;
  pluginId: string;
  hookId: string;
  payload: unknown;
}

export type PortableMiddleware = (invocation: HookInvocation) => Promise<void>;

/**
 * Registry of trusted, application-registered middleware adapters. Plugins
 * can reference adapters by name but can never register code themselves
 * (RFC 35.4).
 */
export class MiddlewareAdapterRegistry {
  private readonly adapters = new Map<string, PortableMiddleware>();

  register(name: string, middleware: PortableMiddleware): void {
    if (this.adapters.has(name)) {
      throw new Error(`Middleware adapter "${name}" is already registered`);
    }
    this.adapters.set(name, middleware);
  }

  get(name: string): PortableMiddleware | undefined {
    return this.adapters.get(name);
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }
}
