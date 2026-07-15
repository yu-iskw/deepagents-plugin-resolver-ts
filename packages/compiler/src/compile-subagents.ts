import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  agentFrontmatterSchema,
  normalizeName,
  qualifiedComponentId,
  type AgentFrontmatter,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, type PluginContext } from './compile-context.js';
import { normalizeToolList, parseFrontmatter } from './frontmatter.js';

/**
 * Compile agent Markdown into synchronous subagents (RFC v2 section 15).
 * Agents declaring an Agent Protocol endpoint or `async: true` become async
 * subagent descriptors (section 17), gated on the endpoint allowlist and
 * activated only through an application-registered transport.
 */
export async function compileSubagents(context: PluginContext): Promise<void> {
  const { input, inspection, diagnostics } = context;
  for (const agentFileName of inspection.agentFiles) {
    const component = `agents/${agentFileName}`;
    const text = await fs.readFile(path.join(input.rootDir, 'agents', agentFileName), 'utf8');
    const { frontmatter, body } = parseFrontmatter(text);
    const parsed = agentFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
      diagnostics.add({
        code: DiagnosticCodes.ManifestInvalid,
        severity: 'error',
        pluginId: input.locked.id,
        component,
        compatibility: 'unsupported',
        message: `Agent frontmatter invalid: ${parsed.error.issues[0]?.message ?? 'missing description'}`,
        sourceLocation: { path: component },
      });
      continue;
    }

    const isAsync = parsed.data.async === true || parsed.data.endpoint !== undefined;
    if (isAsync) {
      compileAsyncSubagent(context, component, agentFileName, parsed.data);
      continue;
    }

    if (featureToggle(context, 'syncSubagents') === 'disabled') continue;
    if (!policyGate(context, 'subagents', component)) continue;
    const name = normalizeName(parsed.data.name ?? agentFileName.replace(/\.md$/, ''));
    const memoryRefs = normalizeToolList(parsed.data.memory) ?? [];
    context.ir.syncSubagents.push({
      id: qualifiedComponentId(input.runtimeNamespace, name),
      pluginId: input.locked.id,
      name,
      description: parsed.data.description,
      systemPrompt: body.trim(),
      modelRef: parsed.data.model ? { requested: parsed.data.model, advisory: true } : undefined,
      toolRefs: normalizeToolList(parsed.data.tools) ?? [],
      skillRefs: context.ir.skills
        .filter((skill) => skill.pluginId === input.locked.id)
        .map((skill) => skill.id),
      memoryRefs: memoryRefs.map((ref) =>
        qualifiedComponentId(input.runtimeNamespace, normalizeName(ref)),
      ),
      middlewareAdapterRefs: [],
      compatibility: 'translated',
    });
  }
}

function compileAsyncSubagent(
  context: PluginContext,
  component: string,
  agentFileName: string,
  frontmatter: AgentFrontmatter,
): void {
  const { input, diagnostics } = context;
  if (featureToggle(context, 'asyncSubagents') === 'disabled') return;
  if (!policyGate(context, 'asyncSubagents', component)) return;

  const endpoint = frontmatter.endpoint;
  const allowedHosts = context.options.runtime?.asyncSubagents.allowedHosts ?? [];
  if (endpoint !== undefined) {
    let host: string | undefined;
    try {
      host = new URL(endpoint).hostname;
    } catch {
      host = undefined;
    }
    if (host === undefined || !allowedHosts.includes(host)) {
      context.blocked = true;
      diagnostics.add({
        code: DiagnosticCodes.PolicyDenied,
        severity: 'error',
        pluginId: input.locked.id,
        component,
        compatibility: 'blocked-by-policy',
        message: `Async subagent endpoint "${endpoint}" is not in runtime.asyncSubagents.allowedHosts.`,
        remediation:
          'Add the Agent Protocol host to runtime.asyncSubagents.allowedHosts in the project manifest.',
      });
      return;
    }
  }

  const name = normalizeName(frontmatter.name ?? agentFileName.replace(/\.md$/, ''));
  context.degraded = true;
  diagnostics.add({
    code: DiagnosticCodes.RequiresAdapter,
    severity: 'warning',
    pluginId: input.locked.id,
    component,
    compatibility: 'requires-adapter',
    message:
      'Async subagents activate only through an application-registered Agent Protocol transport.',
    remediation:
      'Register an async transport adapter in createDeepAgentsContributions, or remove the endpoint.',
  });
  context.ir.asyncSubagents.push({
    id: qualifiedComponentId(input.runtimeNamespace, name),
    pluginId: input.locked.id,
    name,
    description: frontmatter.description,
    graphId: name,
    transport: endpoint === undefined ? 'co-deployed' : 'http',
    endpointRef: endpoint,
    allowedOperations: ['launch', 'status', 'cancel'],
    compatibility: 'requires-adapter',
  });
}
