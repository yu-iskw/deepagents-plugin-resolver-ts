import fs from 'node:fs/promises';
import path from 'node:path';

/** Golden-test helpers (RFC 29.2). */

/** Render a stable, sorted listing of every file in a directory tree. */
export async function snapshotTree(root: string): Promise<string> {
  const entries = await fs.readdir(root, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
  return `${files.join('\n')}\n`;
}

export interface GoldenComparison {
  matches: boolean;
  differences: string[];
}

/** Compare actual file contents against a golden directory. */
export async function compareGoldenFiles(
  goldenDir: string,
  actual: Record<string, string>,
): Promise<GoldenComparison> {
  const differences: string[] = [];
  for (const [name, actualContent] of Object.entries(actual)) {
    const goldenPath = path.join(goldenDir, name);
    let expected: string;
    try {
      expected = await fs.readFile(goldenPath, 'utf8');
    } catch {
      differences.push(`missing golden file: ${name}`);
      continue;
    }
    if (expected !== actualContent) {
      differences.push(`content mismatch: ${name}`);
    }
  }
  return { matches: differences.length === 0, differences };
}

/** Write golden files (used with UPDATE_GOLDEN=1). */
export async function updateGoldenFiles(
  goldenDir: string,
  actual: Record<string, string>,
): Promise<void> {
  await fs.mkdir(goldenDir, { recursive: true });
  for (const [name, content] of Object.entries(actual)) {
    await fs.writeFile(path.join(goldenDir, name), content, 'utf8');
  }
}
