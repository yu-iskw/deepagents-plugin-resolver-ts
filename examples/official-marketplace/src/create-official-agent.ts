import type { PluginRuntime } from '@deepagents-plugins/core';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { createDeepAgent } from 'deepagents';

import { loadOfficialPluginRuntime } from './load-runtime.js';

/** Build a Deep Agent wired to the compiled official-marketplace plugin bundle. */
export async function createOfficialAgent(
  options: {
    checkpointer?: BaseCheckpointSaver;
    interactive?: boolean;
  } = {},
): Promise<{ agent: ReturnType<typeof createDeepAgent>; runtime: PluginRuntime }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to run the live agent example.');
  }

  const runtime = await loadOfficialPluginRuntime();
  if (runtime.skillSources.length === 0 && runtime.syncSubagents.length === 0) {
    throw new Error('Bundle has no skills or sync subagents; run compile first.');
  }

  const skillSummaries = runtime.skills
    .map(
      (skill) =>
        `- ${skill.runtimeName ?? skill.originalName}: ${skill.description ?? 'no description'}`,
    )
    .join('\n');

  const subagentNames = runtime.syncSubagents.map((subagent) => subagent.name).join(', ');

  const agent = createDeepAgent({
    model: new ChatGoogleGenerativeAI({
      model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
      apiKey,
      temperature: 0,
    }),
    skills: runtime.skillSources,
    // Omit tools so each subagent inherits the main agent's tools (Deep Agents JS docs).
    subagents: runtime.syncSubagents.map((subagent) => ({
      name: subagent.name,
      description: subagent.description,
      systemPrompt: subagent.systemPrompt,
    })),
    systemPrompt: [
      runtime.systemPromptPrefix,
      skillSummaries ? `Compiled skill summaries:\n${skillSummaries}` : '',
      subagentNames ? `Compiled sync subagents (delegate via task): ${subagentNames}.` : '',
      options.interactive
        ? 'You are in an interactive chat. Answer helpfully and briefly.'
        : 'You are verifying that Claude Code plugins compiled for Deep Agents are available.',
      'Prefer the compiled skill summaries above when giving a UI tip.',
      'Do not invent plugins that are not listed.',
    ]
      .filter(Boolean)
      .join('\n'),
    checkpointer: options.checkpointer,
  });

  return { agent, runtime };
}

/** Text of the last agent message from an invoke result. */
export function lastReplyText(result: { messages?: Array<{ text?: string }> }): string {
  return String(result.messages?.at(-1)?.text ?? '').trim();
}

export function exitWithError(error: unknown): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
