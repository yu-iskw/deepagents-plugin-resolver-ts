import type { CompatibilityDiagnosticV1, CompiledPluginSetV1 } from '@deepagents-plugins/schema';

/** Human-readable compatibility report (RFC section 34). */
export function renderCompatibilityReport(ir: CompiledPluginSetV1): string {
  const lines: string[] = [];
  for (const plugin of ir.plugins) {
    lines.push(
      `Plugin: ${plugin.id}${plugin.version ? `@${plugin.version}` : ''}`,
      `Digest: ${plugin.contentDigest}`,
      '',
    );
    for (const skill of ir.skills.filter((entry) => entry.pluginId === plugin.id)) {
      lines.push(`[${skill.compatibility.toUpperCase()}]`, `  skills/${skill.originalName}`, '');
    }
    for (const subagent of ir.subagents.filter((entry) => entry.pluginId === plugin.id)) {
      lines.push(
        `[${subagent.compatibility.toUpperCase()}]`,
        `  agents/${subagent.name}`,
        `  -> Deep Agents subagent "${subagent.id}"`,
        '',
      );
    }
    for (const command of ir.commands.filter((entry) => entry.pluginId === plugin.id)) {
      lines.push(`[${command.compatibility.toUpperCase()}]`, `  commands/${command.name}`, '');
    }
    for (const server of ir.mcpServers.filter((entry) => entry.pluginId === plugin.id)) {
      lines.push(
        `[${server.compatibility.toUpperCase()}]`,
        `  .mcp.json#${server.id.split(':').pop() ?? server.id}`,
        `  -> ${server.transport} MCP descriptor with host authorization wrapper`,
        '',
      );
    }
    for (const diagnostic of ir.diagnostics.filter(
      (entry: CompatibilityDiagnosticV1) =>
        entry.pluginId === plugin.id &&
        (entry.compatibility === 'unsupported' || entry.compatibility === 'blocked-by-policy'),
    )) {
      lines.push(
        `[${diagnostic.compatibility.toUpperCase()}]`,
        `  ${diagnostic.component ?? 'plugin'}`,
        `  -> ${diagnostic.message}`,
        '',
      );
    }
  }
  return lines.join('\n');
}

/** Structured diagnostic rendering for the CLI (RFC section 27). */
export function renderDiagnostic(diagnostic: CompatibilityDiagnosticV1): string {
  const lines = [
    `${diagnostic.code} [${diagnostic.compatibility}]`,
    `Plugin: ${diagnostic.pluginId}`,
  ];
  if (diagnostic.component) lines.push(`Component: ${diagnostic.component}`);
  if (diagnostic.sourceLocation) lines.push(`Path: ${diagnostic.sourceLocation.path}`);
  lines.push('', diagnostic.message);
  if (diagnostic.remediation) lines.push('', `Remediation: ${diagnostic.remediation}`);
  return lines.join('\n');
}

/** SARIF 2.1.0 export of diagnostics (RFC 24.2 --sarif). */
export function renderSarif(ir: CompiledPluginSetV1): Record<string, unknown> {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: ir.generatedBy.name,
            version: ir.generatedBy.version,
            rules: [],
          },
        },
        results: ir.diagnostics.map((diagnostic) => ({
          ruleId: diagnostic.code,
          level: diagnostic.severity === 'info' ? 'note' : diagnostic.severity,
          message: { text: `${diagnostic.pluginId}: ${diagnostic.message}` },
          locations: diagnostic.sourceLocation
            ? [
                {
                  physicalLocation: {
                    artifactLocation: { uri: diagnostic.sourceLocation.path },
                  },
                },
              ]
            : [],
        })),
      },
    ],
  };
}
