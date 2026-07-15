import type { PluginContext } from './compile-context.js';

/**
 * Synthesize stream provenance metadata (RFC v2 section 20): one record per
 * component kind per plugin so runtime events carry stable plugin/component
 * provenance and policy-driven redaction fields.
 */
export function compileStreamMetadata(context: PluginContext): void {
  const { input, ir } = context;
  const pluginId = input.locked.id;
  const streaming = context.options.runtime?.streaming;
  if (streaming && !streaming.attachPluginProvenance) return;
  const redactionFields = (streaming?.redactToolArguments ?? true)
    ? ['tool-call.arguments']
    : undefined;

  const groups: Array<[string, ReadonlyArray<{ id: string; pluginId: string }>]> = [
    ['skill', ir.skills],
    ['command', ir.commands],
    ['sync-subagent', ir.syncSubagents],
    ['async-subagent', ir.asyncSubagents],
    ['mcp-server', ir.mcpServers],
  ];
  for (const [kind, components] of groups) {
    for (const component of components.filter((candidate) => candidate.pluginId === pluginId)) {
      ir.streamMetadata.push({
        id: `${component.id}:stream`,
        pluginId,
        componentId: component.id,
        namespace: [input.runtimeNamespace, kind],
        provenanceTags: {
          pluginId,
          componentId: component.id,
          contentDigest: input.locked.contentDigest,
        },
        redactionFields,
      });
    }
  }
  ir.streamMetadata.sort((a, b) => a.id.localeCompare(b.id));
}
