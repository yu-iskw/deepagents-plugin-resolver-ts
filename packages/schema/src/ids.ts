/**
 * Identifier and namespace rules (RFC sections 13.3 and 19).
 */

export const RESERVED_NAMESPACES = ['deepagents', 'application', 'system', 'plugin'] as const;

export const DIRECT_MARKETPLACE = 'direct';

/** Normalize a plugin or component name into a stable runtime namespace. */
export function normalizeName(name: string): string {
  const normalized = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (normalized.length === 0) {
    throw new Error(`Name "${name}" normalizes to an empty identifier`);
  }
  return normalized;
}

export function isReservedNamespace(namespace: string): boolean {
  return RESERVED_NAMESPACES.some(
    (reserved) => namespace === reserved || namespace.startsWith(`${reserved}.`),
  );
}

/** Canonical plugin identifier: `<plugin-name>@<marketplace-name>` or `<name>@direct`. */
export function formatPluginId(pluginName: string, marketplaceName?: string): string {
  return `${pluginName}@${marketplaceName ?? DIRECT_MARKETPLACE}`;
}

export interface ParsedPluginId {
  pluginName: string;
  marketplaceName: string;
}

export function parsePluginId(id: string): ParsedPluginId {
  const at = id.lastIndexOf('@');
  if (at <= 0 || at === id.length - 1) {
    return { pluginName: id, marketplaceName: DIRECT_MARKETPLACE };
  }
  return { pluginName: id.slice(0, at), marketplaceName: id.slice(at + 1) };
}

/** Fully qualified internal tool id: `plugin.<namespace>.<tool>`. */
export function qualifiedToolId(pluginNamespace: string, toolName: string): string {
  return `plugin.${pluginNamespace}.${toolName}`;
}

/** Qualified component id such as `acme-review:security-reviewer`. */
export function qualifiedComponentId(pluginNamespace: string, componentName: string): string {
  return `${pluginNamespace}:${componentName}`;
}
