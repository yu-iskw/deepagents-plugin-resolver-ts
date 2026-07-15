import { loadOfficialPluginRuntime } from './load-runtime.js';

const runtime = await loadOfficialPluginRuntime();

console.log(
  JSON.stringify(
    {
      ok: true,
      skillSources: runtime.skillSources.length,
      skills: runtime.skills.length,
      commands: runtime.commands.length,
      syncSubagents: runtime.syncSubagents.length,
      skillNames: runtime.skills.map((skill) => skill.runtimeName ?? skill.originalName),
      commandNames: runtime.commands.map((command) => command.name),
      syncSubagentNames: runtime.syncSubagents.map((subagent) => subagent.name),
    },
    null,
    2,
  ),
);

if (runtime.skills.length + runtime.commands.length + runtime.syncSubagents.length === 0) {
  console.error(
    'Expected at least one compiled skill, command, or sync subagent from official plugins.',
  );
  process.exit(1);
}
