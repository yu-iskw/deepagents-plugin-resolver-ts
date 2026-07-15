import { loadCompiledPluginSet, type LoadedPluginBundle } from '@deepagents-plugins/runtime';

export interface LoadPluginBundleOptions {
  directory: string;
  /** Stream-hash every bundle file against the manifest (default true). */
  verifyIntegrity?: boolean;
}

/**
 * Load an immutable, integrity-verified plugin bundle (RFC v2 section 30).
 * Thin passthrough to the framework-neutral runtime loader; fails closed on
 * any digest mismatch and performs no network access.
 */
export async function loadPluginBundle(
  options: LoadPluginBundleOptions,
): Promise<LoadedPluginBundle> {
  return loadCompiledPluginSet(options);
}
