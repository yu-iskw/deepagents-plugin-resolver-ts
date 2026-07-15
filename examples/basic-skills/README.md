# Basic skills example

Declare a local plugin, compile it, and load its skills into Deep Agents.

```yaml
# deepagents.plugins.yaml
apiVersion: deepagents.plugins/v2
kind: PluginSet
metadata:
  name: basic-skills
plugins:
  - id: project-local@direct
    source:
      type: local
      path: ./plugins/project-local
    trustPolicy: development
output:
  directory: .deepagents/plugins
```

```bash
pnpm deepagents-plugins resolve
pnpm deepagents-plugins compile --reproducible
```

```ts
import { createDeepAgent } from 'deepagents';
import { createPluginRuntimeFromDirectory } from '@deepagents-plugins/core';

const runtime = await createPluginRuntimeFromDirectory({
  directory: '.deepagents/plugins',
  verifyIntegrity: true,
});

const agent = await createDeepAgent({
  model,
  skills: runtime.skillSources,
});
```
