/** CLI exit codes (RFC section 24.3). */
export const ExitCodes = {
  Success: 0,
  GeneralFailure: 1,
  ConfigurationError: 2,
  ResolutionFailure: 3,
  IntegrityMismatch: 4,
  PolicyDenial: 5,
  CompatibilityFailure: 6,
  SecurityValidationFailure: 7,
  OfflineCacheMiss: 8,
} as const;
export type ExitCode = (typeof ExitCodes)[keyof typeof ExitCodes];

/** Error carrying a specific CLI exit code through the pipeline. */
export class PluginResolutionError extends Error {
  readonly exitCode: ExitCode;
  readonly remediation?: string;

  constructor(message: string, exitCode: ExitCode, remediation?: string) {
    super(message);
    this.name = 'PluginResolutionError';
    this.exitCode = exitCode;
    if (remediation !== undefined) {
      this.remediation = remediation;
    }
  }
}
