/**
 * Canonical JSON serialization used for every hashed artifact.
 *
 * Determinism rules (RFC section 25): object keys are sorted
 * lexicographically at every depth, arrays keep caller-provided order,
 * output uses two-space indentation and a trailing newline so files are
 * byte-stable across platforms.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry !== undefined) {
        sorted[key] = sortValue(entry);
      }
    }
    return sorted;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Canonical JSON cannot contain non-finite numbers');
  }
  return value;
}

/** Serialize a value to canonical JSON text (sorted keys, LF, trailing newline). */
export function canonicalJsonStringify(value: unknown): string {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

/** Parse JSON without any evaluation semantics beyond JSON.parse. */
export function parseJson(text: string): JsonValue {
  return JSON.parse(text) as JsonValue;
}
