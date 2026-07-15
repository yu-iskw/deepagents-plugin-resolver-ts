# Custom source resolver example

Register an additional `PluginSourceResolver` for a source type the built-in
set does not cover (for example, an internal artifact store). The resolver
must produce an immutable identity and integrity value so lockfile pinning
and frozen verification keep working.

```ts
import type {
  PluginSourceResolver,
  ResolveContext,
  ResolvedPluginSource,
} from '@deepagents-plugins/resolver';
import { compilePluginSetFromProject } from '@deepagents-plugins/core';

const artifactStoreResolver: PluginSourceResolver = {
  type: 'local', // reuse a declared type or extend the schema union
  canResolve: (spec): spec is never => false,
  async resolve(spec, context: ResolveContext): Promise<ResolvedPluginSource> {
    throw new Error('implement: return an immutable identity + integrity');
  },
  async fetch(resolved, destination) {
    throw new Error('implement: materialize verified bytes into destination');
  },
};

await compilePluginSetFromProject({
  projectDir: process.cwd(),
  extraResolvers: [artifactStoreResolver],
});
```

Conformance expectations for third-party resolvers are exercised by
`@deepagents-plugins/testkit`.
