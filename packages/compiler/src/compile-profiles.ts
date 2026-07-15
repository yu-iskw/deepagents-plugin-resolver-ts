import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DiagnosticCodes,
  claudeProfileFileSchema,
  normalizeName,
  qualifiedComponentId,
  type ClaudeProfileFile,
  type CompiledHarnessProfileV2,
  type ProfileField,
} from '@deepagents-plugins/schema';

import { featureToggle, policyGate, type PluginContext } from './compile-context.js';

interface FieldGovernor {
  strippedCount: number;
  allowed(field: ProfileField, component: string): boolean;
}

function makeFieldGovernor(context: PluginContext): FieldGovernor {
  const governor: FieldGovernor = {
    strippedCount: 0,
    allowed(field: ProfileField, component: string): boolean {
      const decision = context.options.policy.evaluateProfileField({
        pluginId: context.input.locked.id,
        profile: context.input.locked.trustPolicy,
        contentDigest: context.input.locked.contentDigest,
        field,
      });
      if (decision.effect === 'allow') return true;
      governor.strippedCount += 1;
      context.diagnostics.add({
        code: DiagnosticCodes.ProfileFieldDenied,
        severity: 'warning',
        pluginId: context.input.locked.id,
        component: `${component}#${field}`,
        compatibility: 'blocked-by-policy',
        message: decision.reason,
        remediation: decision.remediation,
      });
      return false;
    },
  };
  return governor;
}

function governToolField(
  fragment: ClaudeProfileFile,
  governor: FieldGovernor,
  component: string,
  pluginPrefix: string,
  config: CompiledHarnessProfileV2['config'],
): void {
  if (fragment.toolDescriptionOverrides !== undefined) {
    const allowed: Record<string, string> = {};
    for (const [tool, description] of Object.entries(fragment.toolDescriptionOverrides)) {
      const field: ProfileField = tool.startsWith(pluginPrefix)
        ? 'overridePluginToolDescription'
        : 'overrideApplicationToolDescription';
      if (governor.allowed(field, component)) allowed[tool] = description;
    }
    if (Object.keys(allowed).length > 0) config.toolDescriptionOverrides = allowed;
  }
  if (fragment.excludedTools !== undefined) {
    const allowed = fragment.excludedTools.filter((tool) =>
      governor.allowed(
        tool.startsWith(pluginPrefix) ? 'excludePluginTool' : 'excludeApplicationTool',
        component,
      ),
    );
    if (allowed.length > 0) config.excludedTools = allowed;
  }
}

function governFragment(
  context: PluginContext,
  fragment: ClaudeProfileFile,
  component: string,
): { config: CompiledHarnessProfileV2['config']; stripped: boolean } {
  const governor = makeFieldGovernor(context);
  const config: CompiledHarnessProfileV2['config'] = {};
  if (
    fragment.baseSystemPrompt !== undefined &&
    governor.allowed('basePromptReplacement', component)
  ) {
    config.baseSystemPrompt = fragment.baseSystemPrompt;
  }
  if (fragment.systemPromptSuffix !== undefined && governor.allowed('promptSuffix', component)) {
    config.systemPromptSuffix = fragment.systemPromptSuffix;
  }
  governToolField(
    fragment,
    governor,
    component,
    `plugin.${context.input.runtimeNamespace}.`,
    config,
  );
  if (
    fragment.excludedMiddleware !== undefined &&
    governor.allowed('excludeMiddleware', component)
  ) {
    config.excludedMiddleware = fragment.excludedMiddleware;
  }
  if (
    fragment.generalPurposeSubagent !== undefined &&
    governor.allowed('generalPurposeSubagent', component)
  ) {
    config.generalPurposeSubagent = fragment.generalPurposeSubagent;
  }
  return { config, stripped: governor.strippedCount > 0 };
}

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
    const registrationKey = fragment.registrationKey ?? profileFileName.replace(/\.json$/, '');
    const { config, stripped } = governFragment(context, fragment, component);

    if (stripped) context.degraded = true;
    ir.harnessProfiles.push({
      id: qualifiedComponentId(input.runtimeNamespace, `profile-${normalizeName(registrationKey)}`),
      pluginId: input.locked.id,
      registrationKey,
      priority: fragment.priority ?? 0,
      config,
      compatibility: stripped ? 'partial' : 'translated',
    });
  }
}
