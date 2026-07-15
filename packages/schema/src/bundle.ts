import { z } from 'zod';

/** Bundle manifest (RFC section 22.1, Appendix A). */

export const BUNDLE_MANIFEST_NAME = 'bundle-manifest.json';
export const IR_RELATIVE_PATH = 'ir/plugin-set.json';
export const COMPATIBILITY_REPORT_NAME = 'compatibility-report.json';
export const PROVENANCE_NAME = 'provenance.json';
export const SBOM_NAME = 'sbom.cdx.json';
export const BUILD_INFO_NAME = 'build-info.json';
export const PROFILES_RELATIVE_PATH = 'profiles/harness-profiles.json';
export const MEMORY_DIR = 'memory';
export const RUBRICS_DIR = 'rubrics';

export const bundleFileEntrySchema = z.object({
  path: z.string(),
  sha256: z.string(),
});
export type BundleFileEntry = z.infer<typeof bundleFileEntrySchema>;

export const bundleManifestSchema = z.object({
  schemaVersion: z.literal(2),
  bundleDigest: z.string(),
  files: z.array(bundleFileEntrySchema),
});
export type BundleManifest = z.infer<typeof bundleManifestSchema>;
