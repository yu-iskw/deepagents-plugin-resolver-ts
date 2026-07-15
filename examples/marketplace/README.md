# Marketplace example

Consume a plugin published through a Claude Code marketplace. The
marketplace is a catalog, not a trust authority: the resolved plugin is
validated and policy-checked like any direct source, and pinned by commit
SHA in the lockfile.

```yaml
# deepagents.plugins.yaml
apiVersion: deepagents.plugins/v1
kind: PluginSet
metadata:
  name: marketplace-example
marketplaces:
  - name: acme-official
    source:
      type: github
      repository: acme/claude-plugins
      ref: main
plugins:
  - id: review-tools@acme-official
    policyProfile: third-party-restricted
```

```bash
pnpm deepagents-plugins resolve          # pins marketplace + plugin to commits
pnpm deepagents-plugins audit            # inspect policy + compatibility results
pnpm deepagents-plugins compile --frozen-lockfile
```

Name collisions between marketplaces fail unless you set an explicit
`alias:` on one of the plugins.
