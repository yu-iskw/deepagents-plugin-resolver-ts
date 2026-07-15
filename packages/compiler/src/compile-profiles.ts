import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  claudeProfileFileSchema,
  normalizeName,
  qualifiedComponentId,
  type CompiledHarnessProfileV2,
  type ProfileField,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, type PluginContext } from './compile-context.js';

/**
 * Compile plugin harness-profile fragments with field governance
 * (RFC v2 section 14). Denied fields are stripped with DAP2308 diagnostics;
 * profiles are model overlays, never authorization.
 */
export async function compileProfiles(context: PluginContext): Promise<void> {
  const { input, inspection, ir } = context;
  if (featureToggle(context, 'profiles') === 'disabled') return;

  for (const profileFileName of inspection.profileFiles) {
    const component = `profiles/${profileFileName}`;
    if (!policyGate(context, 'profiles.fragment', component)) continue;

    const raw: unknown = JSON.parse(
      await fs.readFile(path.join(input.rootDir, 'profiles', profileFileName), 'utf8'),
    );
    const parsed = claudeProfileFileSchema.safeParse(raw);
    if (!parsed.success) {
      context.diagnostics.add({
        code: DiagnosticCodes.ManifestInvalid,
        severity: 'error',
        pluginId: input.locked.id,
        component,
        compatibility: 'unsupported',
        message: `Harness profile fragment is invalid: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
      });
      continue;
    }
    const fragment = parsed.data;
    const registrationKey =
      fragment.registrationKey ?? profileFileName.replace(/\.json$/, '');
    const config: CompiledHarnessProfileV2['config'] = {};
    let stripped = false;

    const fieldAllowed = (field: ProfileField): boolean => {
      const decision = context.options.policy.evaluateProfileField({
        pluginId: input.locked.id,
        profile: input.locked.trustPolicy,
        contentDigest: input.locked.contentDigest,
        field,
      });
      if (decision.effect === 'allow') return true;
      stripped = true;
      context.diagnostics.add({
        code: DiagnosticCodes.ProfileFieldDenied,
        severity: 'warning',
        pluginId: input.locked.id,
        component: `${component}#${field}`,
        compatibility: 'blocked-by-policy',
        message: decision.reason,
        remediation: decision.remediation,
      });
      return false;
    };

    if (fragment.baseSystemPrompt !== undefined && fieldAllowed('basePromptReplacement')) {
      config.baseSystemPrompt = fragment.baseSystemPrompt;
    }
    if (fragment.systemPromptSuffix !== undefined && fieldAllowed('promptSuffix')) {
      config.systemPromptSuffix = fragment.systemPromptSuffix;
    }
    if (fragment.toolDescriptionOverrides !== undefined) {
      const pluginPrefix = `plugin.${input.runtimeNamespace}.`;
      const allowed: Record<string, string> = {};
      for (const [tool, description] of Object.entries(fragment.toolDescriptionOverrides)) {
        const field: ProfileField = tool.startsWith(pluginPrefix)
          ? 'overridePluginToolDescription'
          : 'overrideApplicationToolDescription';
        if (fieldAllowed(field)) allowed[tool] = description;
      }
      if (Object.keys(allowed).length > 0) config.toolDescriptionOverrides = allowed;
    }
    if (fragment.excludedTools !== undefined) {
      const pluginPrefix = `plugin.${input.runtimeNamespace}.`;
      const allowed = fragment.excludedTools.filter((tool) =>
        fieldAllowed(
          tool.startsWith(pluginPrefix) ? 'excludePluginTool' : 'excludeApplicationTool',
        ),
      );
      if (allowed.length > 0) config.excludedTools = allowed;
    }
    if (fragment.excludedMiddleware !== undefined && fieldAllowed('excludeMiddleware')) {
      config.excludedMiddleware = fragment.excludedMiddleware;
    }
    if (fragment.generalPurposeSubagent !== undefined && fieldAllowed('generalPurposeSubagent')) {
      config.generalPurposeSubagent = fragment.generalPurposeSubagent;
    }

    if (stripped) context.degraded = true;
    ir.harnessProfiles.push({
      id: qualifiedComponentId(
        input.runtimeNamespace,
        `profile-${normalizeName(registrationKey)}`,
      ),
      pluginId: input.locked.id,
      registrationKey,
      priority: fragment.priority ?? 0,
      config,
      compatibility: stripped ? 'partial' : 'translated',
    });
  }
}
