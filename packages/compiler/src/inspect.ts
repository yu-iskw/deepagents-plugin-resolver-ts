import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Enumerate plugin components without executing anything (RFC 11.1 step 6).
 */

export interface PluginInspection {
  rootDir: string;
  skillDirs: string[];
  commandFiles: string[];
  agentFiles: string[];
  /** Relative paths under memory/ (Markdown only). */
  memoryFiles: string[];
  /** JSON files under profiles/. */
  profileFiles: string[];
  /** JSON files under rubrics/. */
  rubricFiles: string[];
  hasMcpConfig: boolean;
  hasHooks: boolean;
  hasSettings: boolean;
  hasLsp: boolean;
  hasMonitors: boolean;
  hasInterpreterConfig: boolean;
  binFiles: string[];
  /** Top-level entries that are not recognized components. */
  otherFiles: string[];
}

const KNOWN_TOP_LEVEL = new Set([
  '.claude-plugin',
  'skills',
  'commands',
  'agents',
  'memory',
  'profiles',
  'rubrics',
  'hooks',
  'monitors',
  'bin',
  '.mcp.json',
  '.lsp.json',
  'settings.json',
  'interpreter.json',
  'README.md',
  'LICENSE',
  'LICENSE.md',
  'CHANGELOG.md',
  'package.json',
]);

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

export async function inspectPlugin(rootDir: string): Promise<PluginInspection> {
  const skillDirs: string[] = [];
  for (const entry of await listDir(path.join(rootDir, 'skills'))) {
    if (await exists(path.join(rootDir, 'skills', entry, 'SKILL.md'))) {
      skillDirs.push(entry);
    }
  }

  const commandFiles = (await listDir(path.join(rootDir, 'commands'))).filter((file) =>
    file.endsWith('.md'),
  );
  const agentFiles = (await listDir(path.join(rootDir, 'agents'))).filter((file) =>
    file.endsWith('.md'),
  );
  const binFiles = await listDir(path.join(rootDir, 'bin'));

  const memoryFiles: string[] = [];
  const memoryRoot = path.join(rootDir, 'memory');
  try {
    const entries = await fs.readdir(memoryRoot, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const absolute = path.join(entry.parentPath, entry.name);
      memoryFiles.push(path.relative(memoryRoot, absolute).split(path.sep).join('/'));
    }
    memoryFiles.sort();
  } catch {
    // no memory directory
  }

  const profileFiles = (await listDir(path.join(rootDir, 'profiles'))).filter((file) =>
    file.endsWith('.json'),
  );
  const rubricFiles = (await listDir(path.join(rootDir, 'rubrics'))).filter((file) =>
    file.endsWith('.json'),
  );

  const otherFiles: string[] = [];
  for (const entry of await listDir(rootDir)) {
    if (!KNOWN_TOP_LEVEL.has(entry) && !entry.startsWith('.')) {
      otherFiles.push(entry);
    }
  }

  return {
    rootDir,
    skillDirs,
    commandFiles,
    agentFiles,
    memoryFiles,
    profileFiles,
    rubricFiles,
    hasMcpConfig: await exists(path.join(rootDir, '.mcp.json')),
    hasInterpreterConfig: await exists(path.join(rootDir, 'interpreter.json')),
    hasHooks: await exists(path.join(rootDir, 'hooks', 'hooks.json')),
    hasSettings: await exists(path.join(rootDir, 'settings.json')),
    hasLsp: await exists(path.join(rootDir, '.lsp.json')),
    hasMonitors: await exists(path.join(rootDir, 'monitors', 'monitors.json')),
    binFiles,
    otherFiles,
  };
}
