import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PolicyEvaluator } from '@deepagents-plugins/policy';
import { type LockedPlugin } from '@deepagents-plugins/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { writeBundle } from './bundler.js';
import { compilePluginSet, type PluginCompileInput } from './compile-plugin-set.js';
import { findClaudeVariables, parseFrontmatter } from './frontmatter.js';
import { inspectPlugin } from './inspect.js';
import { renderCompatibilityReport, renderDiagnostic, renderSarif } from './report.js';

let tmpRoot: string;
let pluginDir: string;

async function writeFullPlugin(root: string): Promise<void> {
  const write = async (relative: string, content: string): Promise<void> => {
    const filePath = path.join(root, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  };
  await write(
    '.claude-plugin/plugin.json',
    JSON.stringify({
      name: 'acme-review',
      version: '2.1.0',
      description: 'Review tools',
      license: 'MIT',
    }),
  );
  await write(
    'skills/security-review/SKILL.md',
    '---\nname: security-review\ndescription: Perform a security review\n---\n\nReview the code for security issues.\n',
  );
  await write('skills/security-review/references/checklist.md', '- injection\n- secrets\n');
  await write(
    'skills/arg-skill/SKILL.md',
    '---\ndescription: Uses claude vars\n---\n\nDo the thing with $ARGUMENTS now.\n',
  );
  await write(
    'commands/review.md',
    '---\ndescription: Review a file\nargument-hint: "<path>"\n---\n\nReview $ARGUMENTS carefully.\n',
  );
  await write(
    'agents/security-reviewer.md',
    '---\nname: security-reviewer\ndescription: Reviews code for vulnerabilities\ntools: Read, Grep\nmodel: sonnet\n---\n\nYou are a security reviewer.\n',
  );
  await write(
    '.mcp.json',
    JSON.stringify({
      mcpServers: {
        github: {
          type: 'http',
          url: 'https://mcp.example.com/github',
          headers: { authorization: 'SECRET' },
        },
        local: { command: './bin/server', args: ['--stdio'] },
      },
    }),
  );
  await write(
    'hooks/hooks.json',
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './bin/check.sh' }] }],
        Notification: [{ hooks: [{ type: 'command', command: 'echo hi' }] }],
        Stop: [{ hooks: [{ url: 'https://hooks.example.com/done' }] }],
      },
    }),
  );
  await write('monitors/monitors.json', JSON.stringify({ monitors: [] }));
  await write('.lsp.json', JSON.stringify({}));
  await write('settings.json', JSON.stringify({ defaultAgent: 'security-reviewer' }));
  await write('bin/check.sh', '#!/bin/sh\necho check\n');
}

function makeInput(rootDir: string, profile = 'third-party-restricted'): PluginCompileInput {
  const locked: LockedPlugin = {
    id: 'acme-review@direct',
    policyProfile: profile,
    version: '2.1.0',
    source: { type: 'local', uri: rootDir },
    pluginRoot: '.',
    contentDigest: 'sha256:' + 'a'.repeat(64),
    manifestDigest: 'sha256:' + 'b'.repeat(64),
    files: {},
  };
  return {
    locked,
    rootDir,
    manifest: {
      name: 'acme-review',
      version: '2.1.0',
      description: 'Review tools',
      license: 'MIT',
    },
    runtimeNamespace: 'acme-review',
    requested: { type: 'local', path: rootDir },
  };
}

beforeAll(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dap-compiler-'));
  pluginDir = path.join(tmpRoot, 'plugin');
  await writeFullPlugin(pluginDir);
});

afterAll(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('frontmatter', () => {
  it('parses frontmatter and finds Claude variables', () => {
    const { frontmatter, body } = parseFrontmatter('---\ndescription: x\n---\n\nBody $ARGUMENTS\n');
    expect(frontmatter.description).toBe('x');
    expect(body).toContain('Body');
    expect(findClaudeVariables(body)).toEqual(['$ARGUMENTS']);
    expect(parseFrontmatter('no frontmatter').frontmatter).toEqual({});
  });
});

describe('inspectPlugin', () => {
  it('enumerates components without executing anything', async () => {
    const inspection = await inspectPlugin(pluginDir);
    expect(inspection.skillDirs).toEqual(['arg-skill', 'security-review']);
    expect(inspection.commandFiles).toEqual(['review.md']);
    expect(inspection.agentFiles).toEqual(['security-reviewer.md']);
    expect(inspection.hasMcpConfig).toBe(true);
    expect(inspection.hasHooks).toBe(true);
    expect(inspection.hasMonitors).toBe(true);
    expect(inspection.binFiles).toEqual(['check.sh']);
  });
});

describe('compilePluginSet with default (restricted) policy', () => {
  it('compiles skills/commands, blocks stdio MCP and command hooks, reports unsupported', async () => {
    const result = await compilePluginSet([makeInput(pluginDir)], {
      policy: new PolicyEvaluator(),
      compatibilityMode: 'permissive',
      pluginSetDigest: 'sha256:' + 'c'.repeat(64),
    });
    const { ir } = result;

    expect(ir.skills.map((skill) => skill.runtimeName).sort()).toEqual([
      'arg-skill',
      'security-review',
    ]);
    expect(ir.skills.find((skill) => skill.runtimeName === 'arg-skill')?.compatibility).toBe(
      'partial',
    );
    expect(ir.skills[0]?.directory.startsWith('skills/acme-review/')).toBe(true);

    expect(ir.commands).toHaveLength(1);
    expect(ir.commands[0]?.usesArguments).toBe(true);

    // subagents: review → allowed=false under default non-strict? review is not allow → blocked
    expect(ir.subagents).toHaveLength(0);

    // remote http MCP requires review; stdio denied.
    expect(ir.mcpServers).toHaveLength(0);
    const stdioDiag = ir.diagnostics.find((d) => d.component === '.mcp.json#local');
    expect(stdioDiag?.compatibility).toBe('blocked-by-policy');

    // command hook denied, webhook review-blocked, Notification unsupported.
    expect(ir.hooks.filter((hook) => hook.action.type !== 'unsupported')).toHaveLength(0);
    expect(ir.diagnostics.some((d) => d.component?.startsWith('hooks/hooks.json#PreToolUse'))).toBe(
      true,
    );

    // monitors + lsp unsupported diagnostics.
    expect(ir.diagnostics.some((d) => d.component === 'monitors/monitors.json')).toBe(true);
    expect(ir.diagnostics.some((d) => d.component === '.lsp.json')).toBe(true);

    // binaries denied by default: no executable assets.
    expect(ir.executableAssets).toHaveLength(0);

    expect(ir.plugins[0]?.capabilities).toContain('skills');
    expect(ir.provenance).toHaveLength(1);
  });

  it('fails closed on policy denials outside permissive mode', async () => {
    await expect(
      compilePluginSet([makeInput(pluginDir)], {
        policy: new PolicyEvaluator(),
        compatibilityMode: 'standard',
        pluginSetDigest: 'sha256:' + 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({ exitCode: 5 });
  });

  it('strict mode rejects degraded plugins even when nothing is denied', async () => {
    const cleanDir = path.join(tmpRoot, 'clean-plugin');
    await fs.mkdir(path.join(cleanDir, '.claude-plugin'), { recursive: true });
    await fs.writeFile(
      path.join(cleanDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'clean', version: '1.0.0' }),
    );
    const skillDir = path.join(cleanDir, 'skills', 'basic');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\ndescription: basic skill with $ARGUMENTS\n---\n\nUse $ARGUMENTS here.\n',
    );
    const input = { ...makeInput(cleanDir), runtimeNamespace: 'clean' };
    await expect(
      compilePluginSet([input], {
        policy: new PolicyEvaluator(),
        compatibilityMode: 'strict',
        pluginSetDigest: 'sha256:' + 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({ exitCode: 6 });
  });
});

describe('compilePluginSet with trusted-internal profile', () => {
  it('translates subagents and remote MCP with secret references only', async () => {
    const result = await compilePluginSet([makeInput(pluginDir, 'trusted-internal')], {
      policy: new PolicyEvaluator(),
      compatibilityMode: 'permissive',
      pluginSetDigest: 'sha256:' + 'c'.repeat(64),
    });
    const { ir } = result;

    expect(ir.subagents).toHaveLength(1);
    expect(ir.subagents[0]).toMatchObject({
      id: 'acme-review:security-reviewer',
      allowedTools: ['Grep', 'Read'],
      model: { requested: 'sonnet', advisory: true },
    });

    const remote = ir.mcpServers.find((server) => server.transport === 'streamable-http');
    expect(remote?.endpoint).toBe('https://mcp.example.com/github');
    // Secret values never appear in the IR; only references.
    expect(JSON.stringify(ir)).not.toContain('SECRET');
    expect(remote?.headerRefs?.authorization).toContain('mcp.acme-review.github.header');

    // Webhook hook allowed under trusted-internal.
    expect(ir.hooks.some((hook) => hook.action.type === 'webhook')).toBe(true);
  });
});

describe('writeBundle determinism', () => {
  it('produces identical bundle digests across runs and omits timestamps', async () => {
    const compile = () =>
      compilePluginSet([makeInput(pluginDir)], {
        policy: new PolicyEvaluator(),
        compatibilityMode: 'permissive',
        pluginSetDigest: 'sha256:' + 'c'.repeat(64),
      });
    const outputA = path.join(tmpRoot, 'bundle-a');
    const outputB = path.join(tmpRoot, 'bundle-b');
    const first = await writeBundle(await compile(), {
      outputDir: outputA,
      reproducible: true,
      emitSbom: true,
    });
    const second = await writeBundle(await compile(), {
      outputDir: outputB,
      reproducible: true,
      emitSbom: true,
    });
    expect(first.bundleDigest).toBe(second.bundleDigest);
    await expect(fs.stat(path.join(outputA, 'build-info.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(outputA, 'ir', 'plugin-set.json'))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(outputA, 'sbom.cdx.json'))).resolves.toBeTruthy();

    const manifestText = await fs.readFile(path.join(outputA, 'bundle-manifest.json'), 'utf8');
    expect(manifestText).toContain('"bundleDigest"');
  });
});

describe('reports', () => {
  it('renders text, diagnostic, and SARIF outputs', async () => {
    const result = await compilePluginSet([makeInput(pluginDir)], {
      policy: new PolicyEvaluator(),
      compatibilityMode: 'permissive',
      pluginSetDigest: 'sha256:' + 'c'.repeat(64),
    });
    const text = renderCompatibilityReport(result.ir);
    expect(text).toContain('Plugin: acme-review@direct');
    expect(text).toContain('[NATIVE]');
    expect(text).toContain('[BLOCKED-BY-POLICY]');

    const diagnostic = result.ir.diagnostics.find((d) => d.compatibility === 'blocked-by-policy');
    expect(diagnostic).toBeDefined();
    if (diagnostic) {
      const rendered = renderDiagnostic(diagnostic);
      expect(rendered).toContain(diagnostic.code);
      expect(rendered).toContain('Plugin: acme-review@direct');
    }

    const sarif = renderSarif(result.ir) as { runs: { results: unknown[] }[] };
    expect(sarif.runs[0]?.results.length).toBeGreaterThan(0);
  });
});
