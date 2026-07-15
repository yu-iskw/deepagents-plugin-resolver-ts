# Official marketplace example

Resolve, compile, and load curated plugins from
[anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
into Deep Agents JS.

## Plugins

| Plugin ID                                   | Why             |
| ------------------------------------------- | --------------- |
| `frontend-design@claude-plugins-official`   | Skills          |
| `code-review@claude-plugins-official`       | Commands        |
| `commit-commands@claude-plugins-official`   | Commands        |
| `feature-dev@claude-plugins-official`       | Agents / skills |
| `pr-review-toolkit@claude-plugins-official` | Agents / skills |

LSP-only (`strict: false`) and hooks/MCP-heavy plugins are intentionally omitted.

This example uses `trustPolicy: development` so official `agents/*.md` compile into
Deep Agents sync subagents. Production apps should use `third-party-restricted`
(or similar) plus digest-bound approvals for subagents.

## Prerequisites

- Network access on first `resolve` (clones the official marketplace via GitHub)
- Workspace packages built (`pnpm build` from repo root)
- `GEMINI_API_KEY` for `pnpm agent` and `pnpm chat` (not required for resolve/compile/smoke)

## Commands

From this directory (after `pnpm install` at the repo root):

```bash
pnpm resolve    # fetch + pin deepagents.plugins.lock.json
pnpm compile    # write .deepagents/plugins (frozen lockfile)
pnpm smoke      # load bundle, assert skills/commands/subagents exist
pnpm agent      # one-shot createDeepAgent + Gemini; needs GEMINI_API_KEY
pnpm chat       # interactive multi-turn REPL; needs GEMINI_API_KEY
pnpm verify     # resolve → compile → smoke → agent (no chat)
```

`pnpm chat` uses an in-process LangGraph `MemorySaver` for the session only;
restarting the REPL starts a new thread. Type `/exit` to quit.

Optional: `GEMINI_MODEL` (default `gemini-2.5-flash`).

Do not commit API keys. `.deepagents/` is gitignored.
