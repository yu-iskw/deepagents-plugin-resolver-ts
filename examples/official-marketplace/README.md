# Official marketplace example

Resolve, compile, and load curated plugins from
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
into Deep Agents JS. A live Gemini smoke run exercises the loaded skills.

## Plugins

| Plugin ID                                   | Why             |
| ------------------------------------------- | --------------- |
| `frontend-design@claude-plugins-official`   | Skills          |
| `code-review@claude-plugins-official`       | Commands        |
| `commit-commands@claude-plugins-official`   | Commands        |
| `feature-dev@claude-plugins-official`       | Agents / skills |
| `pr-review-toolkit@claude-plugins-official` | Agents / skills |

LSP-only (`strict: false`) and hooks/MCP-heavy plugins are intentionally omitted.

Under `third-party-restricted`, sync subagents from official plugins are
recorded as `requires-approval` until digest-bound approvals are added; skills
and commands still compile and load.

## Prerequisites

- Network access on first `resolve` (clones the official marketplace via GitHub)
- Workspace packages built (`pnpm build` from repo root)
- `GEMINI_API_KEY` for `pnpm agent` only (not required for resolve/compile/smoke)

## Commands

From this directory (after `pnpm install` at the repo root):

```bash
pnpm resolve    # fetch + pin deepagents.plugins.lock.json
pnpm compile    # write .deepagents/plugins (frozen lockfile)
pnpm smoke      # load bundle, assert skills/commands exist
pnpm agent      # createDeepAgent + Gemini; needs GEMINI_API_KEY
pnpm verify     # resolve → compile → smoke → agent
```

Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).

Do not commit API keys. `.deepagents/` is gitignored.
