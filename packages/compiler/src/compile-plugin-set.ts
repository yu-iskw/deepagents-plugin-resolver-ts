import fs from 'node:fs/promises';
import path from 'node:path';

import { translateClaudeHook } from '@deepagents-plugins/adapter-hooks';
import { translateMcpServer } from '@deepagents-plugins/adapter-mcp';
import {
  COMPILER_PROFILE,
  DiagnosticCodes,
  DiagnosticCollector,
  ExitCodes,
  IR_SCHEMA_VERSION,
  PluginResolutionError,
  claudeHooksFileSchema,
  commandFrontmatterSchema,
  mcpConfigFileSchema,
  normalizeName,
  qualifiedComponentId,
  sha256DigestOfFile,
  sha256DigestOfJson,
  skillFrontmatterSchema,
  type CompatibilityDiagnosticV2,
  type CompiledPluginSetV2,
} from '@deepagents-plugins/schema';

import {
  featureToggle,
  policyGate,
  stageDirectory,
  type CompatibilityMode,
  type CompileOptions,
  type PluginCompileInput,
  type PluginContext,
} from './compile-context.js';
import { compileHitl } from './compile-hitl.js';
import { compileInterpreter } from './compile-interpreter.js';
import { compileMemory } from './compile-memory.js';
import { compileProfiles } from './compile-profiles.js';
import { compileRubrics } from './compile-rubrics.js';
import { compileSubagents } from './compile-subagents.js';
import { findClaudeVariables, normalizeToolList, parseFrontmatter } from './frontmatter.js';
import { inspectPlugin } from './inspect.js';
import { compileStreamMetadata } from './stream-metadata.js';

export type { CompatibilityMode, CompileOptions, PluginCompileInput } from './compile-context.js';

export interface CompileResult {
  ir: CompiledPluginSetV2;
  diagnostics: readonly CompatibilityDiagnosticV2[];
  /** Files to copy into the bundle: bundle-relative path -> absolute source path. */
  filesToCopy: Map<string, string>;
  /** Inline JSON documents written by the bundler (no fake data: URIs). */
  inlineJsonFiles: Map<string, unknown>;
}

const COMPILER_IDENTITY = { name: '@deepagents-plugins/compiler', version: '0.2.0' };
const BLOCKED_BY_POLICY = 'blocked-by-policy' as const;
const SANDBOX_PROFILE_DENY = 'default-deny';

/**
 * Translate resolved, policy-scoped plugins into the portable IR v2
 * (RFC v2 section 10). Pure with respect to the output directory:
 * materialization happens separately in the bundler.
 */
export async function compilePluginSet(
  inputs: PluginCompileInput[],
  options: CompileOptions,
): Promise<CompileResult> {
  const diagnostics = new DiagnosticCollector();
  const filesToCopy = new Map<string, string>();
  const inlineJsonFiles = new Map<string, unknown>();
  const identity = options.compiler ?? COMPILER_IDENTITY;
  const ir: CompiledPluginSetV2 = {
    schemaVersion: IR_SCHEMA_VERSION,
    compiler: { ...identity, compilerProfile: COMPILER_PROFILE },
    pluginSetDigest: options.pluginSetDigest,
    plugins: [],
    skills: [],
    memorySources: [],
    commands: [],
    syncSubagents: [],
    asyncSubagents: [],
    mcpServers: [],
    hooks: [],
    harnessProfiles: [],
    hitlPolicies: [],
    permissions: [],
    interpreterPolicies: [],
    rubricTemplates: [],
    streamMetadata: [],
    assets: [],
    executableAssets: [],
    diagnostics: [],
    provenance: [],
  };

  for (const input of [...inputs].sort((a, b) => a.locked.id.localeCompare(b.locked.id))) {
    const context: PluginContext = {
      input,
      inspection: await inspectPlugin(input.rootDir),
      ir,
      diagnostics,
      filesToCopy,
      inlineJsonFiles,
      options,
      capabilities: new Set<string>(),
      degraded: false,
      blocked: false,
    };
    gateSourceTrust(context);
    if (context.blocked) {
      // Source-trust denial is a hard security constraint: never stage content
      // for a denied source, including under --compatibility permissive.
      continue;
    }
    await compileSkills(context);
    await compileCommands(context);
    await compileSubagents(context);
    await compileMemory(context);
    await compileProfiles(context);
    await compileMcpServers(context);
    await compileHooks(context);
    await compileInterpreter(context);
    await compileRubrics(context);
    compileAdvisoryComponents(context);
    await compileExecutableAssets(context);
    await compileUnknownComponents(context);
    compileHitl(context);
    compileStreamMetadata(context);
    recordPluginAndProvenance(context);
  }

  ir.diagnostics = [...diagnostics.all];
  enforceCompatibilityMode(ir.diagnostics, options.compatibilityMode ?? 'standard');
  return { ir, diagnostics: diagnostics.all, filesToCopy, inlineJsonFiles };
}

const DEGRADED_STATUSES = new Set([
  'partial',
  'unsupported',
  BLOCKED_BY_POLICY,
  'runtime-unavailable',
  'requires-adapter',
  'requires-approval',
]);

function enforceCompatibilityMode(
  diagnostics: readonly CompatibilityDiagnosticV2[],
  mode: CompatibilityMode,
): void {
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  const hasPolicyDenials = diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === 'error' && diagnostic.compatibility === BLOCKED_BY_POLICY,
  );
  const hasDegraded = diagnostics.some((diagnostic) =>
    DEGRADED_STATUSES.has(diagnostic.compatibility),
  );

  // Permissive mode reports but does not fail; denied components are still
  // excluded from the IR, so the hard security constraint is never bypassed.
  if (mode === 'permissive') return;
  if (hasPolicyDenials) {
    throw new PluginResolutionError(
      'Policy denied one or more plugin components',
      ExitCodes.PolicyDenial,
      'Run "deepagents-plugins audit" for details, then adjust the plugin set or policy.',
    );
  }
  if (hasErrors) {
    throw new PluginResolutionError(
      'Compilation produced error diagnostics',
      ExitCodes.CompatibilityFailure,
    );
  }
  if (mode === 'strict' && hasDegraded) {
    throw new PluginResolutionError(
      'Strict compatibility mode: degraded components present (partial, unsupported, policy-blocked, runtime-unavailable, requires-adapter, or requires-approval)',
      ExitCodes.CompatibilityFailure,
      'Use --compatibility standard to accept degraded components, or remove them from the plugin set.',
    );
  }
}

function gateSourceTrust(context: PluginContext): void {
  const { locked, requested } = context.input;
  if (!requested) {
    context.blocked = true;
    context.diagnostics.add({
      code: DiagnosticCodes.PolicyDenied,
      severity: 'error',
      pluginId: locked.id,
      component: 'source',
      compatibility: BLOCKED_BY_POLICY,
      message:
        'Compile input is missing the requested source specification; refusing to compile the plugin.',
      remediation:
        'Pass the original PluginSourceSpec from resolution (ResolvedPluginArtifact.requested).',
    });
    return;
  }
  const decision = context.options.policy.evaluateSource(requested, locked.trustPolicy);
  if (decision.effect === 'allow') return;
  context.blocked = true;
  context.diagnostics.add({
    code:
      decision.effect === 'deny'
        ? DiagnosticCodes.PolicyDenied
        : DiagnosticCodes.PolicyReviewRequired,
    severity: decision.effect === 'deny' ? 'error' : 'warning',
    pluginId: locked.id,
    component: `source/${requested.type}`,
    compatibility: BLOCKED_BY_POLICY,
    message: decision.reason,
    remediation: decision.remediation,
  });
}

async function compileSkills(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  const pluginId = input.locked.id;
  if (featureToggle(context, 'skills') === 'disabled') return;
  for (const skillDirName of inspection.skillDirs) {
    const component = `skills/${skillDirName}`;
    if (!policyGate(context, 'skills', component)) continue;

    const skillDir = path.join(input.rootDir, 'skills', skillDirName);
    const text = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    const { frontmatter, body } = parseFrontmatter(text);
    const parsed = skillFrontmatterSchema.safeParse(frontmatter);
    if (!parsed.success) {
      diagnostics.add({
        code: DiagnosticCodes.ManifestInvalid,
        severity: 'error',
        pluginId,
        component,
        compatibility: 'unsupported',
        message: `SKILL.md frontmatter invalid: ${parsed.error.issues[0]?.message ?? 'missing description'}`,
        remediation: 'Add at least a "description" field to the skill frontmatter.',
        sourceLocation: { path: `${component}/SKILL.md` },
      });
      continue;
    }

    const originalName = parsed.data.name ?? skillDirName;
    const runtimeName = normalizeName(originalName);
    const claudeVariables = findClaudeVariables(body);
    let compatibility: 'native' | 'partial' = 'native';
    if (claudeVariables.length > 0) {
      compatibility = 'partial';
      context.degraded = true;
      diagnostics.add({
        code: DiagnosticCodes.ClaudeVariableUsed,
        severity: 'warning',
        pluginId,
        component,
        compatibility: 'partial',
        message: `Skill uses Claude-only variables: ${claudeVariables.join(', ')}. They are only expanded through explicit command invocation.`,
        remediation:
          'Invoke via runtime.invokeCommand with explicit arguments, or remove the variables.',
        sourceLocation: { path: `${component}/SKILL.md` },
      });
    }

    const bundleDir = `skills/${input.runtimeNamespace}/${runtimeName}`;
    await stageDirectory(context.filesToCopy, skillDir, bundleDir);

    ir.skills.push({
      id: qualifiedComponentId(input.runtimeNamespace, runtimeName),
      pluginId,
      originalName,
      runtimeName,
      description: parsed.data.description,
      directory: bundleDir,
      skillFile: `${bundleDir}/SKILL.md`,
      allowedTools: normalizeToolList(parsed.data['allowed-tools']),
      requiredPermissions: normalizeToolList(parsed.data.permissions),
      compatibility,
    });
  }
}

async function compileCommands(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  if (featureToggle(context, 'commands') === 'disabled') return;
  for (const commandFileName of inspection.commandFiles) {
    const component = `commands/${commandFileName}`;
    if (!policyGate(context, 'commands', component)) continue;

    const text = await fs.readFile(path.join(input.rootDir, 'commands', commandFileName), 'utf8');
    const { frontmatter, body } = parseFrontmatter(text);
    const parsed = commandFrontmatterSchema.safeParse(frontmatter);
    const name = normalizeName(
      (parsed.success ? parsed.data.name : undefined) ?? commandFileName.replace(/\.md$/, ''),
    );
    const usesArguments = findClaudeVariables(body).includes('$ARGUMENTS');
    if (usesArguments) {
      context.degraded = true;
      diagnostics.add({
        code: DiagnosticCodes.ComponentPartial,
        severity: 'info',
        pluginId: input.locked.id,
        component,
        compatibility: 'partial',
        message: '$ARGUMENTS is supported only through explicit command invocation.',
        sourceLocation: { path: component },
      });
    }
    ir.commands.push({
      id: qualifiedComponentId(input.runtimeNamespace, name),
      pluginId: input.locked.id,
      name,
      description: parsed.success ? parsed.data.description : undefined,
      promptTemplate: body.trim(),
      argumentHint: parsed.success ? parsed.data['argument-hint'] : undefined,
      usesArguments,
      compatibility: usesArguments ? 'partial' : 'translated',
    });
  }
}

async function compileMcpServers(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  if (!inspection.hasMcpConfig) return;
  if (featureToggle(context, 'mcp') === 'disabled') return;
  const raw: unknown = JSON.parse(await fs.readFile(path.join(input.rootDir, '.mcp.json'), 'utf8'));
  const parsed = mcpConfigFileSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.add({
      code: DiagnosticCodes.ManifestInvalid,
      severity: 'error',
      pluginId: input.locked.id,
      component: '.mcp.json',
      compatibility: 'unsupported',
      message: '.mcp.json is not a valid MCP configuration file',
    });
    return;
  }
  for (const serverName of Object.keys(parsed.data.mcpServers).sort()) {
    const component = `.mcp.json#${serverName}`;
    const translation = translateMcpServer(
      input.locked.id,
      input.runtimeNamespace,
      serverName,
      parsed.data.mcpServers[serverName] ?? {},
    );
    if (!translation.server) {
      context.degraded = true;
      diagnostics.add({
        code: DiagnosticCodes.ComponentUnsupported,
        severity: 'warning',
        pluginId: input.locked.id,
        component,
        compatibility: 'unsupported',
        message: translation.unsupportedReason ?? 'MCP server could not be translated',
      });
      continue;
    }
    if (!policyGate(context, translation.capability, component)) continue;
    ir.mcpServers.push(translation.server);
    if (translation.server.compatibility === 'partial') context.degraded = true;
  }
}

async function compileHooks(context: PluginContext): Promise<void> {
  const { input, inspection, diagnostics } = context;
  if (!inspection.hasHooks) return;
  if (featureToggle(context, 'hooks') === 'disabled') return;
  const raw: unknown = JSON.parse(
    await fs.readFile(path.join(input.rootDir, 'hooks', 'hooks.json'), 'utf8'),
  );
  const parsed = claudeHooksFileSchema.safeParse(raw);
  if (!parsed.success) {
    diagnostics.add({
      code: DiagnosticCodes.ManifestInvalid,
      severity: 'error',
      pluginId: input.locked.id,
      component: 'hooks/hooks.json',
      compatibility: 'unsupported',
      message: 'hooks/hooks.json is not a valid Claude hooks file',
    });
    return;
  }
  for (const claudeEvent of Object.keys(parsed.data.hooks).sort()) {
    let index = 0;
    for (const matcherEntry of parsed.data.hooks[claudeEvent] ?? []) {
      for (const definition of matcherEntry.hooks) {
        compileOneHook(context, claudeEvent, index, definition, matcherEntry.matcher);
        index += 1;
      }
    }
  }
}



function compileOneHook(
  context: PluginContext,
  claudeEvent: string,
  index: number,
  definition: Parameters<typeof translateClaudeHook>[4],
  matcher: string | undefined,
): void {
  const { input, ir, diagnostics } = context;
  const component = `hooks/hooks.json#${claudeEvent}[${index}]`;
  const translation = translateClaudeHook(
    input.locked.id,
    input.runtimeNamespace,
    claudeEvent,
    index,
    definition,
    matcher,
  );
  if (translation.hook.action.type === 'unsupported') {
    context.degraded = true;
    diagnostics.add({
      code: DiagnosticCodes.ComponentUnsupported,
      severity: 'warning',
      pluginId: input.locked.id,
      component,
      compatibility: 'unsupported',
      message: translation.hook.action.reason,
    });
    ir.hooks.push(translation.hook);
    return;
  }
  if (!policyGate(context, translation.capability, component)) return;
  if (translation.hook.compatibility === 'partial') context.degraded = true;
  ir.hooks.push(translation.hook);
}

function compileAdvisoryComponents(context: PluginContext): void {
  const { input, inspection, diagnostics } = context;
  const pluginId = input.locked.id;
  if (inspection.hasSettings && policyGate(context, 'settings', 'settings.json')) {
    diagnostics.add({
      code: DiagnosticCodes.ComponentPartial,
      severity: 'info',
      pluginId,
      component: 'settings.json',
      compatibility: 'partial',
      message:
        'Plugin settings are advisory only; they never alter application authorization or runtime configuration.',
    });
  }
  if (inspection.hasLsp) {
    context.degraded = true;
    diagnostics.add({
      code: DiagnosticCodes.ComponentUnsupported,
      severity: 'warning',
      pluginId,
      component: '.lsp.json',
      compatibility: 'unsupported',
      message: 'LSP servers are not supported in this runtime; configuration is ignored.',
    });
  }
  if (inspection.hasMonitors) {
    context.degraded = true;
    diagnostics.add({
      code: DiagnosticCodes.ComponentUnsupported,
      severity: 'warning',
      pluginId,
      component: 'monitors/monitors.json',
      compatibility: 'unsupported',
      message:
        'Background monitors are not supported in request-scoped runtimes (RFC 26); generate an external worker instead.',
    });
  }
}

async function compileExecutableAssets(context: PluginContext): Promise<void> {
  const { input, inspection, ir } = context;
  for (const binFileName of inspection.binFiles) {
    const component = `bin/${binFileName}`;
    if (!policyGate(context, 'binaries', component)) continue;
    const absolute = path.join(input.rootDir, 'bin', binFileName);
    const bundlePath = `executables/${input.runtimeNamespace}/${binFileName}`;
    context.filesToCopy.set(bundlePath, absolute);
    ir.executableAssets.push({
      id: `${input.runtimeNamespace}:bin:${normalizeName(binFileName)}`,
      pluginId: input.locked.id,
      relativePath: bundlePath,
      sha256: await sha256DigestOfFile(absolute),
      sandboxProfile: SANDBOX_PROFILE_DENY,
    });
  }
}

async function compileUnknownComponents(context: PluginContext): Promise<void> {
  const { input, inspection, ir, diagnostics } = context;
  for (const other of inspection.otherFiles) {
    if (!policyGate(context, 'unknownComponents', other)) continue;
    diagnostics.add({
      code: DiagnosticCodes.UnknownComponent,
      severity: 'info',
      pluginId: input.locked.id,
      component: other,
      compatibility: 'partial',
      message: `Unrecognized top-level entry "${other}" bundled as an opaque asset.`,
    });
    const absolute = path.join(input.rootDir, other);
    const assetPath = `plugins/${input.runtimeNamespace}/assets/${other}`;
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      await stageDirectory(context.filesToCopy, absolute, assetPath);
    } else {
      context.filesToCopy.set(assetPath, absolute);
      ir.assets.push({
        id: `${input.runtimeNamespace}:asset:${normalizeName(other)}`,
        pluginId: input.locked.id,
        relativePath: assetPath,
        sha256: await sha256DigestOfFile(absolute),
      });
    }
  }
}

function recordPluginAndProvenance(context: PluginContext): void {
  const { input, ir } = context;
  const { locked, manifest } = input;
  const hasNativeSkills = ir.skills.some(
    (skill) => skill.pluginId === locked.id && skill.compatibility === 'native',
  );
  ir.plugins.push({
    id: locked.id,
    runtimeNamespace: input.runtimeNamespace,
    name: manifest.name,
    version: locked.version,
    description: manifest.description,
    license: manifest.license,
    source: locked.source,
    contentDigest: locked.contentDigest,
    trustPolicy: locked.trustPolicy,
    capabilities: [...context.capabilities].sort((a, b) => a.localeCompare(b)),
    compatibility:
      context.blocked || context.degraded ? 'partial' : hasNativeSkills ? 'native' : 'translated',
  });

  // Per-plugin metadata manifest for the bundle.
  context.inlineJsonFiles.set(`plugins/${input.runtimeNamespace}/manifest.json`, {
    id: locked.id,
    digest: locked.contentDigest,
    manifestDigest: sha256DigestOfJson(manifest),
  });

  ir.provenance.push({
    pluginId: locked.id,
    sourceType: locked.source.type,
    sourceIdentity: locked.source.resolvedCommit ?? locked.source.integrity ?? locked.source.uri,
    contentDigest: locked.contentDigest,
    resolverVersion: (context.options.compiler ?? COMPILER_IDENTITY).version,
    trustPolicy: locked.trustPolicy,
  });
}
