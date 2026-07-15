import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { createDeepAgent } from 'deepagents';

import { loadOfficialPluginRuntime } from './load-runtime.js';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY is required to run the live agent example.');
  process.exit(1);
}

const runtime = await loadOfficialPluginRuntime();
if (runtime.skillSources.length === 0) {
  console.error('Bundle has no skills; run compile first.');
  process.exit(1);
}

const skillSummaries = runtime.skills
  .map(
    (skill) =>
      `- ${skill.runtimeName ?? skill.originalName}: ${skill.description ?? 'no description'}`,
  )
  .join('\n');

const agent = await createDeepAgent({
  model: new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    apiKey,
    temperature: 0,
  }),
  skills: runtime.skillSources,
  systemPrompt: [
    runtime.systemPromptPrefix,
    `Compiled skill summaries:\n${skillSummaries}`,
    'You are verifying that Claude Code plugins compiled for Deep Agents are available.',
    'Answer briefly. Prefer the compiled skill summaries above when giving a UI tip.',
    'Do not invent plugins that are not listed.',
  ].join('\n'),
});

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content:
        'In one short paragraph: which official plugins are loaded, and give one concrete frontend UI tip if the frontend-design skill is present.',
    },
  ],
});

const reply = String(result.messages?.at(-1)?.text ?? '').trim();
if (!reply) {
  console.error('Gemini returned an empty response.');
  process.exit(1);
}

console.log(reply.slice(0, 1200));
console.log(
  JSON.stringify({
    ok: true,
    skills: runtime.skills.length,
    commands: runtime.commands.length,
    replyChars: reply.length,
  }),
);
