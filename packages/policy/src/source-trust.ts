import type { PluginSourceSpec, PolicyDecision, SourceTrust } from '@deepagents-plugins/schema';

/** Source trust checks (RFC sections 13.4 and 17). */
export function evaluateSourceTrust(
  source: PluginSourceSpec,
  trust: SourceTrust | undefined,
  profile: string,
): PolicyDecision {
  const allow = (reason: string): PolicyDecision => ({
    effect: 'allow',
    ruleId: `${profile}/source/${source.type}`,
    reason,
  });
  const deny = (reason: string, remediation: string): PolicyDecision => ({
    effect: 'deny',
    ruleId: `${profile}/source/${source.type}`,
    reason,
    remediation,
  });

  switch (source.type) {
    case 'npm': {
      const scopes = trust?.npmScopes;
      if (scopes && scopes.length > 0) {
        const matches = scopes.some((scope) => source.package.startsWith(`${scope}/`));
        if (!matches) {
          return deny(
            `npm package "${source.package}" is outside allowed scopes [${scopes.join(', ')}].`,
            'Add the package scope to source.npmScopes in the policy profile, or use an allowed scope.',
          );
        }
      }
      return allow(`npm source "${source.package}" permitted.`);
    }
    case 'github': {
      const owners = trust?.githubOwners;
      const owner = source.repository.split('/')[0] ?? '';
      if (owners && owners.length > 0 && !owners.includes(owner)) {
        return deny(
          `GitHub owner "${owner}" is not in the allowed owner list [${owners.join(', ')}].`,
          'Add the owner to source.githubOwners in the policy profile.',
        );
      }
      return allow(`GitHub source "${source.repository}" permitted.`);
    }
    case 'remote-archive': {
      if (trust?.allowRemoteArchives !== true) {
        return deny(
          'Remote archive sources are disabled by policy.',
          'Set source.allowRemoteArchives: true in the policy profile to permit sha256-pinned remote archives.',
        );
      }
      return allow('Remote archive source permitted by policy.');
    }
    case 'local':
    case 'local-archive': {
      if (trust?.allowLocal === false) {
        return deny(
          'Local sources are disabled by policy.',
          'Set source.allowLocal: true in the policy profile, or use a pinned remote source.',
        );
      }
      return allow('Local source permitted.');
    }
    case 'git':
      return allow(`Git source "${source.url}" permitted.`);
  }
}
