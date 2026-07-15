import type { CompatibilityDiagnosticV2, CompiledPluginSetV2 } from '@deepagents-plugins/schema';

interface ReportSection {
  compatibility: string;
  heading: string;
  detail?: string;
}

function pluginSections(ir: CompiledPluginSetV2, pluginId: string): ReportSection[] {
  const own = <T extends { pluginId: string }>(entries: readonly T[]): T[] =>
    entries.filter((entry) => entry.pluginId === pluginId);
  const sections: ReportSection[] = [];
  for (const skill of own(ir.skills)) {
    sections.push({ compatibility: skill.compatibility, heading: `skills/${skill.originalName}` });
  }
  for (const subagent of own(ir.syncSubagents)) {
    sections.push({
      compatibility: subagent.compatibility,
      heading: `agents/${subagent.name}`,
      detail: `-> synchronous Deep Agents subagent "${subagent.id}"`,
    });
  }
  for (const subagent of own(ir.asyncSubagents)) {
    sections.push({
      compatibility: subagent.compatibility,
      heading: `agents/${subagent.name}`,
      detail: `-> async Agent Protocol subagent "${subagent.id}" (${subagent.transport})`,
    });
  }
  for (const memory of own(ir.memorySources)) {
    sections.push({
      compatibility: memory.compatibility,
      heading: memory.path,
      detail: `-> ${memory.access} ${memory.scope}-scoped memory source`,
    });
  }
  for (const profile of own(ir.harnessProfiles)) {
    sections.push({
      compatibility: profile.compatibility,
      heading: `profiles/${profile.registrationKey}`,
      detail: '-> harness profile fragment (governed fields only)',
    });
  }
  for (const rubric of own(ir.rubricTemplates)) {
    sections.push({
      compatibility: rubric.compatibility,
      heading: `rubrics/${rubric.name}`,
      detail: '-> rubric template (host-governed activation)',
    });
  }
  for (const policy of own(ir.interpreterPolicies)) {
    sections.push({
      compatibility: policy.compatibility,
      heading: 'interpreter.json',
      detail: `-> interpreter policy (enabled: ${policy.enabled})`,
    });
  }
  for (const command of own(ir.commands)) {
    sections.push({ compatibility: command.compatibility, heading: `commands/${command.name}` });
  }
  for (const server of own(ir.mcpServers)) {
    sections.push({
      compatibility: server.compatibility,
      heading: `.mcp.json#${server.id.split(':').pop() ?? server.id}`,
      detail: `-> ${server.transport} MCP descriptor with host authorization wrapper`,
    });
  }
  const reported = new Set([
    'unsupported',
    'blocked-by-policy',
    'runtime-unavailable',
    'requires-adapter',
    'requires-approval',
  ]);
  for (const diagnostic of ir.diagnostics.filter(
    (entry: CompatibilityDiagnosticV2) =>
      entry.pluginId === pluginId && reported.has(entry.compatibility),
  )) {
    sections.push({
      compatibility: diagnostic.compatibility,
      heading: diagnostic.component ?? 'plugin',
      detail: `-> ${diagnostic.message}`,
    });
  }
  return sections;
}

/** Human-readable compatibility report (RFC v2 Appendix C). */
export function renderCompatibilityReport(ir: CompiledPluginSetV2): string {
  const lines: string[] = [];
  for (const plugin of ir.plugins) {
    lines.push(
      `Plugin: ${plugin.id}${plugin.version ? `@${plugin.version}` : ''}`,
      `Digest: ${plugin.contentDigest}`,
      '',
    );
    for (const section of pluginSections(ir, plugin.id)) {
      lines.push(`[${section.compatibility.toUpperCase()}]`, `  ${section.heading}`);
      if (section.detail) lines.push(`  ${section.detail}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/** Structured diagnostic rendering for the CLI (RFC section 27). */
export function renderDiagnostic(diagnostic: CompatibilityDiagnosticV2): string {
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
export function renderSarif(ir: CompiledPluginSetV2): Record<string, unknown> {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: ir.compiler.name,
            version: ir.compiler.version,
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
