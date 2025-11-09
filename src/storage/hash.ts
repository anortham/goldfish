/**
 * BLAKE3 hashing utilities for content change detection
 *
 * BLAKE3 is used to detect when memory content has changed and needs
 * re-embedding. It's fast, secure, and produces consistent hashes.
 */

import { blake3 } from '@napi-rs/blake-hash';

/**
 * Computes BLAKE3 hash of a string
 * Returns hex-encoded hash string
 *
 * @param content Content to hash
 * @returns Hex-encoded BLAKE3 hash (64 characters)
 *
 * @example
 * ```typescript
 * const hash1 = hashContent("Hello world");
 * const hash2 = hashContent("Hello world");
 * assert(hash1 === hash2); // Same content = same hash
 *
 * const hash3 = hashContent("Hello World");
 * assert(hash1 !== hash3); // Different content = different hash
 * ```
 */
export function hashContent(content: string): string {
  const buffer = Buffer.from(content, 'utf-8');
  const hashBytes = blake3(buffer);
  return hashBytes.toString('hex');
}

/**
 * Computes BLAKE3 hash of an object (by JSON stringifying it)
 * Useful for hashing structured data
 *
 * @param obj Object to hash
 * @returns Hex-encoded BLAKE3 hash
 *
 * @example
 * ```typescript
 * const memory = {
 *   type: 'decision',
 *   content: 'Chose SQLite...',
 *   timestamp: '2025-11-09T10:00:00Z'
 * };
 * const hash = hashObject(memory);
 * ```
 */
export function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj);
  return hashContent(json);
}

/**
 * Verifies if content matches a given hash
 *
 * @param content Content to verify
 * @param expectedHash Expected hash value
 * @returns True if content matches hash
 *
 * @example
 * ```typescript
 * const content = "Fix JWT validation bug";
 * const hash = hashContent(content);
 *
 * // Later, verify content hasn't changed
 * if (!verifyHash(content, hash)) {
 *   console.log('Content changed - regenerate embedding');
 * }
 * ```
 */
export function verifyHash(content: string, expectedHash: string): boolean {
  const actualHash = hashContent(content);
  return actualHash === expectedHash;
}

/**
 * Computes hashes for multiple strings efficiently
 * Returns array of hashes in same order as input
 *
 * @param contents Array of strings to hash
 * @returns Array of hex-encoded hashes
 *
 * @example
 * ```typescript
 * const memories = ['memory 1', 'memory 2', 'memory 3'];
 * const hashes = hashBatch(memories);
 * // hashes.length === 3
 * ```
 */
export function hashBatch(contents: string[]): string[] {
  return contents.map(content => hashContent(content));
}
