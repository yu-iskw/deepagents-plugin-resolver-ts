import { z } from 'zod';

export const compatibilityLevelSchema = z.enum([
  'native',
  'translated',
  'partial',
  'unsupported',
  'blocked-by-policy',
]);
export type CompatibilityLevel = z.infer<typeof compatibilityLevelSchema>;

export const diagnosticSeveritySchema = z.enum(['info', 'warning', 'error']);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

export const sourceLocationSchema = z.object({
  path: z.string(),
  line: z.number().int().positive().optional(),
  column: z.number().int().positive().optional(),
});

export const compatibilityDiagnosticSchema = z.object({
  code: z.string().regex(/^DAP\d{4}$/),
  severity: diagnosticSeveritySchema,
  pluginId: z.string(),
  component: z.string().optional(),
  compatibility: compatibilityLevelSchema,
  message: z.string(),
  remediation: z.string().optional(),
  sourceLocation: sourceLocationSchema.optional(),
});
export type CompatibilityDiagnosticV1 = z.infer<typeof compatibilityDiagnosticSchema>;

/** Stable diagnostic codes. Ranges: 1xxx config, 2xxx policy, 3xxx validation, 4xxx compatibility, 5xxx integrity. */
export const DiagnosticCodes = {
  ConfigInvalid: 'DAP1001',
  LockfileMissing: 'DAP1002',
  LockfileMismatch: 'DAP1003',
  AliasRequired: 'DAP1004',
  PolicyDenied: 'DAP2304',
  PolicyReviewRequired: 'DAP2305',
  SourceTrustViolation: 'DAP2306',
  StructureInvalid: 'DAP3001',
  PathUnsafe: 'DAP3002',
  LimitExceeded: 'DAP3003',
  ManifestInvalid: 'DAP3004',
  NameCollision: 'DAP3005',
  ComponentUnsupported: 'DAP4001',
  ComponentPartial: 'DAP4002',
  ClaudeVariableUsed: 'DAP4003',
  UnknownComponent: 'DAP4004',
  IntegrityMismatch: 'DAP5001',
} as const;
export type DiagnosticCode = (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

/** Collects diagnostics in deterministic order and tracks the worst severity. */
export class DiagnosticCollector {
  private readonly items: CompatibilityDiagnosticV1[] = [];

  get all(): readonly CompatibilityDiagnosticV1[] {
    return [...this.items].sort(
      (a, b) =>
        a.pluginId.localeCompare(b.pluginId) ||
        (a.component ?? '').localeCompare(b.component ?? '') ||
        a.code.localeCompare(b.code) ||
        a.message.localeCompare(b.message),
    );
  }

  add(diagnostic: CompatibilityDiagnosticV1): void {
    this.items.push(diagnostic);
  }

  hasErrors(): boolean {
    return this.items.some((item) => item.severity === 'error');
  }
}
