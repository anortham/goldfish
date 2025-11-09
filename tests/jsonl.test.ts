/**
 * Tests for JSONL storage utilities
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Memory } from '../src/storage/types';
import {
  readJsonl,
  writeJsonl,
  appendJsonl,
  appendJsonlBatch,
  getMemoryFilePath,
  scanJsonlFiles,
  readAllJsonl
} from '../src/storage/jsonl';

describe('JSONL Storage', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'goldfish-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('writeJsonl and readJsonl', () => {
    test('writes and reads memories correctly', async () => {
      const memories: Memory[] = [
        {
          type: 'decision',
          source: 'agent',
          content: 'Chose SQLite for vector storage',
          timestamp: '2025-11-09T10:00:00.000Z',
          tags: ['database']
        },
        {
          type: 'bug-fix',
          source: 'user',
          content: 'Fixed JWT validation issue',
          timestamp: '2025-11-09T11:00:00.000Z'
        }
      ];

      const filePath = join(tempDir, 'test.jsonl');
      await writeJsonl(filePath, memories);

      const readMemories = await readJsonl(filePath);

      expect(readMemories.length).toBe(2);
      expect(readMemories[0].type).toBe('decision');
      expect(readMemories[0].content).toBe('Chose SQLite for vector storage');
      expect(readMemories[1].type).toBe('bug-fix');
    });

    test('includes metadata in read memories', async () => {
      const memories: Memory[] = [
        {
          type: 'feature',
          source: 'agent',
          content: 'Implemented semantic search',
          timestamp: '2025-11-09T10:00:00.000Z'
        }
      ];

      const filePath = join(tempDir, 'test.jsonl');
      await writeJsonl(filePath, memories);

      const readMemories = await readJsonl(filePath);

      expect(readMemories[0].lineNumber).toBe(1);
      expect(readMemories[0].filePath).toBe(filePath);
      expect(readMemories[0].hash).toBeDefined();
      expect(typeof readMemories[0].hash).toBe('string');
    });

    test('returns empty array for non-existent file', async () => {
      const filePath = join(tempDir, 'nonexistent.jsonl');
      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(0);
    });

    test('handles empty memory array', async () => {
      const filePath = join(tempDir, 'empty.jsonl');
      await writeJsonl(filePath, []);

      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(0);
    });

    test('preserves memory order', async () => {
      const memories: Memory[] = [
        {
          type: 'decision',
          source: 'agent',
          content: 'First memory',
          timestamp: '2025-11-09T10:00:00.000Z'
        },
        {
          type: 'feature',
          source: 'agent',
          content: 'Second memory',
          timestamp: '2025-11-09T11:00:00.000Z'
        },
        {
          type: 'bug-fix',
          source: 'user',
          content: 'Third memory',
          timestamp: '2025-11-09T12:00:00.000Z'
        }
      ];

      const filePath = join(tempDir, 'ordered.jsonl');
      await writeJsonl(filePath, memories);

      const readMemories = await readJsonl(filePath);

      expect(readMemories.map(m => m.content)).toEqual([
        'First memory',
        'Second memory',
        'Third memory'
      ]);
    });
  });

  describe('appendJsonl', () => {
    test('appends memory to file', async () => {
      const filePath = join(tempDir, 'append.jsonl');

      const memory1: Memory = {
        type: 'decision',
        source: 'agent',
        content: 'First memory',
        timestamp: '2025-11-09T10:00:00.000Z'
      };

      await appendJsonl(filePath, memory1);

      const memory2: Memory = {
        type: 'feature',
        source: 'agent',
        content: 'Second memory',
        timestamp: '2025-11-09T11:00:00.000Z'
      };

      await appendJsonl(filePath, memory2);

      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(2);
      expect(memories[0].content).toBe('First memory');
      expect(memories[1].content).toBe('Second memory');
    });

    test('creates file if it doesn\'t exist', async () => {
      const filePath = join(tempDir, 'new', 'file.jsonl');

      const memory: Memory = {
        type: 'decision',
        source: 'agent',
        content: 'First memory',
        timestamp: '2025-11-09T10:00:00.000Z'
      };

      await appendJsonl(filePath, memory);

      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(1);
      expect(memories[0].content).toBe('First memory');
    });
  });

  describe('appendJsonlBatch', () => {
    test('appends multiple memories at once', async () => {
      const filePath = join(tempDir, 'batch.jsonl');

      const memories: Memory[] = [
        {
          type: 'decision',
          source: 'agent',
          content: 'Memory 1',
          timestamp: '2025-11-09T10:00:00.000Z'
        },
        {
          type: 'feature',
          source: 'agent',
          content: 'Memory 2',
          timestamp: '2025-11-09T11:00:00.000Z'
        },
        {
          type: 'bug-fix',
          source: 'user',
          content: 'Memory 3',
          timestamp: '2025-11-09T12:00:00.000Z'
        }
      ];

      await appendJsonlBatch(filePath, memories);

      const readMemories = await readJsonl(filePath);

      expect(readMemories.length).toBe(3);
      expect(readMemories.map(m => m.content)).toEqual(['Memory 1', 'Memory 2', 'Memory 3']);
    });

    test('works with empty array', async () => {
      const filePath = join(tempDir, 'batch-empty.jsonl');

      await appendJsonlBatch(filePath, []);

      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(0);
    });
  });

  describe('getMemoryFilePath', () => {
    test('generates correct path for Date object', () => {
      const date = new Date('2025-11-09T10:00:00.000Z');
      const path = getMemoryFilePath('/base', date);

      expect(path).toContain('2025-11-09.jsonl');
    });

    test('generates correct path for ISO string', () => {
      const path = getMemoryFilePath('/base', '2025-11-09T15:30:00.000Z');

      expect(path).toContain('2025-11-09.jsonl');
    });

    test('uses only date part, not time', () => {
      const morning = getMemoryFilePath('/base', '2025-11-09T08:00:00.000Z');
      const evening = getMemoryFilePath('/base', '2025-11-09T20:00:00.000Z');

      expect(morning).toBe(evening);
    });
  });

  describe('scanJsonlFiles', () => {
    test('finds all JSONL files in directory', async () => {
      // Create multiple JSONL files
      await writeJsonl(join(tempDir, '2025-11-01.jsonl'), []);
      await writeJsonl(join(tempDir, '2025-11-02.jsonl'), []);
      await writeJsonl(join(tempDir, '2025-11-03.jsonl'), []);

      const files = await scanJsonlFiles(tempDir);

      expect(files.length).toBe(3);
      expect(files.every(f => f.endsWith('.jsonl'))).toBe(true);
    });

    test('returns files in sorted order', async () => {
      // Create files in random order
      await writeJsonl(join(tempDir, '2025-11-03.jsonl'), []);
      await writeJsonl(join(tempDir, '2025-11-01.jsonl'), []);
      await writeJsonl(join(tempDir, '2025-11-02.jsonl'), []);

      const files = await scanJsonlFiles(tempDir);

      // Should be sorted (oldest to newest)
      expect(files[0]).toContain('2025-11-01.jsonl');
      expect(files[1]).toContain('2025-11-02.jsonl');
      expect(files[2]).toContain('2025-11-03.jsonl');
    });

    test('ignores non-JSONL files', async () => {
      await writeJsonl(join(tempDir, 'memories.jsonl'), []);
      await Bun.write(join(tempDir, 'notes.txt'), 'some notes');
      await Bun.write(join(tempDir, 'data.json'), '{}');

      const files = await scanJsonlFiles(tempDir);

      expect(files.length).toBe(1);
      expect(files[0]).toContain('memories.jsonl');
    });

    test('returns empty array for non-existent directory', async () => {
      const files = await scanJsonlFiles(join(tempDir, 'nonexistent'));

      expect(files.length).toBe(0);
    });
  });

  describe('readAllJsonl', () => {
    test('reads memories from multiple files', async () => {
      const memory1: Memory = {
        type: 'decision',
        source: 'agent',
        content: 'Memory from day 1',
        timestamp: '2025-11-01T10:00:00.000Z'
      };

      const memory2: Memory = {
        type: 'feature',
        source: 'agent',
        content: 'Memory from day 2',
        timestamp: '2025-11-02T10:00:00.000Z'
      };

      const memory3: Memory = {
        type: 'bug-fix',
        source: 'user',
        content: 'Memory from day 3',
        timestamp: '2025-11-03T10:00:00.000Z'
      };

      await writeJsonl(join(tempDir, '2025-11-01.jsonl'), [memory1]);
      await writeJsonl(join(tempDir, '2025-11-02.jsonl'), [memory2]);
      await writeJsonl(join(tempDir, '2025-11-03.jsonl'), [memory3]);

      const allMemories = await readAllJsonl(tempDir);

      expect(allMemories.length).toBe(3);
      expect(allMemories[0].content).toBe('Memory from day 1');
      expect(allMemories[1].content).toBe('Memory from day 2');
      expect(allMemories[2].content).toBe('Memory from day 3');
    });

    test('sorts memories by timestamp across files', async () => {
      const memory1: Memory = {
        type: 'decision',
        source: 'agent',
        content: 'Later memory',
        timestamp: '2025-11-01T15:00:00.000Z'
      };

      const memory2: Memory = {
        type: 'feature',
        source: 'agent',
        content: 'Earlier memory',
        timestamp: '2025-11-01T10:00:00.000Z'
      };

      // Write in non-chronological order
      await writeJsonl(join(tempDir, '2025-11-01.jsonl'), [memory1, memory2]);

      const allMemories = await readAllJsonl(tempDir);

      // Should be sorted by timestamp
      expect(allMemories[0].content).toBe('Earlier memory');
      expect(allMemories[1].content).toBe('Later memory');
    });

    test('returns empty array for empty directory', async () => {
      const memories = await readAllJsonl(tempDir);

      expect(memories.length).toBe(0);
    });
  });

  describe('Real-world usage patterns', () => {
    test('daily memory accumulation pattern', async () => {
      const baseDir = join(tempDir, '.goldfish', 'memories');

      // Day 1: Store 2 memories
      await appendJsonl(getMemoryFilePath(baseDir, '2025-11-01T00:00:00Z'), {
        type: 'decision',
        source: 'agent',
        content: 'Decision 1',
        timestamp: '2025-11-01T10:00:00.000Z'
      });

      await appendJsonl(getMemoryFilePath(baseDir, '2025-11-01T00:00:00Z'), {
        type: 'feature',
        source: 'agent',
        content: 'Feature 1',
        timestamp: '2025-11-01T11:00:00.000Z'
      });

      // Day 2: Store 1 memory
      await appendJsonl(getMemoryFilePath(baseDir, '2025-11-02T00:00:00Z'), {
        type: 'bug-fix',
        source: 'user',
        content: 'Bug fix 1',
        timestamp: '2025-11-02T10:00:00.000Z'
      });

      // Read all memories
      const allMemories = await readAllJsonl(baseDir);

      expect(allMemories.length).toBe(3);

      // Check files
      const files = await scanJsonlFiles(baseDir);
      expect(files.length).toBe(2);
    });

    test('git merge scenario - different developers adding to same day', async () => {
      const filePath = join(tempDir, '2025-11-09.jsonl');

      // Developer A adds memories
      await appendJsonl(filePath, {
        type: 'feature',
        source: 'agent',
        content: 'Dev A: Added feature X',
        timestamp: '2025-11-09T10:00:00.000Z'
      });

      // Developer B (in different branch) adds memories
      await appendJsonl(filePath, {
        type: 'feature',
        source: 'agent',
        content: 'Dev B: Added feature Y',
        timestamp: '2025-11-09T10:30:00.000Z'
      });

      // After git merge, both memories should be present
      const memories = await readJsonl(filePath);

      expect(memories.length).toBe(2);
      expect(memories.some(m => m.content.includes('Dev A'))).toBe(true);
      expect(memories.some(m => m.content.includes('Dev B'))).toBe(true);
    });
  });
});
