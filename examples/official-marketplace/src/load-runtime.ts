import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPluginRuntimeFromDirectory, type PluginRuntime } from '@deepagents-plugins/core';

/** Load the compiled official-marketplace bundle with integrity checks. */
export async function loadOfficialPluginRuntime(): Promise<PluginRuntime> {
  return createPluginRuntimeFromDirectory({
    directory: path.join(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      '.deepagents',
      'plugins',
    ),
    verifyIntegrity: true,
  });
}
