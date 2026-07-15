import fs from 'node:fs/promises';
import path from 'node:path';

import * as tar from 'tar';

/**
 * Fixture builders for plugin, marketplace, and malicious-archive tests.
 * Malicious fixtures are generated at test time so no hostile bytes are
 * committed to the repository (RFC 29.6).
 */

export interface PluginFixtureOptions {
  name: string;
  version?: string;
  description?: string;
  skills?: { name: string; description: string; body?: string }[];
  commands?: { name: string; body: string }[];
  agents?: { name: string; description: string; body?: string; endpoint?: string }[];
  memory?: { name: string; body: string; frontmatter?: string }[];
  profiles?: { name: string; fragment: Record<string, unknown> }[];
  rubrics?: { name: string; criteria: string[] }[];
  extraFiles?: Record<string, string>;
}

type FileWriter = (relative: string, content: string) => Promise<void>;

async function writeMarkdownComponents(
  write: FileWriter,
  options: PluginFixtureOptions,
): Promise<void> {
  for (const skill of options.skills ?? []) {
    await write(
      `skills/${skill.name}/SKILL.md`,
      `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${skill.body ?? 'Follow the skill instructions.'}\n`,
    );
  }
  for (const command of options.commands ?? []) {
    await write(`commands/${command.name}.md`, command.body);
  }
  for (const agent of options.agents ?? []) {
    const endpointLine = agent.endpoint ? `\nendpoint: ${agent.endpoint}` : '';
    await write(
      `agents/${agent.name}.md`,
      `---\nname: ${agent.name}\ndescription: ${agent.description}${endpointLine}\n---\n\n${agent.body ?? 'You are a helpful subagent.'}\n`,
    );
  }
  for (const memory of options.memory ?? []) {
    const frontmatter = memory.frontmatter ? `---\n${memory.frontmatter}\n---\n\n` : '';
    await write(`memory/${memory.name}.md`, `${frontmatter}${memory.body}\n`);
  }
}

async function writeJsonComponents(
  write: FileWriter,
  options: PluginFixtureOptions,
): Promise<void> {
  for (const profile of options.profiles ?? []) {
    await write(`profiles/${profile.name}.json`, JSON.stringify(profile.fragment, null, 2));
  }
  for (const rubric of options.rubrics ?? []) {
    await write(
      `rubrics/${rubric.name}.json`,
      JSON.stringify({ name: rubric.name, criteria: rubric.criteria }, null, 2),
    );
  }
}

export async function writePluginFixture(
  dir: string,
  options: PluginFixtureOptions,
): Promise<void> {
  const write: FileWriter = async (relative, content) => {
    const filePath = path.join(dir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  };
  await write(
    '.claude-plugin/plugin.json',
    JSON.stringify(
      {
        name: options.name,
        version: options.version ?? '1.0.0',
        description: options.description ?? 'Test fixture plugin',
      },
      null,
      2,
    ),
  );
  await writeMarkdownComponents(write, options);
  await writeJsonComponents(write, options);
  for (const [relative, content] of Object.entries(options.extraFiles ?? {})) {
    await write(relative, content);
  }
}

export async function writeMarketplaceFixture(
  dir: string,
  name: string,
  plugins: { name: string; source: unknown }[],
): Promise<void> {
  const manifestPath = path.join(dir, '.claude-plugin', 'marketplace.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify({ name, owner: 'testkit', plugins }, null, 2));
}

/** Create a .tgz whose entries claim traversal paths (Zip Slip analogue). */
export async function createTraversalArchive(workDir: string): Promise<string> {
  const sourceDir = path.join(workDir, 'traversal-src');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'payload.txt'), 'escape attempt');
  const archivePath = path.join(workDir, 'traversal.tgz');
  await tar.create(
    {
      file: archivePath,
      cwd: sourceDir,
      gzip: true,
      onWriteEntry: (entry) => {
        entry.path = '../../escaped.txt';
      },
    },
    ['payload.txt'],
  );
  return archivePath;
}

/** Create a .tgz containing a symlink pointing outside the extraction root. */
export async function createSymlinkEscapeArchive(workDir: string): Promise<string> {
  const sourceDir = path.join(workDir, 'symlink-src');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'ok.txt'), 'ok');
  await fs.symlink('/etc/passwd', path.join(sourceDir, 'link'));
  const archivePath = path.join(workDir, 'symlink.tgz');
  await tar.create({ file: archivePath, cwd: sourceDir, gzip: true }, ['ok.txt', 'link']);
  return archivePath;
}

/** Create a .tgz with two entries whose paths collide case-insensitively. */
export async function createCaseCollisionArchive(workDir: string): Promise<string> {
  const sourceDir = path.join(workDir, 'case-src');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'a.txt'), 'lower');
  await fs.writeFile(path.join(sourceDir, 'b.txt'), 'upper');
  const archivePath = path.join(workDir, 'case.tgz');
  let flip = false;
  await tar.create(
    {
      file: archivePath,
      cwd: sourceDir,
      gzip: true,
      onWriteEntry: (entry) => {
        entry.path = flip ? 'File.txt' : 'file.txt';
        flip = true;
      },
    },
    ['a.txt', 'b.txt'],
  );
  return archivePath;
}
