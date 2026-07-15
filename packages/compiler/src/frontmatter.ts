import { parse as parseYaml } from 'yaml';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

function coerceScalar(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (value === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Line-oriented fallback for Claude plugin frontmatter. Official plugins often
 * leave unquoted values that contain ": " (e.g. "Context: ..."), which strict
 * YAML rejects as nested compact mappings.
 */
export function parseLooseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentKey: string | undefined;
  const currentLines: string[] = [];

  const flush = (): void => {
    if (currentKey === undefined) return;
    const joined = currentLines.join('\n').trimEnd();
    result[currentKey] = coerceScalar(joined.trimStart());
    currentKey = undefined;
    currentLines.length = 0;
  };

  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (match && !/^\s/.test(line)) {
      flush();
      currentKey = match[1];
      const rest = match[2] ?? '';
      if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
        continue;
      }
      currentLines.push(rest);
      continue;
    }
    if (currentKey !== undefined) {
      currentLines.push(line);
    }
  }
  flush();
  return result;
}

function asFrontmatterRecord(parsed: unknown): Record<string, unknown> {
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

/**
 * Parse Markdown frontmatter with safe YAML (core schema, no custom tags).
 * Falls back to a loose key/value parser when YAML rejects real Claude plugin
 * files that embed ": " in unquoted scalar values. Markdown bodies stay opaque
 * (RFC 14.4).
 */
export function parseFrontmatter(text: string): ParsedMarkdown {
  if (!text.startsWith('---')) {
    return { frontmatter: {}, body: text };
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: text };
  }
  const raw = text.slice(4, end);
  const body = text.slice(text.indexOf('\n', end + 1) + 1);
  try {
    return {
      frontmatter: asFrontmatterRecord(parseYaml(raw, { schema: 'core', maxAliasCount: 100 })),
      body,
    };
  } catch {
    return { frontmatter: parseLooseFrontmatter(raw), body };
  }
}

/** Claude-only template variables that need diagnostics (RFC 16.1). */
export function findClaudeVariables(text: string): string[] {
  const matches = text.match(/\$(ARGUMENTS|CLAUDE_PLUGIN_ROOT|CLAUDE_PROJECT_DIR)\b/g) ?? [];
  return [...new Set(matches)].sort();
}

export function normalizeToolList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const list = Array.isArray(value) ? value : value.split(',');
  const cleaned = list.map((tool) => tool.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.sort() : undefined;
}
