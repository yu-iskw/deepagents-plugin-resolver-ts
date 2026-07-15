# deepagents-plugin-resolver-ts

Build-time resolver, compiler, and runtime loader that lets [Deep Agents JS](https://github.com/langchain-ai/deepagentsjs) applications consume compatible capabilities from [Claude Code plugins](https://code.claude.com/docs/en/plugins) and plugin marketplaces — without embedding Claude Code, cloning repositories at runtime, or trusting plugin content.

> **Resolve, validate, and compile untrusted plugins before deployment; load only immutable, policy-approved artifacts at runtime.**

See [RFC.md](RFC.md) for the full design.

## How it works

1. **Resolve** — plugins declared in `deepagents.plugins.yaml` are fetched from Claude Code marketplaces, GitHub, generic Git, npm, archives, or local directories. Every mutable reference is pinned (Git SHA, exact npm version + integrity, archive SHA-256) into `deepagents.plugins.lock.json`.
2. **Validate** — structure, manifests, paths, symlinks, sizes, and archive expansion are checked; nothing is ever executed during inspection.
3. **Policy** — an application-owned policy classifies each capability (`allow` / `review` / `deny`). Executable behavior (stdio MCP, command hooks, binaries, monitors, LSP) is denied by default.
4. **Compile** — supported components translate into a stable, versioned intermediate representation (skills, commands, subagents, MCP descriptors, hooks) with an honest compatibility level: `native`, `translated`, `partial`, `unsupported`, or `blocked-by-policy`.
5. **Bundle** — assets are materialized into a deterministic directory (`.deepagents/plugins`) with a digest-bound bundle manifest, compatibility report, provenance records, and optional CycloneDX SBOM — ready to `COPY` into an OCI image.
6. **Load** — at runtime, `@deepagents-plugins/runtime` verifies every file against the bundle manifest (fail closed) and exposes skills, commands, subagents, and wrapped tools to `createDeepAgent`. No network, Git, or package installation at runtime.

## Packages

| Package                             | Responsibility                                                    |
| ----------------------------------- | ----------------------------------------------------------------- |
| `@deepagents-plugins/schema`        | Zod schemas, portable IR, shared types, canonical JSON + hashing  |
| `@deepagents-plugins/policy`        | Capability/source policy engine, profiles, digest-bound approvals |
| `@deepagents-plugins/resolver`      | Source + marketplace resolution, safe extraction, lockfile engine |
| `@deepagents-plugins/compiler`      | Component translation into IR, deterministic bundler, reports     |
| `@deepagents-plugins/adapter-mcp`   | MCP descriptors and authorization-wrapped tool construction       |
| `@deepagents-plugins/adapter-hooks` | Safe lifecycle hook translation, middleware adapter registry      |
| `@deepagents-plugins/runtime`       | Bundle verification and runtime loading (no build-time deps)      |
| `@deepagents-plugins/core`          | Stable facade over the resolve → compile → load pipeline          |
| `@deepagents-plugins/cli`           | `deepagents-plugins` command-line tool                            |
| `@deepagents-plugins/testkit`       | Fixture builders, golden tests, security conformance suite        |

## Quickstart

```bash
pnpm add @deepagents-plugins/runtime
pnpm add -D @deepagents-plugins/cli

pnpm deepagents-plugins init          # create deepagents.plugins.yaml
pnpm deepagents-plugins add example-plugin@my-marketplace
pnpm deepagents-plugins resolve       # pin sources into the lockfile
pnpm deepagents-plugins audit         # policy + compatibility report
pnpm deepagents-plugins compile --frozen-lockfile --reproducible
```

Use the compiled bundle with Deep Agents:

```ts
import { createDeepAgent } from 'deepagents';
import { createPluginRuntimeFromDirectory } from '@deepagents-plugins/core';

const runtime = await createPluginRuntimeFromDirectory({
  directory: process.env.DEEPAGENTS_PLUGIN_DIR ?? '.deepagents/plugins',
  verifyIntegrity: true,
});

const agent = await createDeepAgent({
  model,
  skills: runtime.skillSources,
  subagents: runtime.subagents,
  systemPrompt: { prefix: runtime.systemPromptPrefix },
});
```

See [`examples/`](examples/) for marketplace usage, Cloud Run deployment, and custom source resolvers, and [`docs/`](docs/) for architecture, compatibility, and security references.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Golden outputs under `fixtures/golden/` are regenerated with `UPDATE_GOLDEN=1 pnpm vitest run packages/testkit`.

## License

Apache-2.0
