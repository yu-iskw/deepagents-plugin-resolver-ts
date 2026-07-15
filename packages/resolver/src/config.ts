import fs from 'node:fs/promises';

import {
  ExitCodes,
  PluginResolutionError,
  pluginApprovalSchema,
  pluginPolicyDocumentSchema,
  pluginSetManifestSchema,
  type PluginApproval,
  type PluginPolicyDocument,
  type PluginSetManifest,
} from '@deepagents-plugins/schema';
import { parse as parseYaml } from 'yaml';

export const MANIFEST_NAME = 'deepagents.plugins.yaml';

/** Safe YAML load: core schema only, no custom tags, no anchors bombs. */
function loadYaml(text: string, label: string): unknown {
  try {
    return parseYaml(text, { schema: 'core', maxAliasCount: 100 });
  } catch (error) {
    throw new PluginResolutionError(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
      ExitCodes.ConfigurationError,
    );
  }
}

export async function loadPluginSetManifest(filePath: string): Promise<PluginSetManifest> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch {
    throw new PluginResolutionError(
      `Plugin manifest not found at ${filePath}`,
      ExitCodes.ConfigurationError,
      `Run "deepagents-plugins init" to create ${MANIFEST_NAME}.`,
    );
  }
  const parsed = pluginSetManifestSchema.safeParse(loadYaml(text, filePath));
  if (!parsed.success) {
    throw new PluginResolutionError(
      `Invalid plugin manifest ${filePath}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
      ExitCodes.ConfigurationError,
    );
  }
  return parsed.data;
}

export async function loadPolicyDocument(filePath: string): Promise<PluginPolicyDocument> {
  const text = await fs.readFile(filePath, 'utf8');
  const parsed = pluginPolicyDocumentSchema.safeParse(loadYaml(text, filePath));
  if (!parsed.success) {
    throw new PluginResolutionError(
      `Invalid policy document ${filePath}: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
      ExitCodes.ConfigurationError,
    );
  }
  return parsed.data;
}

export async function loadApprovals(filePaths: string[]): Promise<PluginApproval[]> {
  const approvals: PluginApproval[] = [];
  for (const filePath of filePaths) {
    const text = await fs.readFile(filePath, 'utf8');
    const parsed = pluginApprovalSchema.safeParse(loadYaml(text, filePath));
    if (!parsed.success) {
      throw new PluginResolutionError(
        `Invalid approval record ${filePath}: ${parsed.error.issues[0]?.message ?? 'schema error'}`,
        ExitCodes.ConfigurationError,
      );
    }
    approvals.push(parsed.data);
  }
  return approvals;
}
