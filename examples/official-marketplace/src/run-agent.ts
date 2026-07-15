import { createOfficialAgent, exitWithError, lastReplyText } from './create-official-agent.js';

const { agent, runtime } = await createOfficialAgent().catch(exitWithError);

const result = await agent.invoke({
  messages: [
    {
      role: 'user',
      content:
        'In one short paragraph: which official plugins are loaded, and give one concrete frontend UI tip if the frontend-design skill is present.',
    },
  ],
});

const reply = lastReplyText(result);
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
