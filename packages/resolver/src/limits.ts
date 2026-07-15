/** Content limits (RFC section 14.3). Policy may lower these, never raise them. */
export interface ContentLimits {
  maxTotalBytes: number;
  maxFileBytes: number;
  maxSkillFileBytes: number;
  maxFileCount: number;
  maxDirectoryDepth: number;
  maxMarketplaceEntries: number;
  maxRedirects: number;
  networkTimeoutMs: number;
  maxPathLength: number;
}

export const DEFAULT_LIMITS: ContentLimits = {
  maxTotalBytes: 100 * 1024 * 1024,
  maxFileBytes: 20 * 1024 * 1024,
  maxSkillFileBytes: 10 * 1024 * 1024,
  maxFileCount: 10_000,
  maxDirectoryDepth: 32,
  maxMarketplaceEntries: 10_000,
  maxRedirects: 3,
  networkTimeoutMs: 60_000,
  maxPathLength: 512,
};

/** Merge limits, only permitting values lower than the defaults. */
export function mergeLimits(overrides: Partial<ContentLimits> = {}): ContentLimits {
  const merged = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(overrides) as (keyof ContentLimits)[]) {
    const value = overrides[key];
    if (typeof value === 'number' && value > 0 && value < merged[key]) {
      merged[key] = value;
    }
  }
  return merged;
}
