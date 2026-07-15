import { z } from 'zod';

import type { CompiledPluginSetV2 } from './ir.js';

/** Deep Agents runtime capability model (RFC v2 section 11). */

export const deepAgentsCapabilitiesSchema = z.object({
  version: z.string().optional(),
  skills: z.boolean(),
  memory: z.boolean(),
  harnessProfiles: z.boolean(),
  syncSubagents: z.boolean(),
  asyncSubagents: z.boolean(),
  interruptOn: z.boolean(),
  permissions: z.boolean(),
  streamTransformers: z.boolean(),
  interpreter: z.object({
    available: z.boolean(),
    implementation: z.string().optional(),
    ptc: z.boolean(),
    dynamicSubagents: z.boolean(),
  }),
  rubric: z.object({
    available: z.boolean(),
    implementation: z.string().optional(),
  }),
  eventStreaming: z.object({
    langGraphV2: z.boolean(),
    subagentProjection: z.boolean(),
  }),
});
export type DeepAgentsCapabilities = z.infer<typeof deepAgentsCapabilitiesSchema>;

/** Capability requirement derived from a compiled plugin set. */
export interface CapabilityRequirement {
  capability: string;
  /** Required capabilities fail loading; optional ones disable with a warning. */
  required: boolean;
  componentIds: string[];
}

/** All-false capability map, used when no Deep Agents runtime is detected. */
export function emptyDeepAgentsCapabilities(): DeepAgentsCapabilities {
  return {
    skills: false,
    memory: false,
    harnessProfiles: false,
    syncSubagents: false,
    asyncSubagents: false,
    interruptOn: false,
    permissions: false,
    streamTransformers: false,
    interpreter: { available: false, ptc: false, dynamicSubagents: false },
    rubric: { available: false },
    eventStreaming: { langGraphV2: false, subagentProjection: false },
  };
}

/**
 * Map IR component arrays to the Deep Agents capabilities they need
 * (RFC section 11). Skills and sync subagents are required; adapter-gated
 * features (interpreter, async subagents, rubrics) and overlays are optional.
 */
export function requiredCapabilitiesFromIr(ir: CompiledPluginSetV2): CapabilityRequirement[] {
  const requirements: CapabilityRequirement[] = [];
  const push = (
    capability: string,
    required: boolean,
    components: ReadonlyArray<{ id: string }>,
  ): void => {
    if (components.length === 0) return;
    requirements.push({
      capability,
      required,
      componentIds: components.map((component) => component.id).sort(),
    });
  };

  push('skills', true, ir.skills);
  push('syncSubagents', true, ir.syncSubagents);
  push('memory', false, ir.memorySources);
  push('harnessProfiles', false, ir.harnessProfiles);
  push('interruptOn', false, ir.hitlPolicies);
  push('permissions', false, ir.permissions);
  push('streamTransformers', false, ir.streamMetadata);
  push('asyncSubagents', false, ir.asyncSubagents);
  push('interpreter', false, ir.interpreterPolicies);
  push('rubric', false, ir.rubricTemplates);
  return requirements.sort((a, b) => a.capability.localeCompare(b.capability));
}

/** Look up a capability key from `requiredCapabilitiesFromIr` in a detected map. */
export function capabilityAvailable(
  capabilities: DeepAgentsCapabilities,
  capability: string,
): boolean {
  switch (capability) {
    case 'skills':
      return capabilities.skills;
    case 'memory':
      return capabilities.memory;
    case 'harnessProfiles':
      return capabilities.harnessProfiles;
    case 'syncSubagents':
      return capabilities.syncSubagents;
    case 'asyncSubagents':
      return capabilities.asyncSubagents;
    case 'interruptOn':
      return capabilities.interruptOn;
    case 'permissions':
      return capabilities.permissions;
    case 'streamTransformers':
      return capabilities.streamTransformers;
    case 'interpreter':
      return capabilities.interpreter.available;
    case 'rubric':
      return capabilities.rubric.available;
    default:
      return false;
  }
}
