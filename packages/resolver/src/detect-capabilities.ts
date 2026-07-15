import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Lightweight capability probe recorded in the lockfile (RFC v2 section 9).
 * Intentionally independent of the compiler's deeper inspection so the
 * resolver never depends on `@deepagents-plugins/compiler`. New detected
 * capabilities change the lockfile, which frozen builds treat as drift
 * requiring review.
 */
export async function detectPluginCapabilities(rootDir: string): Promise<string[]> {
  const capabilities = new Set<string>();
  const hasDir = async (relative: string): Promise<boolean> => {
    try {
      return (await fs.stat(path.join(rootDir, relative))).isDirectory();
    } catch {
      return false;
    }
  };
  const hasFile = async (relative: string): Promise<boolean> => {
    try {
      return (await fs.stat(path.join(rootDir, relative))).isFile();
    } catch {
      return false;
    }
  };

  if (await hasDir('skills')) capabilities.add('skills');
  if (await hasDir('commands')) capabilities.add('commands');
  if (await hasDir('agents')) capabilities.add('agents');
  if (await hasDir('memory')) capabilities.add('memory');
  if (await hasDir('profiles')) capabilities.add('profiles');
  if (await hasDir('rubrics')) capabilities.add('rubrics');
  if (await hasDir('hooks')) capabilities.add('hooks');
  if (await hasDir('bin')) capabilities.add('binaries');
  if (await hasFile('.mcp.json')) capabilities.add('mcp');
  if (await hasFile('hooks/hooks.json')) capabilities.add('hooks');
  if (await hasFile('interpreter.json')) capabilities.add('interpreter');
  if (await hasFile('.lsp.json')) capabilities.add('lsp');
  if (await hasFile('monitors/monitors.json')) capabilities.add('monitors');
  if (await hasFile('settings.json')) capabilities.add('settings');

  return [...capabilities].sort();
}
