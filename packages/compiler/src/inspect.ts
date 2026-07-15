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
  hasMcpConfig: boolean;
  hasHooks: boolean;
  hasSettings: boolean;
  hasLsp: boolean;
  hasMonitors: boolean;
  binFiles: string[];
  /** Top-level entries that are not recognized components. */
  otherFiles: string[];
}

const KNOWN_TOP_LEVEL = new Set([
  '.claude-plugin',
  'skills',
  'commands',
  'agents',
  'hooks',
  'monitors',
  'bin',
  '.mcp.json',
  '.lsp.json',
  'settings.json',
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
    hasMcpConfig: await exists(path.join(rootDir, '.mcp.json')),
    hasHooks: await exists(path.join(rootDir, 'hooks', 'hooks.json')),
    hasSettings: await exists(path.join(rootDir, 'settings.json')),
    hasLsp: await exists(path.join(rootDir, '.lsp.json')),
    hasMonitors: await exists(path.join(rootDir, 'monitors', 'monitors.json')),
    binFiles,
    otherFiles,
  };
}
