# Claude Code Plugin Compatibility Profile for Deep Agents

Each plugin component compiles to one of five compatibility levels:
`native`, `translated`, `partial`, `unsupported`, or `blocked-by-policy`.

| Claude Code component    | Deep Agents target           | Support         | Notes                                                                                                                                                                  |
| ------------------------ | ---------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/*/SKILL.md`      | Deep Agents skills           | **native**      | Copied with assets under `skills/<namespace>/<skill>/`; `$ARGUMENTS` and other Claude-only variables downgrade the skill to `partial`.                                 |
| `commands/*.md`          | Explicit command descriptors | **translated**  | Exposed via `runtime.invokeCommand`; never auto-injected into the system prompt. `$ARGUMENTS` expands only through explicit invocation (`partial`).                    |
| `agents/*.md`            | Deep Agents subagents        | **translated**  | Description → selection metadata, body → system prompt, tools intersected with host policy, model advisory only. Requires `subagents` capability (default: review).    |
| `.mcp.json` (http/sse)   | Remote MCP descriptors       | **translated**  | Headers/env become secret _references_; the app supplies the MCP client and authorization wrapper. Default: review.                                                    |
| `.mcp.json` (stdio)      | Sandboxed stdio descriptor   | **partial**     | Denied by default policy; requires a bundled executable asset and explicit approval.                                                                                   |
| `hooks/hooks.json`       | Portable lifecycle hooks     | **partial**     | Mapped by semantics, not name (only blocking-capable events become `beforeToolCall`). Webhooks: review. Command hooks: deny by default; shell strings never preserved. |
| `settings.json`          | Advisory metadata            | **partial**     | Never alters authorization, tenancy, persistence, or model selection.                                                                                                  |
| `.lsp.json`              | —                            | **unsupported** | Ignored with a diagnostic.                                                                                                                                             |
| `monitors/monitors.json` | —                            | **unsupported** | Background monitors do not fit request-scoped runtimes; compile to external workers in a future phase.                                                                 |
| `bin/`                   | Executable asset descriptors | opt-in          | Denied by default; when approved, invoked by absolute bundle path with digest verification, never via `PATH`.                                                          |
| Supporting files         | Bundled assets               | **native**      | Copied verbatim, digest-recorded.                                                                                                                                      |

Strict mode fails the build on `partial`, `unsupported`, or `blocked-by-policy`; standard mode fails on errors and policy denials; permissive mode reports everything but still excludes denied components.
