/**
 * Tests for BLAKE3 hashing utilities
 */

import { describe, test, expect } from 'bun:test';
import { hashContent, hashObject, verifyHash, hashBatch } from '../src/storage/hash';

describe('BLAKE3 Hashing', () => {
  describe('hashContent', () => {
    test('produces consistent hashes for same content', () => {
      const content = 'Fix JWT validation bug in authentication module';
      const hash1 = hashContent(content);
      const hash2 = hashContent(content);

      expect(hash1).toBe(hash2);
    });

    test('produces different hashes for different content', () => {
      const content1 = 'Hello world';
      const content2 = 'Hello World'; // Different case

      const hash1 = hashContent(content1);
      const hash2 = hashContent(content2);

      expect(hash1).not.toBe(hash2);
    });

    test('returns 64-character hex string', () => {
      const content = 'Test content';
      const hash = hashContent(content);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
    });

    test('handles empty string', () => {
      const hash = hashContent('');

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    test('handles unicode characters', () => {
      const content = '测试内容 🚀 émojis';
      const hash = hashContent(content);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    test('produces different hashes for different lengths', () => {
      const short = 'a';
      const long = 'a'.repeat(1000);

      const hash1 = hashContent(short);
      const hash2 = hashContent(long);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('hashObject', () => {
    test('produces consistent hashes for same object', () => {
      const obj = {
        type: 'decision',
        content: 'Chose SQLite',
        timestamp: '2025-11-09T10:00:00Z'
      };

      const hash1 = hashObject(obj);
      const hash2 = hashObject(obj);

      expect(hash1).toBe(hash2);
    });

    test('produces different hashes for different objects', () => {
      const obj1 = { type: 'decision', content: 'A' };
      const obj2 = { type: 'decision', content: 'B' };

      const hash1 = hashObject(obj1);
      const hash2 = hashObject(obj2);

      expect(hash1).not.toBe(hash2);
    });

    test('is sensitive to property order', () => {
      // JSON.stringify preserves insertion order
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      const hash1 = hashObject(obj1);
      const hash2 = hashObject(obj2);

      // Different property order = different JSON = different hash
      expect(hash1).not.toBe(hash2);
    });

    test('handles nested objects', () => {
      const obj = {
        outer: {
          inner: {
            deep: 'value'
          }
        }
      };

      const hash = hashObject(obj);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });

    test('handles arrays', () => {
      const obj = {
        tags: ['database', 'architecture', 'decision']
      };

      const hash = hashObject(obj);

      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);
    });
  });

  describe('verifyHash', () => {
    test('returns true for matching content and hash', () => {
      const content = 'Fix authentication bug';
      const hash = hashContent(content);

      expect(verifyHash(content, hash)).toBe(true);
    });

    test('returns false for non-matching content', () => {
      const content1 = 'Original content';
      const content2 = 'Modified content';
      const hash = hashContent(content1);

      expect(verifyHash(content2, hash)).toBe(false);
    });

    test('returns false for tampered hash', () => {
      const content = 'Some content';
      const hash = hashContent(content);
      const tamperedHash = hash.slice(0, -1) + 'x'; // Modify last character

      expect(verifyHash(content, tamperedHash)).toBe(false);
    });

    test('is case-sensitive for content', () => {
      const content = 'Hello World';
      const hash = hashContent(content);

      expect(verifyHash('hello world', hash)).toBe(false);
    });
  });

  describe('hashBatch', () => {
    test('returns array of hashes matching input length', () => {
      const contents = ['memory 1', 'memory 2', 'memory 3'];
      const hashes = hashBatch(contents);

      expect(hashes.length).toBe(contents.length);
      expect(hashes.every(h => typeof h === 'string')).toBe(true);
      expect(hashes.every(h => h.length === 64)).toBe(true);
    });

    test('produces same hashes as individual calls', () => {
      const contents = ['memory 1', 'memory 2', 'memory 3'];
      const batchHashes = hashBatch(contents);
      const individualHashes = contents.map(c => hashContent(c));

      expect(batchHashes).toEqual(individualHashes);
    });

    test('handles empty array', () => {
      const hashes = hashBatch([]);

      expect(hashes.length).toBe(0);
    });

    test('handles single item', () => {
      const hashes = hashBatch(['single item']);

      expect(hashes.length).toBe(1);
      expect(hashes[0]).toBe(hashContent('single item'));
    });

    test('produces unique hashes for unique content', () => {
      const contents = ['a', 'b', 'c', 'd', 'e'];
      const hashes = hashBatch(contents);

      // All hashes should be different
      const uniqueHashes = new Set(hashes);
      expect(uniqueHashes.size).toBe(hashes.length);
    });
  });

  describe('Real-world usage patterns', () => {
    test('detects content changes in memories', () => {
      const originalMemory = {
        type: 'decision',
        content: 'Chose SQLite for vector storage',
        timestamp: '2025-11-09T10:00:00Z'
      };

      const originalHash = hashObject(originalMemory);

      // Content changed
      const modifiedMemory = {
        ...originalMemory,
        content: 'Chose PostgreSQL for vector storage' // Changed!
      };

      const modifiedHash = hashObject(modifiedMemory);

      expect(originalHash).not.toBe(modifiedHash);
    });

    test('timestamp changes produce different hashes', () => {
      const memory1 = {
        type: 'decision',
        content: 'Same content',
        timestamp: '2025-11-09T10:00:00Z'
      };

      const memory2 = {
        ...memory1,
        timestamp: '2025-11-09T11:00:00Z' // Different timestamp
      };

      const hash1 = hashObject(memory1);
      const hash2 = hashObject(memory2);

      expect(hash1).not.toBe(hash2);
    });

    test('hashing only content field for embedding change detection', () => {
      // For embeddings, we only care about content changes, not metadata
      const memory1 = {
        type: 'decision',
        content: 'This is the actual content',
        timestamp: '2025-11-09T10:00:00Z'
      };

      const memory2 = {
        type: 'feature', // Changed metadata
        content: 'This is the actual content', // Same content
        timestamp: '2025-11-09T11:00:00Z' // Changed timestamp
      };

      // Hash only content
      const hash1 = hashContent(memory1.content);
      const hash2 = hashContent(memory2.content);

      // Same content = same hash, despite other changes
      expect(hash1).toBe(hash2);
    });
  });
});
