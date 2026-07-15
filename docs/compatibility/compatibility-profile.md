# Claude Code Plugin Compatibility Profile for Deep Agents

Each plugin component compiles to one of the compatibility statuses
(RFC section 10): `native`, `translated`, `partial`, `unsupported`,
`blocked-by-policy`, `runtime-unavailable`, `requires-adapter`, or
`requires-approval`.

- `runtime-unavailable` — the capability is documented for Deep Agents
  Python but not exposed by the installed Deep Agents JS runtime.
- `requires-adapter` — the capability activates only through an
  application-registered adapter (interpreter, async transport, rubric).
- `requires-approval` — the policy effect is `review` and no digest-bound
  approval matches.

| Claude Code component    | Deep Agents target               | Support              | Notes                                                                                                                                                                  |
| ------------------------ | -------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/*/SKILL.md`      | Deep Agents skills               | **native**           | Copied with assets under `skills/<namespace>/<skill>/`; `$ARGUMENTS` and other Claude-only variables downgrade the skill to `partial`.                                 |
| `commands/*.md`          | Explicit command descriptors     | **translated**       | Exposed via `runtime.invokeCommand`; never auto-injected into the system prompt. `$ARGUMENTS` expands only through explicit invocation (`partial`).                    |
| `agents/*.md`            | Synchronous subagents            | **translated**       | Description → selection metadata, body → system prompt, tools intersected with host policy, model advisory only. Default: review.                                      |
| `agents/*.md` + endpoint | Async subagents (Agent Protocol) | **requires-adapter** | Endpoint must match `runtime.asyncSubagents.allowedHosts`; activation needs an application-registered transport. Default: review.                                      |
| `memory/**/*.md`         | Read-only memory sources         | **translated**       | Agent-scoped, read-only by default; writable requests are `blocked-by-policy` (DAP2307). Persistent stores remain application-owned.                                   |
| `profiles/*.json`        | Harness profile fragments        | **translated**       | Field governance per RFC 14: base-prompt replacement and application-tool overrides denied for third parties; denied fields stripped with DAP2308.                     |
| `.mcp.json` (http/sse)   | Remote MCP descriptors           | **translated**       | Headers/env become secret _references_; the app supplies the MCP client and authorization wrapper. Default: review.                                                    |
| `.mcp.json` (stdio)      | Sandboxed stdio descriptor       | **partial**          | Denied by default policy; requires a bundled executable asset and explicit approval.                                                                                   |
| `hooks/hooks.json`       | Portable lifecycle hooks         | **partial**          | Mapped by semantics, not name (only blocking-capable events become `beforeToolCall`). Webhooks: review. Command hooks: deny by default; shell strings never preserved. |
| `rubrics/*.json`         | Rubric templates                 | **templates-only**   | Compiled as data under `rubrics/<namespace>/`; runtime activation is `requires-adapter` and host-governed (grader, iteration cap).                                     |
| Interpreter config       | Interpreter policy descriptor    | **requires-adapter** | Disabled by default; PTC is a separate deny-by-default policy boundary. No JS interpreter adapter → `runtime-unavailable` (DAP4207).                                   |
| `settings.json`          | Advisory metadata                | **partial**          | Never alters authorization, tenancy, persistence, or model selection.                                                                                                  |
| `.lsp.json`              | —                                | **unsupported**      | Ignored with a diagnostic.                                                                                                                                             |
| `monitors/monitors.json` | —                                | **unsupported**      | Background monitors do not fit request-scoped runtimes; compile to external workers in a future phase.                                                                 |
| `bin/`                   | Executable asset descriptors     | opt-in               | Denied by default; when approved, invoked by absolute bundle path with digest verification, never via `PATH`.                                                          |
| Supporting files         | Bundled assets                   | **native**           | Copied verbatim, digest-recorded.                                                                                                                                      |

Strict mode fails the build on `partial`, `unsupported`, `blocked-by-policy`,
`runtime-unavailable`, `requires-adapter`, or `requires-approval`; standard
mode fails on errors and policy denials; permissive mode reports everything
but still excludes denied components.
