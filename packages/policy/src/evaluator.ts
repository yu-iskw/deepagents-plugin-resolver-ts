import { BUILTIN_PROFILES, DEFAULT_POLICY_RULES } from './defaults.js';
import { evaluateSourceTrust } from './source-trust.js';

import type {
  PluginApproval,
  PluginPolicyDocument,
  PluginSourceSpec,
  PolicyDecision,
  PolicyEffect,
  PolicyRules,
  ProfileField,
} from '@deepagents-plugins/schema';

export interface PolicyEvaluatorOptions {
  document?: PluginPolicyDocument;
  /** When true, `review` decisions become failures unless an approval matches. */
  strict?: boolean;
  approvals?: PluginApproval[];
  now?: () => Date;
  /** CLI `--allow-local` override for source.allowLocal. */
  allowLocal?: boolean;
}

export interface CapabilityQuery {
  pluginId: string;
  profile: string;
  capability: string;
  /** Content digest of the plugin, used to match digest-bound approvals. */
  contentDigest?: string;
}

function capabilityEffect(
  rules: PolicyRules | undefined,
  capability: string,
): PolicyEffect | undefined {
  if (!rules) return undefined;
  switch (capability) {
    case 'skills':
      return rules.skills;
    case 'commands':
      return rules.commands;
    case 'subagents':
      return rules.subagents;
    case 'asyncSubagents':
      return rules.asyncSubagents;
    case 'memory.static':
      return rules.memory?.static;
    case 'memory.writable':
      return rules.memory?.writable;
    case 'profiles.fragment':
      return rules.profiles?.fragment;
    case 'interpreter':
      return rules.interpreter;
    case 'ptc':
      return rules.ptc;
    case 'rubrics':
      return rules.rubrics;
    case 'hitl':
      return rules.hitl;
    case 'mcp.remoteHttp':
      return rules.mcp?.remoteHttp;
    case 'mcp.stdio':
      return rules.mcp?.stdio;
    case 'hooks.middleware':
      return rules.hooks?.middleware;
    case 'hooks.webhook':
      return rules.hooks?.webhook;
    case 'hooks.command':
      return rules.hooks?.command;
    case 'lsp':
      return rules.lsp;
    case 'monitors':
      return rules.monitors;
    case 'binaries':
      return rules.binaries;
    case 'settings':
      return rules.settings;
    case 'unknownComponents':
      return rules.unknownComponents;
    default:
      return undefined;
  }
}

/**
 * Evaluates plugin capabilities against defaults, document defaults, and the
 * assigned profile. Plugins can never modify their own profile (RFC 9.2).
 */
export class PolicyEvaluator {
  private readonly document: PluginPolicyDocument | undefined;
  private readonly strict: boolean;
  private readonly approvals: PluginApproval[];
  private readonly now: () => Date;
  private readonly allowLocal: boolean | undefined;

  constructor(options: PolicyEvaluatorOptions = {}) {
    this.document = options.document;
    this.strict = options.strict ?? false;
    this.approvals = options.approvals ?? [];
    this.now = options.now ?? (() => new Date());
    this.allowLocal = options.allowLocal;
  }

  resolveProfileRules(profile: string): PolicyRules | undefined {
    return this.document?.profiles[profile] ?? BUILTIN_PROFILES[profile];
  }

  hasProfile(profile: string): boolean {
    return this.resolveProfileRules(profile) !== undefined;
  }

  /** Evaluate source-trust rules for a requested plugin source. */
  evaluateSource(source: PluginSourceSpec, profile: string): PolicyDecision {
    const rules = this.resolveProfileRules(profile);
    const base = rules?.source ?? this.document?.defaults.source;
    if (this.allowLocal === undefined) {
      return evaluateSourceTrust(source, base, profile);
    }
    return evaluateSourceTrust(source, { ...base, allowLocal: this.allowLocal }, profile);
  }

  evaluate(query: CapabilityQuery): PolicyDecision {
    const profileRules = this.resolveProfileRules(query.profile);
    const effect =
      capabilityEffect(profileRules, query.capability) ??
      capabilityEffect(this.document?.defaults, query.capability) ??
      capabilityEffect(DEFAULT_POLICY_RULES, query.capability) ??
      'deny';

    if (effect === 'review') {
      return this.evaluateReview(query, effect);
    }

    return {
      effect,
      ruleId: `${query.profile}/${query.capability}`,
      reason:
        effect === 'allow'
          ? `Capability "${query.capability}" allowed by trust policy "${query.profile}".`
          : `Capability "${query.capability}" denied by trust policy "${query.profile}".`,
      ...(effect === 'deny'
        ? {
            remediation: `Remove the component, or approve the exact plugin digest under a trust policy that permits "${query.capability}".`,
          }
        : {}),
    };
  }

  /**
   * Evaluate a single harness-profile governance field (RFC v2 section 14).
   * Falls back to the deny-by-default governance table for third parties.
   */
  evaluateProfileField(query: Omit<CapabilityQuery, 'capability'> & { field: ProfileField }): PolicyDecision {
    const profileRules = this.resolveProfileRules(query.profile);
    const effect =
      profileRules?.profiles?.[query.field] ??
      this.document?.defaults.profiles?.[query.field] ??
      DEFAULT_POLICY_RULES.profiles[query.field] ??
      'deny';
    if (effect === 'review') {
      return this.evaluateReview(
        { ...query, capability: `profiles.${query.field}` },
        effect,
      );
    }
    return {
      effect,
      ruleId: `${query.profile}/profiles.${query.field}`,
      reason:
        effect === 'allow'
          ? `Profile field "${query.field}" allowed by trust policy "${query.profile}".`
          : `Profile field "${query.field}" denied by trust policy "${query.profile}".`,
      ...(effect === 'deny'
        ? { remediation: `Remove the "${query.field}" fragment field or use a trust policy that permits it.` }
        : {}),
    };
  }

  private evaluateReview(query: CapabilityQuery, effect: PolicyEffect): PolicyDecision {
    if (this.isApproved(query)) {
      return {
        effect: 'allow',
        ruleId: `${query.profile}/${query.capability}/approved`,
        reason: `Capability "${query.capability}" approved by digest-bound approval record.`,
      };
    }
    if (this.strict) {
      return {
        effect: 'deny',
        ruleId: `${query.profile}/${query.capability}/review-strict`,
        reason: `Capability "${query.capability}" requires review and no approval record matches digest ${query.contentDigest ?? '<unknown>'} in strict mode.`,
        remediation:
          'Provide a PluginApproval record bound to the plugin content digest, or change the trust policy.',
      };
    }
    return {
      effect,
      ruleId: `${query.profile}/${query.capability}`,
      reason: `Capability "${query.capability}" requires review under trust policy "${query.profile}".`,
    };
  }

  private isApproved(query: CapabilityQuery): boolean {
    if (!query.contentDigest) return false;
    return this.approvals.some((approval) => {
      if (approval.pluginDigest !== query.contentDigest) return false;
      if (!approval.approvedCapabilities.includes(query.capability)) return false;
      if (approval.expiresAt && new Date(approval.expiresAt) < this.now()) return false;
      return true;
    });
  }
}
