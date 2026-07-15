import path from 'node:path';

import {
  qualifiedComponentId,
  qualifiedToolId,
  normalizeName,
  type CompiledMcpServerV2,
  type McpServerConfig,
} from '@deepagents-plugins/schema';

/**
 * MCP translation and runtime wrappers (RFC section 16.4).
 *
 * Compile side: `.mcp.json` entries become transport descriptors. Environment
 * values and headers are recorded as *references*, never literal secrets.
 * Runtime side: descriptor-driven tool construction with a mandatory
 * authorization wrapper; the application supplies the actual MCP client.
 */

export interface McpTranslationResult {
  server?: CompiledMcpServerV2;
  /** Reason the server could not be translated, when `server` is absent. */
  unsupportedReason?: string;
  /** Capability this server needs: `mcp.remoteHttp` or `mcp.stdio`. */
  capability: 'mcp.remoteHttp' | 'mcp.stdio';
}

export function translateMcpServer(
  pluginId: string,
  pluginNamespace: string,
  serverName: string,
  config: McpServerConfig,
): McpTranslationResult {
  const id = qualifiedComponentId(pluginNamespace, serverName);

  if (config.url) {
    const transport = config.type === 'sse' ? ('sse' as const) : ('streamable-http' as const);
    const headerRefs: Record<string, string> = {};
    for (const key of Object.keys(config.headers ?? {}).sort()) {
      // Header values in plugin config are treated as secret references,
      // resolved by the host application at connect time.
      headerRefs[key] = `mcp.${pluginNamespace}.${serverName}.header.${key}`;
    }
    return {
      capability: 'mcp.remoteHttp',
      server: {
        id,
        pluginId,
        transport,
        endpoint: config.url,
        headerRefs: Object.keys(headerRefs).length > 0 ? headerRefs : undefined,
        environmentRefs: Object.keys(config.env ?? {}).sort(),
        startupPolicy: 'lazy',
        compatibility: 'translated',
      },
    };
  }

  if (config.command) {
    const commandBase = normalizeName(path.basename(config.command));
    return {
      capability: 'mcp.stdio',
      server: {
        id,
        pluginId,
        transport: 'stdio',
        commandAssetId: `${pluginNamespace}:bin:${commandBase}`,
        args: config.args ?? [],
        environmentRefs: Object.keys(config.env ?? {}).sort(),
        startupPolicy: 'lazy',
        compatibility: 'partial',
      },
    };
  }

  return {
    capability: 'mcp.remoteHttp',
    unsupportedReason: `MCP server "${serverName}" declares neither a url nor a command`,
  };
}

/* ------------------------- runtime-side wrappers ------------------------- */

export interface PluginAuthorizationContext {
  principal: {
    id: string;
    tenantId?: string;
    roles?: string[];
  };
  pluginId: string;
  componentId: string;
  capability: string;
  input?: unknown;
}

export type PluginAuthorization = (context: PluginAuthorizationContext) => Promise<boolean>;

export type SecretResolver = (reference: string) => Promise<string | undefined>;

export interface PluginToolDescriptor {
  /** Fully qualified internal id: `plugin.<namespace>.<tool>`. */
  id: string;
  name: string;
  description?: string;
  serverId: string;
  pluginId: string;
  invoke(input: unknown): Promise<unknown>;
}

export class ToolAuthorizationError extends Error {
  constructor(toolId: string) {
    super(`Authorization denied for tool "${toolId}"`);
    this.name = 'ToolAuthorizationError';
  }
}

export interface WrapToolOptions {
  authorization?: PluginAuthorization;
  principal?: PluginAuthorizationContext['principal'];
  /** Cap on serialized tool output size (RFC 16.4: output flooding). */
  maxOutputBytes?: number;
  onAuditEvent?: (event: {
    type: 'tool-invoked' | 'tool-denied';
    toolId: string;
    pluginId: string;
  }) => void;
}

/** Wrap a raw tool invocation with per-call authorization and output limits. */
export function wrapPluginTool(
  server: CompiledMcpServerV2,
  pluginNamespace: string,
  toolName: string,
  rawInvoke: (input: unknown) => Promise<unknown>,
  options: WrapToolOptions = {},
): PluginToolDescriptor {
  const id = qualifiedToolId(pluginNamespace, toolName);
  const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
  return {
    id,
    name: toolName,
    serverId: server.id,
    pluginId: server.pluginId,
    async invoke(input: unknown): Promise<unknown> {
      if (server.toolAllowlist && !server.toolAllowlist.includes(toolName)) {
        options.onAuditEvent?.({ type: 'tool-denied', toolId: id, pluginId: server.pluginId });
        throw new ToolAuthorizationError(id);
      }
      if (options.authorization) {
        const allowed = await options.authorization({
          principal: options.principal ?? { id: 'anonymous' },
          pluginId: server.pluginId,
          componentId: server.id,
          capability: id,
          input,
        });
        if (!allowed) {
          options.onAuditEvent?.({ type: 'tool-denied', toolId: id, pluginId: server.pluginId });
          throw new ToolAuthorizationError(id);
        }
      }
      options.onAuditEvent?.({ type: 'tool-invoked', toolId: id, pluginId: server.pluginId });
      const result = await rawInvoke(input);
      const serialized = JSON.stringify(result ?? null);
      if (serialized.length > maxOutputBytes) {
        throw new Error(
          `Tool "${id}" output exceeds the ${maxOutputBytes}-byte limit and was rejected`,
        );
      }
      return result;
    },
  };
}
