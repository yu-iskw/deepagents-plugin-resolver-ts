import { qualifiedToolId } from '@deepagents-plugins/schema';

import type { PluginContext } from './compile-context.js';

const HIGH_RISK_PATTERN = /write|delete|remove|exec|run|push|deploy|create|update|upload|admin/i;

/**
 * Derive human-in-the-loop and permission recommendations (RFC v2 sections
 * 19 and 25). Recommendations only: applications merge them with mandatory
 * interrupts, and plugins can never remove application interrupts.
 */
export function compileHitl(context: PluginContext): void {
  const { input, ir } = context;
  const pluginId = input.locked.id;

  const toolRefs = new Map<string, 'high' | 'critical'>();
  for (const server of ir.mcpServers.filter((candidate) => candidate.pluginId === pluginId)) {
    for (const tool of server.toolAllowlist ?? []) {
      const risk = HIGH_RISK_PATTERN.test(tool) ? 'high' : undefined;
      if (risk) toolRefs.set(qualifiedToolId(input.runtimeNamespace, tool), risk);
      ir.permissions.push({
        id: `${server.id}:permission:${tool}`,
        pluginId,
        toolRef: qualifiedToolId(input.runtimeNamespace, tool),
        permission: 'invoke',
        rationale: `MCP tool exposed by ${server.id}`,
      });
    }
  }
  for (const asset of ir.executableAssets.filter((candidate) => candidate.pluginId === pluginId)) {
    toolRefs.set(asset.id, 'critical');
    ir.permissions.push({
      id: `${asset.id}:permission:execute`,
      pluginId,
      toolRef: asset.id,
      permission: 'execute',
      rationale: 'Sandboxed executable asset',
    });
  }

  for (const [toolRef, risk] of [...toolRefs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    ir.hitlPolicies.push({
      id: `${toolRef}:hitl`,
      pluginId,
      toolRef,
      risk,
      recommendedDecisions: risk === 'critical' ? ['approve', 'reject'] : ['approve', 'edit', 'reject'],
    });
  }
  ir.permissions.sort((a, b) => a.id.localeCompare(b.id));
}
