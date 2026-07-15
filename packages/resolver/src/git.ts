import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ExitCodes, PluginResolutionError } from '@deepagents-plugins/schema';

import { redactSecrets } from './context.js';

const execFileAsync = promisify(execFile);

/**
 * Abstracted Git execution (RFC section 32). Commands run without a shell,
 * with prompts disabled so private repositories fail fast instead of hanging.
 */
export interface GitClient {
  lsRemote(url: string, ref: string): Promise<string | undefined>;
  clone(url: string, commit: string, destination: string): Promise<void>;
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1',
} as const;

async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      env: { ...process.env, ...GIT_ENV },
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw new PluginResolutionError(
      `git ${args[0]} failed: ${redactSecrets(String(error instanceof Error ? error.message : error))}`,
      ExitCodes.ResolutionFailure,
    );
  }
}

export function createGitClient(): GitClient {
  return {
    async lsRemote(url, ref) {
      const stdout = await runGit(['ls-remote', url, ref, `${ref}^{}`]);
      const lines = stdout.trim().split('\n').filter(Boolean);
      // Prefer the peeled (^{}) entry so annotated tags resolve to commits.
      let sha: string | undefined;
      for (const line of lines) {
        const [hash, name] = line.split('\t');
        if (!hash || !name) continue;
        if (name.endsWith('^{}')) return hash;
        sha ??= hash;
      }
      return sha;
    },
    async clone(url, commit, destination) {
      await runGit(['init', '--quiet', destination]);
      await runGit(['remote', 'add', 'origin', url], destination);
      await runGit(['fetch', '--quiet', '--depth', '1', 'origin', commit], destination);
      await runGit(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], destination);
    },
  };
}

export function isFullCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}
