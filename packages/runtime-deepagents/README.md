# @deepagents-plugins/runtime-deepagents

Deep Agents composition layer for compiled plugin bundles (RFC v2 sections 11
and 30). Loads an immutable, integrity-verified bundle and turns it into
framework-neutral runtime contributions for `createDeepAgent`.

- **No hard dependency on `deepagents`** — capabilities are detected
  structurally from an injected module (or an optional dynamic import), never
  assumed from version strings.
- **Capability negotiation** — missing required capabilities fail with
  DAP4210; missing optional capabilities disable the component with a warning
  diagnostic.
- **Adapter-gated features** — interpreter, async subagents, and rubrics stay
  inert unless the application registers a matching adapter.

```ts
import { createDeepAgent } from 'deepagents';
import {
  loadPluginBundle,
  createDeepAgentsContributions,
} from '@deepagents-plugins/runtime-deepagents';

const bundle = await loadPluginBundle({
  directory: process.env.DEEPAGENTS_PLUGIN_DIR!,
  verifyIntegrity: true,
});

const contributions = await createDeepAgentsContributions({ bundle });
contributions.registerHarnessProfiles();

const agent = createDeepAgent({
  skills: contributions.skillSources,
  subagents: contributions.syncSubagents,
  // ...
});
```
