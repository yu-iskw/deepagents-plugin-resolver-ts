import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  renderCompatibilityReport,
  renderDiagnostic,
  renderSarif,
} from '@deepagents-plugins/compiler';
import {
  LOCKFILE_NAME,
  MANIFEST_NAME,
  auditPluginSetFromProject,
  compilePluginSetFromProject,
  loadPluginSetManifest,
  readLockfile,
  resolvePluginSetFromProject,
  type PipelineOptions,
} from '@deepagents-plugins/core';
import {
  detectDeepAgentsCapabilities,
} from '@deepagents-plugins/runtime-deepagents';
import {
  ExitCodes,
  PluginResolutionError,
  canonicalJsonStringify,
  capabilityAvailable,
  requiredCapabilitiesFromIr,
} from '@deepagents-plugins/schema';
import { Command } from 'commander';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const execFileAsync = promisify(execFile);

export interface CliIo {
  out(text: string): void;
  error(text: string): void;
}

const defaultIo: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  error: (text) => process.stderr.write(`${text}\n`),
};

interface GlobalFlags {
  frozenLockfile?: boolean;
  offline?: boolean;
  policy?: string;
  strict?: boolean;
  compatibility?: 'permissive' | 'standard' | 'strict';
  output?: string;
  json?: boolean;
  sarif?: boolean;
  reproducible?: boolean;
  allowLocal?: boolean;
  cacheDir?: string;
  project?: string;
}

function pipelineOptions(flags: GlobalFlags): PipelineOptions {
  const projectDir = path.resolve(flags.project ?? '.');
  return {
    projectDir,
    frozen: flags.frozenLockfile,
    offline: flags.offline,
    policyPath: flags.policy ? path.resolve(flags.policy) : undefined,
    strict: flags.strict,
    compatibilityMode: flags.compatibility,
    outputDir: flags.output,
    reproducible: flags.reproducible,
    cacheDir: flags.cacheDir,
    allowLocal: flags.allowLocal,
  };
}

const STARTER_MANIFEST = `apiVersion: deepagents.plugins/v2
kind: PluginSet

metadata:
  name: my-plugin-set

marketplaces: []

plugins:
  - id: project-local@direct
    source:
      type: local
      path: ./plugins/project-local
    trustPolicy: development
    features:
      skills: enabled
      commands: enabled
      memory: static-only
      rubrics: templates-only

runtime:
  compatibilityMode: standard
  interpreter:
    enabled: false
    ptcDefault: deny
  asyncSubagents:
    allowedHosts: []
  streaming:
    attachPluginProvenance: true
    redactToolArguments: true

output:
  directory: .deepagents/plugins
  reproducible: true
  includeSourceFiles: true
  emitCompatibilityReport: true
  emitSbom: false
`;

export function createProgram(io: CliIo = defaultIo): Command {
  const program = new Command('deepagents-plugins')
    .description('Resolve, audit, and compile Claude Code plugins for Deep Agents JS')
    .version('0.1.0')
    .option('--project <path>', 'project directory', '.')
    .option('--frozen-lockfile', 'fail if the lockfile would change')
    .option('--offline', 'never touch the network; fail on cache misses')
    .option('--policy <path>', 'policy document (PluginPolicy YAML)')
    .option('--strict', 'review decisions fail without digest-bound approvals')
    .option('--compatibility <mode>', 'permissive | standard | strict')
    .option('--output <path>', 'bundle output directory')
    .option('--json', 'machine-readable JSON output')
    .option('--sarif', 'emit SARIF diagnostics')
    .option('--reproducible', 'omit timestamps from bundle output')
    .option('--allow-local', 'permit local plugin sources')
    .option('--cache-dir <path>', 'content-addressed cache directory')
    .exitOverride()
    .configureOutput({
      writeOut: (text) => io.out(text.trimEnd()),
      writeErr: (text) => io.error(text.trimEnd()),
    });

  const flags = (): GlobalFlags => program.opts<GlobalFlags>();

  program
    .command('init')
    .description(`create a starter ${MANIFEST_NAME}`)
    .action(async () => {
      const manifestPath = path.resolve(flags().project ?? '.', MANIFEST_NAME);
      try {
        await fs.access(manifestPath);
        throw new PluginResolutionError(
          `${MANIFEST_NAME} already exists`,
          ExitCodes.ConfigurationError,
        );
      } catch (error) {
        if (error instanceof PluginResolutionError) throw error;
      }
      await fs.writeFile(manifestPath, STARTER_MANIFEST, 'utf8');
      io.out(`Created ${manifestPath}`);
    });

  program
    .command('resolve')
    .description('resolve all plugins and write the lockfile')
    .action(async () => {
      const { resolution } = await resolvePluginSetFromProject(pipelineOptions(flags()));
      io.out(
        `Resolved ${resolution.lockfile.plugins.length} plugin(s), ${resolution.lockfile.marketplaces.length} marketplace(s).`,
      );
      for (const plugin of resolution.lockfile.plugins) {
        io.out(`  ${plugin.id} ${plugin.version ?? ''} ${plugin.contentDigest.slice(0, 19)}…`);
      }
    });

  program
    .command('update')
    .argument('[plugin]', 'plugin id to update (all when omitted)')
    .description('re-resolve floating references and refresh the lockfile')
    .action(async () => {
      const options = pipelineOptions(flags());
      options.frozen = false;
      const { resolution } = await resolvePluginSetFromProject(options);
      io.out(`Lockfile updated (${resolution.lockfile.plugins.length} plugin(s)).`);
    });

  program
    .command('verify')
    .description('verify the lockfile matches the manifest and sources')
    .action(async () => {
      const options = pipelineOptions(flags());
      options.frozen = true;
      await resolvePluginSetFromProject(options);
      io.out('Lockfile verified: resolutions are up to date and digests match.');
    });

  program
    .command('validate')
    .description('validate manifest, lockfile, and policy schemas without fetching')
    .action(async () => {
      const options = pipelineOptions(flags());
      await loadPluginSetManifest(path.join(options.projectDir, MANIFEST_NAME));
      await readLockfile(path.join(options.projectDir, LOCKFILE_NAME));
      io.out('Configuration is valid.');
    });

  program
    .command('audit')
    .description('resolve, apply policy, and report every diagnostic without bundling')
    .action(async () => {
      const { compiled } = await auditPluginSetFromProject(pipelineOptions(flags()));
      if (flags().json) {
        io.out(canonicalJsonStringify({ diagnostics: compiled.ir.diagnostics }).trimEnd());
      } else if (flags().sarif) {
        io.out(canonicalJsonStringify(renderSarif(compiled.ir)).trimEnd());
      } else if (compiled.ir.diagnostics.length === 0) {
        io.out('No diagnostics: all components are native or translated.');
      } else {
        for (const diagnostic of compiled.ir.diagnostics) {
          io.out(renderDiagnostic(diagnostic));
          io.out('');
        }
      }
      if (compiled.ir.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        throw new PluginResolutionError('Audit found blocking issues', ExitCodes.PolicyDenial);
      }
    });

  program
    .command('compile')
    .description('compile the plugin set into a deterministic bundle')
    .action(async () => {
      const result = await compilePluginSetFromProject(pipelineOptions(flags()));
      io.out(`Bundle written to ${result.outputDir}`);
      io.out(`Bundle digest: ${result.bundle.bundleDigest}`);
      io.out(
        `Components: ${result.compiled.ir.skills.length} skill(s), ${result.compiled.ir.commands.length} command(s), ${result.compiled.ir.syncSubagents.length} sync subagent(s), ${result.compiled.ir.asyncSubagents.length} async subagent(s), ${result.compiled.ir.memorySources.length} memory source(s), ${result.compiled.ir.harnessProfiles.length} profile(s), ${result.compiled.ir.mcpServers.length} MCP server(s).`,
      );
      if (flags().sarif) {
        await fs.writeFile(
          path.join(result.outputDir, 'diagnostics.sarif'),
          canonicalJsonStringify(renderSarif(result.compiled.ir)),
          'utf8',
        );
      }
    });

  program
    .command('explain')
    .argument('<plugin>', 'plugin id')
    .description('show resolution, policy, and compatibility details for a plugin')
    .action(async (pluginId: string) => {
      const { compiled, resolution } = await auditPluginSetFromProject(pipelineOptions(flags()));
      const locked = resolution.lockfile.plugins.find((plugin) => plugin.id === pluginId);
      if (!locked) {
        throw new PluginResolutionError(
          `Plugin "${pluginId}" is not in the plugin set`,
          ExitCodes.ConfigurationError,
        );
      }
      if (flags().json) {
        io.out(
          canonicalJsonStringify({
            locked,
            diagnostics: compiled.ir.diagnostics.filter((d) => d.pluginId === pluginId),
          }).trimEnd(),
        );
        return;
      }
      io.out(renderCompatibilityReport(compiled.ir));
    });

  program
    .command('list')
    .description('list plugins in the current lockfile')
    .action(async () => {
      const options = pipelineOptions(flags());
      const lockfile = await readLockfile(path.join(options.projectDir, LOCKFILE_NAME));
      if (!lockfile) {
        io.out('No lockfile. Run "deepagents-plugins resolve" first.');
        return;
      }
      for (const plugin of lockfile.plugins) {
        io.out(
          `${plugin.id}\t${plugin.version ?? '-'}\t${plugin.source.type}\t${plugin.trustPolicy}`,
        );
      }
    });

  program
    .command('capabilities')
    .description('detect installed Deep Agents capabilities and compare with the plugin set')
    .action(async () => {
      const options = pipelineOptions(flags());
      const capabilities = await detectDeepAgentsCapabilities();
      let comparison: { capability: string; required: boolean; available: boolean }[] = [];
      const manifestPath = path.join(options.projectDir, MANIFEST_NAME);
      const hasManifest = await fs.access(manifestPath).then(
        () => true,
        () => false,
      );
      if (hasManifest) {
        const { compiled } = await auditPluginSetFromProject(options);
        comparison = requiredCapabilitiesFromIr(compiled.ir).map((requirement) => ({
          capability: requirement.capability,
          required: requirement.required,
          available: capabilityAvailable(capabilities, requirement.capability),
        }));
      }
      if (flags().json) {
        io.out(canonicalJsonStringify({ capabilities, comparison }).trimEnd());
        return;
      }
      io.out(`Deep Agents detected: ${capabilities.skills ? 'yes' : 'no'}`);
      if (capabilities.version) io.out(`Version: ${capabilities.version}`);
      io.out(
        `skills=${capabilities.skills} memory=${capabilities.memory} harnessProfiles=${capabilities.harnessProfiles} syncSubagents=${capabilities.syncSubagents} asyncSubagents=${capabilities.asyncSubagents} interruptOn=${capabilities.interruptOn} permissions=${capabilities.permissions} streamTransformers=${capabilities.streamTransformers}`,
      );
      io.out(
        `interpreter=${capabilities.interpreter.available} ptc=${capabilities.interpreter.ptc} rubric=${capabilities.rubric.available}`,
      );
      for (const entry of comparison) {
        io.out(
          `${entry.available ? 'ok  ' : entry.required ? 'FAIL' : 'warn'} ${entry.capability}${entry.required ? ' (required)' : ''}`,
        );
      }
    });

  program
    .command('sbom')
    .description('compile and emit a CycloneDX SBOM for the plugin set')
    .action(async () => {
      const options = pipelineOptions(flags());
      options.emitSbom = true;
      const result = await compilePluginSetFromProject(options);
      const sbomPath = path.join(result.outputDir, 'sbom.cdx.json');
      io.out(await fs.readFile(sbomPath, 'utf8'));
    });

  program
    .command('doctor')
    .description('check the local environment for common problems')
    .action(async () => {
      const nodeMajor = Number(process.versions.node.split('.')[0]);
      io.out(`node: ${process.version} ${nodeMajor >= 22 ? 'ok' : 'UNSUPPORTED (need >= 22)'}`);
      try {
        const { stdout } = await execFileAsync('git', ['--version']);
        io.out(`git: ${stdout.trim()} ok`);
      } catch {
        io.out('git: NOT FOUND (required for git/github sources)');
      }
      const manifestPath = path.resolve(flags().project ?? '.', MANIFEST_NAME);
      try {
        await fs.access(manifestPath);
        io.out(`manifest: ${manifestPath} ok`);
      } catch {
        io.out(`manifest: missing (${MANIFEST_NAME}); run "deepagents-plugins init"`);
      }
    });

  const addRemove = async (pluginId: string, add: boolean): Promise<void> => {
    const projectDir = path.resolve(flags().project ?? '.');
    const manifestPath = path.join(projectDir, MANIFEST_NAME);
    const text = await fs.readFile(manifestPath, 'utf8');
    const doc = parseYaml(text, { schema: 'core' }) as {
      plugins?: { [key: string]: unknown; id: string }[];
    };
    doc.plugins ??= [];
    if (add) {
      if (doc.plugins.some((plugin) => plugin.id === pluginId)) {
        throw new PluginResolutionError(
          `Plugin "${pluginId}" is already declared`,
          ExitCodes.ConfigurationError,
        );
      }
      doc.plugins.push({ id: pluginId });
    } else {
      const before = doc.plugins.length;
      doc.plugins = doc.plugins.filter((plugin) => plugin.id !== pluginId);
      if (doc.plugins.length === before) {
        throw new PluginResolutionError(
          `Plugin "${pluginId}" is not declared`,
          ExitCodes.ConfigurationError,
        );
      }
    }
    await fs.writeFile(manifestPath, stringifyYaml(doc), 'utf8');
    io.out(`${add ? 'Added' : 'Removed'} ${pluginId}. Run "deepagents-plugins resolve" next.`);
  };

  program
    .command('add')
    .argument('<plugin>', 'plugin id, e.g. example-plugin@my-marketplace')
    .description('declare a plugin in the manifest')
    .action(async (pluginId: string) => addRemove(pluginId, true));

  program
    .command('remove')
    .argument('<plugin>', 'plugin id')
    .description('remove a plugin from the manifest')
    .action(async (pluginId: string) => addRemove(pluginId, false));

  return program;
}

/** Run the CLI and translate failures into RFC 24.3 exit codes. */
export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv, { from: 'user' });
    return ExitCodes.Success;
  } catch (error) {
    if (error instanceof PluginResolutionError) {
      io.error(error.message);
      if (error.remediation) io.error(`Remediation: ${error.remediation}`);
      return error.exitCode;
    }
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      // Commander help/version pseudo-errors.
      if (code === 'commander.helpDisplayed' || code === 'commander.version') {
        return ExitCodes.Success;
      }
      if (code.startsWith('commander.')) {
        return ExitCodes.ConfigurationError;
      }
    }
    io.error(error instanceof Error ? error.message : String(error));
    return ExitCodes.GeneralFailure;
  }
}
