import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPluginRuntimeFromDirectory, type PluginRuntime } from '@deepagents-plugins/core';

const exampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDirectory = path.join(exampleRoot, '.deepagents', 'plugins');

/** Load the compiled official-marketplace bundle with integrity checks. */
export async function loadOfficialPluginRuntime(): Promise<PluginRuntime> {
  return createPluginRuntimeFromDirectory({
    directory: bundleDirectory,
    verifyIntegrity: true,
  });
}
