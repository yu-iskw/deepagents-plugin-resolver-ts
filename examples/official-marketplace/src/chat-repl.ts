import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { MemorySaver } from '@langchain/langgraph';

import { createOfficialAgent, exitWithError, lastReplyText } from './create-official-agent.js';

const { agent } = await createOfficialAgent({
  checkpointer: new MemorySaver(),
  interactive: true,
}).catch(exitWithError);

const config = { configurable: { thread_id: 'official-marketplace-chat' } };
const rl = readline.createInterface({ input, output });

console.log('Official-marketplace chat. Type /exit to quit.');

async function handleLine(line: string): Promise<boolean> {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed === '/exit') return false;

  const result = await agent.invoke({ messages: [{ role: 'user', content: trimmed }] }, config);
  console.log(lastReplyText(result) || '(empty reply)');
  return true;
}

function isReadlineClosed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_USE_AFTER_CLOSE'
  );
}

try {
  if (input.isTTY) {
    for (;;) {
      let line: string;
      try {
        line = await rl.question('> ');
      } catch (error) {
        if (isReadlineClosed(error)) break;
        throw error;
      }
      if (!(await handleLine(line))) break;
    }
  } else {
    // Drain stdin first so EOF during invoke does not drop unread turns.
    const lines: string[] = [];
    for await (const raw of rl) {
      lines.push(raw);
    }
    for (const line of lines) {
      if (!(await handleLine(line))) break;
    }
  }
} finally {
  rl.close();
}
