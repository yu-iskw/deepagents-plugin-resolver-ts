import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';

import { redactSecrets } from './context.js';

import type { ContentLimits } from './limits.js';

/** Fetch with timeout, bounded redirects, and credential-redacted errors. */
export async function fetchBytes(
  url: string,
  limits: ContentLimits,
  options: { headers?: Record<string, string>; offline?: boolean } = {},
): Promise<Uint8Array> {
  if (options.offline) {
    throw new PluginResolutionError(
      `Offline mode: refusing network request to ${redactSecrets(url)}`,
      ExitCodes.OfflineCacheMiss,
      'Re-run without --offline, or warm the cache first.',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.networkTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: options.headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PluginResolutionError(
        `HTTP ${response.status} fetching ${redactSecrets(url)}`,
        ExitCodes.ResolutionFailure,
      );
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > limits.maxTotalBytes) {
      throw new PluginResolutionError(
        `Response from ${redactSecrets(url)} exceeds the download size limit`,
        ExitCodes.SecurityValidationFailure,
      );
    }
    return buffer;
  } catch (error) {
    if (error instanceof PluginResolutionError) throw error;
    throw new PluginResolutionError(
      `Network failure fetching ${redactSecrets(url)}: ${redactSecrets(String(error))}`,
      ExitCodes.ResolutionFailure,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(
  url: string,
  limits: ContentLimits,
  options: { headers?: Record<string, string>; offline?: boolean } = {},
): Promise<unknown> {
  const bytes = await fetchBytes(url, limits, options);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
