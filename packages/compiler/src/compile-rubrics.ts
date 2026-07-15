import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  RUBRICS_DIR,
  claudeRubricFileSchema,
  normalizeName,
  qualifiedComponentId,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, stageFile, type PluginContext } from './compile-context.js';

const MAX_RUBRIC_ITERATIONS = 5;

/**
 * Compile rubric templates as inert data (RFC v2 section 23). Templates-only
 * by default: runtime activation is host-governed and adapter-gated, and the
 * iteration cap is clamped at compile time.
 */
export async function compileRubrics(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  const feature = featureToggle(context, 'rubrics');
  if (feature === 'disabled') return;

  for (const rubricFileName of inspection.rubricFiles) {
    const component = `rubrics/${rubricFileName}`;
    if (!policyGate(context, 'rubrics', component)) continue;

    const absolute = path.join(input.rootDir, 'rubrics', rubricFileName);
    const raw: unknown = JSON.parse(await fs.readFile(absolute, 'utf8'));
    const parsed = claudeRubricFileSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.add({
        code: DiagnosticCodes.ManifestInvalid,
        severity: 'error',
        pluginId: input.locked.id,
        component,
        compatibility: 'unsupported',
        message: `Rubric template is invalid: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
      });
      continue;
    }

    const name = normalizeName(parsed.data.name ?? rubricFileName.replace(/\.json$/, ''));
    stageFile(context, absolute, `${RUBRICS_DIR}/${input.runtimeNamespace}/${rubricFileName}`);
    diagnostics.add({
      code: DiagnosticCodes.RequiresAdapter,
      severity: 'info',
      pluginId: input.locked.id,
      component,
      compatibility: 'requires-adapter',
      message:
        'Rubric templates are compiled as data only; activation requires an application-registered rubric adapter.',
    });
    ir.rubricTemplates.push({
      id: qualifiedComponentId(input.runtimeNamespace, `rubric-${name}`),
      pluginId: input.locked.id,
      name,
      criteria: parsed.data.criteria,
      recommendedGraderModel: parsed.data.recommendedGraderModel,
      maxIterations: Math.min(
        parsed.data.maxIterations ?? MAX_RUBRIC_ITERATIONS,
        MAX_RUBRIC_ITERATIONS,
      ),
      dataPolicy: { allowExternalGrader: parsed.data.dataPolicy?.allowExternalGrader ?? false },
      compatibility: 'requires-adapter',
    });
  }
}
