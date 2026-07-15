import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  MEMORY_DIR,
  memoryFrontmatterSchema,
  qualifiedComponentId,
  normalizeName,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, stageFile, type PluginContext } from './compile-context.js';
import { parseFrontmatter } from './frontmatter.js';

/**
 * Compile plugin memory directories into read-only memory sources
 * (RFC v2 section 13). Writable requests are denied by default policy;
 * persistent stores remain application-owned.
 */
export async function compileMemory(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  const pluginId = input.locked.id;
  const feature = featureToggle(context, 'memory');
  if (feature === 'disabled') return;

  for (const relativePath of inspection.memoryFiles) {
    const component = `memory/${relativePath}`;
    const absolute = path.join(input.rootDir, 'memory', relativePath);
    const text = await fs.readFile(absolute, 'utf8');
    const { frontmatter } = parseFrontmatter(text);
    const parsed = memoryFrontmatterSchema.safeParse(frontmatter);
    const meta = parsed.success ? parsed.data : {};

    // Writable requests never fail the build; they degrade to read-only with
    // an explicit DAP2307 record (RFC 13: persistent stores are app-owned).
    const wantsWrite = meta.access === 'read-write';
    const writableDecision =
      wantsWrite && feature !== 'static-only'
        ? context.options.policy.evaluate({
            pluginId,
            profile: input.locked.trustPolicy,
            capability: 'memory.writable',
            contentDigest: input.locked.contentDigest,
          })
        : undefined;
    if (wantsWrite && writableDecision?.effect !== 'allow') {
      context.degraded = true;
      diagnostics.add({
        code: DiagnosticCodes.MemoryWriteDenied,
        severity: 'warning',
        pluginId,
        component,
        compatibility: 'blocked-by-policy',
        message:
          'Plugin requested writable memory; compiled read-only. Persistent stores are application-owned (RFC 13).',
        remediation:
          'Keep plugin memory read-only, or allow "memory.writable" for this trust policy.',
        sourceLocation: { path: component },
      });
    }
    if (!policyGate(context, 'memory.static', component)) continue;

    const bundlePath = `${MEMORY_DIR}/${input.runtimeNamespace}/${relativePath}`;
    stageFile(context, absolute, bundlePath);

    ir.memorySources.push({
      id: qualifiedComponentId(
        input.runtimeNamespace,
        normalizeName(relativePath.replace(/\.md$/, '').replaceAll('/', '-')),
      ),
      pluginId,
      path: bundlePath,
      kind: meta.kind ?? 'static-instructions',
      loadMode: meta.loadMode ?? 'on-demand',
      scope: meta.scope ?? 'agent',
      access: 'read-only',
      compatibility: 'translated',
    });
  }
}
