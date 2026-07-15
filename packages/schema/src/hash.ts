import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { canonicalJsonStringify } from './canonical-json.js';

export const SHA256_PREFIX = 'sha256:';

/** Hex-encoded SHA-256 of the given bytes or text. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `sha256:<hex>` digest string of the given bytes or text. */
export function sha256Digest(data: string | Uint8Array): string {
  return `${SHA256_PREFIX}${sha256Hex(data)}`;
}

/** Canonical-JSON digest of a structured value. */
export function sha256DigestOfJson(value: unknown): string {
  return sha256Digest(canonicalJsonStringify(value));
}

/** Stream-hash a file without loading it into memory. */
export async function sha256DigestOfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return `${SHA256_PREFIX}${hash.digest('hex')}`;
}

export function isSha256Digest(value: string): boolean {
  return /^sha256:[0-9a-f]{64}$/.test(value);
}

/** Constant-length comparison helper for digest strings. */
export function digestsEqual(a: string, b: string): boolean {
  return a.length === b.length && a === b;
}
