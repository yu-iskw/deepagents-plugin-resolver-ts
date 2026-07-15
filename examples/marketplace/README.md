# Marketplace example

Consume plugins published through a Claude Code marketplace. The marketplace
is a catalog, not a trust authority: each resolved plugin is validated and
policy-checked like any direct source, and pinned by commit SHA in the
lockfile.

For a **runnable** end-to-end example against Anthropic’s official catalog,
see [`../official-marketplace/`](../official-marketplace/).

```yaml
# deepagents.plugins.yaml
apiVersion: deepagents.plugins/v2
kind: PluginSet
metadata:
  name: marketplace-example
marketplaces:
  - name: claude-plugins-official
    source:
      type: github
      repository: anthropics/claude-plugins-official
      ref: main
plugins:
  - id: frontend-design@claude-plugins-official
    trustPolicy: third-party-restricted
```

```bash
pnpm deepagents-plugins resolve          # pins marketplace + plugin to commits
pnpm deepagents-plugins audit            # inspect policy + compatibility results
pnpm deepagents-plugins compile --frozen-lockfile
```

Name collisions between marketplaces fail unless you set an explicit
`alias:` on one of the plugins.
