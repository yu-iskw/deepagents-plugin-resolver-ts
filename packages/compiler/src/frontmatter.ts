import { parse as parseYaml } from 'yaml';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * Parse Markdown frontmatter with safe YAML (core schema, no custom tags).
 * Markdown bodies are treated as opaque text (RFC 14.4).
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
  const parsed: unknown = parseYaml(raw, { schema: 'core', maxAliasCount: 100 });
  return {
    frontmatter:
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    body,
  };
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
