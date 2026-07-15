# Security threat model

Plugin content is untrusted input (RFC section 28). Trust boundary:
untrusted sources → build sandbox → approved immutable bundle → runtime.

## Mitigations implemented

| Threat                    | Mitigation                                                                                    | Where                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Path traversal / Zip Slip | Safe relative-path validation on every entry                                                  | `resolver/path-safety.ts`, `resolver/safe-extract.ts` |
| Symlink / hardlink escape | Non-file entries rejected; post-extraction tree scan                                          | `resolver/safe-extract.ts`                            |
| Git tag retargeting       | Refs pinned to full commit SHAs in the lockfile                                               | `resolver/git.ts`                                     |
| npm substitution          | Exact version + `dist.integrity` verification, no lifecycle scripts                           | `resolver/resolvers.ts`                               |
| Archive replacement       | SHA-256 pinning for local and remote archives                                                 | `resolver/resolvers.ts`                               |
| Decompression bombs       | File count / size / depth limits, lower-only overrides                                        | `resolver/limits.ts`                                  |
| Case/Unicode collisions   | NFC + case-fold collision detection                                                           | `resolver/path-safety.ts`                             |
| Hidden executable hooks   | Hooks translated by semantics; command hooks deny-by-default; shell strings never preserved   | `adapter-hooks`, `policy/defaults.ts`                 |
| Credential theft          | Secret _references_ only in IR; env/token redaction in errors                                 | `adapter-mcp`, `resolver/context.ts`                  |
| Tool privilege escalation | Mandatory authorization wrapper + tool allowlists + output caps                               | `adapter-mcp/wrapPluginTool`                          |
| Malicious update          | Digest-bound approval records with expiry; frozen lockfile mode                               | `policy/evaluator.ts`, `resolver/lockfile-engine.ts`  |
| Bundle tampering          | Stream-hash verification of every file at load; fail closed                                   | `runtime/load-bundle.ts`                              |
| Namespace spoofing        | Reserved namespaces (`deepagents.*`, `plugin.*`, …), qualified IDs, collision errors          | `schema/ids.ts`, resolver                             |
| Parser exploits           | Safe YAML (core schema), plain JSON.parse, Markdown as text                                   | `resolver/config.ts`, `compiler/frontmatter.ts`       |
| Profile override abuse    | Field governance table; base-prompt/app-tool overrides denied, denied fields stripped         | `policy/evaluator.ts`, `compiler/compile-profiles.ts` |
| PTC approval bypass       | PTC is a separate deny-by-default policy boundary with its own allowlist                      | `schema/policy.ts`, `compiler/compile-interpreter.ts` |
| Async exfiltration        | Agent Protocol endpoint allowlist (`runtime.asyncSubagents.allowedHosts`); no embedded tokens | `compiler/compile-subagents.ts`                       |
| Memory poisoning          | Plugin memory is read-only and agent-scoped by default; writable requests denied (DAP2307)    | `compiler/compile-memory.ts`, `policy/defaults.ts`    |
| Rubric loop abuse         | Templates-only compilation; activation adapter-gated with host-controlled iteration cap       | `compiler/compile-rubrics.ts`                         |
| Stream leakage            | Per-component provenance tags and policy-driven redaction fields in stream metadata           | `compiler/stream-metadata.ts`, `runtime-deepagents`   |
| Capability drift          | Lockfile v2 records detected capabilities; frozen builds fail when they change                | `resolver/lockfile-engine.ts`                         |

## Defaults (RFC Appendix A)

Skills/commands allow after validation; subagents, memory, profiles, and
remote MCP require review; stdio MCP, command hooks, LSP, monitors, binaries,
interpreters, PTC, async subagents, writable plugin memory, and unknown
components are denied. Rubrics compile as templates only. `review` fails in
strict unattended builds unless a digest-bound `PluginApproval` matches.
