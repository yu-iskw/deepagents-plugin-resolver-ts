import { describe, expect, it } from 'vitest';

import { translateMcpServer } from './index.js';

describe('translateMcpServer', () => {
  it('derives stdio commandAssetId from the command basename', () => {
    const result = translateMcpServer('demo@direct', 'demo', 'local', {
      command: './bin/server',
      args: ['--stdio'],
    });
    expect(result.capability).toBe('mcp.stdio');
    expect(result.server?.commandAssetId).toBe('demo:bin:server');
  });

  it('normalizes command basenames for asset ids', () => {
    const result = translateMcpServer('demo@direct', 'demo', 'tools', {
      command: '/opt/My Tool/bin/My_Server.sh',
    });
    expect(result.server?.commandAssetId).toBe('demo:bin:my-server-sh');
  });
});
