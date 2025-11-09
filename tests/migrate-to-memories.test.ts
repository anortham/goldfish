import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  migrateCheckpointsToMemories,
  checkpointToMemory,
  type MigrateCheckpointsOptions
} from '../scripts/migrate-to-memories';
import type { Checkpoint } from '../src/types';

const TEST_BASE = join(tmpdir(), `goldfish-migrate-test-${Date.now()}`);
const TEST_GOLDFISH_DIR = join(TEST_BASE, '.goldfish');
const TEST_WORKSPACE = 'test-workspace';

beforeEach(async () => {
  await mkdir(TEST_BASE, { recursive: true });
  await mkdir(join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints'), { recursive: true });
});

afterEach(async () => {
  await rm(TEST_BASE, { recursive: true, force: true });
});

describe('checkpointToMemory', () => {
  it('converts a basic checkpoint to memory format', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Fixed authentication bug in login flow'
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.timestamp).toBe('2025-11-09T10:00:00.000Z');
    expect(memory.content).toBe('Fixed authentication bug in login flow');
    expect(memory.source).toBe('agent');
  });

  it('infers type from tags', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Added new feature',
      tags: ['feature', 'ui']
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.type).toBe('feature');
    expect(memory.tags).toEqual(['feature', 'ui']);
  });

  it('infers bug-fix type from tags', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Fixed memory leak',
      tags: ['bug-fix', 'performance']
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.type).toBe('bug-fix');
  });

  it('infers decision type from tags', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Chose React over Vue',
      tags: ['decision', 'architecture']
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.type).toBe('decision');
  });

  it('defaults to observation type if no matching tags', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Noticed performance improvement',
      tags: ['random', 'other']
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.type).toBe('observation');
  });

  it('preserves tags in memory', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-09T10:00:00.000Z',
      description: 'Test checkpoint',
      tags: ['tag1', 'tag2', 'tag3']
    };

    const memory = checkpointToMemory(checkpoint);

    expect(memory.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });
});

describe('migrateCheckpointsToMemories', () => {
  it('migrates checkpoints from markdown to JSONL', async () => {
    // Create test checkpoint file in correct markdown format
    const checkpointContent = `# Checkpoints for 2025-11-09

## 10:00 - Added new authentication feature

<!--
timestamp: 2025-11-09T10:00:00.000Z
-->

- **Tags**: feature, test

## 11:00 - Fixed login bug

<!--
timestamp: 2025-11-09T11:00:00.000Z
-->

- **Tags**: bug-fix
`;

    await writeFile(
      join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints', '2025-11-09.md'),
      checkpointContent,
      'utf-8'
    );

    // Run migration
    const result = await migrateCheckpointsToMemories({
      workspace: TEST_WORKSPACE,
      targetDir: TEST_BASE,
      goldfishBase: TEST_GOLDFISH_DIR,
      dryRun: false
    });

    expect(result.checkpointsRead).toBe(2);
    expect(result.memoriesWritten).toBe(2);
    expect(result.filesCreated).toContain('.goldfish/memories/2025-11-09.jsonl');
    expect(result.skipped).toBe(0);

    // Verify JSONL file was created
    const jsonlPath = join(TEST_BASE, '.goldfish', 'memories', '2025-11-09.jsonl');
    const jsonlContent = await readFile(jsonlPath, 'utf-8');
    const lines = jsonlContent.trim().split('\n');

    expect(lines.length).toBe(2);

    const memory1 = JSON.parse(lines[0]!);
    expect(memory1.type).toBe('feature');
    expect(memory1.content).toBe('Added new authentication feature');
    expect(memory1.timestamp).toBe('2025-11-09T10:00:00.000Z');

    const memory2 = JSON.parse(lines[1]!);
    expect(memory2.type).toBe('bug-fix');
    expect(memory2.content).toBe('Fixed login bug');
  });

  it('groups memories by date', async () => {
    // Create checkpoints across multiple days
    const day1Content = `# Checkpoints for 2025-11-08

## 10:00 - Day 1 checkpoint

<!--
timestamp: 2025-11-08T10:00:00.000Z
-->
`;

    const day2Content = `# Checkpoints for 2025-11-09

## 10:00 - Day 2 checkpoint 1

<!--
timestamp: 2025-11-09T10:00:00.000Z
-->

## 15:00 - Day 2 checkpoint 2

<!--
timestamp: 2025-11-09T15:00:00.000Z
-->
`;

    await writeFile(
      join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints', '2025-11-08.md'),
      day1Content,
      'utf-8'
    );

    await writeFile(
      join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints', '2025-11-09.md'),
      day2Content,
      'utf-8'
    );

    const result = await migrateCheckpointsToMemories({
      workspace: TEST_WORKSPACE,
      targetDir: TEST_BASE,
      goldfishBase: TEST_GOLDFISH_DIR
    });

    expect(result.checkpointsRead).toBe(3);
    expect(result.memoriesWritten).toBe(3);
    expect(result.filesCreated).toHaveLength(2);
    expect(result.filesCreated).toContain('.goldfish/memories/2025-11-08.jsonl');
    expect(result.filesCreated).toContain('.goldfish/memories/2025-11-09.jsonl');

    // Verify day 1 has 1 memory
    const day1JsonlPath = join(TEST_BASE, '.goldfish', 'memories', '2025-11-08.jsonl');
    const day1JsonlContent = await readFile(day1JsonlPath, 'utf-8');
    expect(day1JsonlContent.trim().split('\n').length).toBe(1);

    // Verify day 2 has 2 memories
    const day2JsonlPath = join(TEST_BASE, '.goldfish', 'memories', '2025-11-09.jsonl');
    const day2JsonlContent = await readFile(day2JsonlPath, 'utf-8');
    expect(day2JsonlContent.trim().split('\n').length).toBe(2);
  });

  it('handles dry run without writing files', async () => {
    const checkpointContent = `# Checkpoints for 2025-11-09

## 10:00 - Test checkpoint

<!--
timestamp: 2025-11-09T10:00:00.000Z
-->
`;

    await writeFile(
      join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints', '2025-11-09.md'),
      checkpointContent,
      'utf-8'
    );

    const result = await migrateCheckpointsToMemories({
      workspace: TEST_WORKSPACE,
      targetDir: TEST_BASE,
      goldfishBase: TEST_GOLDFISH_DIR,
      dryRun: true
    });

    expect(result.checkpointsRead).toBe(1);
    expect(result.memoriesWritten).toBe(0);
    expect(result.filesCreated).toHaveLength(0);

    // Verify no JSONL file was created
    const jsonlPath = join(TEST_BASE, '.goldfish', 'memories', '2025-11-09.jsonl');
    await expect(readFile(jsonlPath, 'utf-8')).rejects.toThrow();
  });

  it('skips invalid checkpoints', async () => {
    const checkpointContent = `# Checkpoints for 2025-11-09

## 10:00 - Valid checkpoint

<!--
timestamp: 2025-11-09T10:00:00.000Z
-->

## 10:30 - Invalid checkpoint (bad timestamp)

<!--
timestamp: invalid-timestamp
-->

## 11:00 -

<!--
timestamp: 2025-11-09T11:00:00.000Z
-->

## 12:00 - Another valid checkpoint

<!--
timestamp: 2025-11-09T12:00:00.000Z
-->
`;

    await writeFile(
      join(TEST_GOLDFISH_DIR, TEST_WORKSPACE, 'checkpoints', '2025-11-09.md'),
      checkpointContent,
      'utf-8'
    );

    const result = await migrateCheckpointsToMemories({
      workspace: TEST_WORKSPACE,
      targetDir: TEST_BASE,
      goldfishBase: TEST_GOLDFISH_DIR
    });

    expect(result.checkpointsRead).toBe(3);  // 3 parse successfully (empty description doesn't match regex)
    expect(result.memoriesWritten).toBe(2);  // Only 2 valid
    expect(result.skipped).toBe(1);  // 1 invalid timestamp (empty description never parsed)
  });

  it('handles empty checkpoints directory', async () => {
    const result = await migrateCheckpointsToMemories({
      workspace: TEST_WORKSPACE,
      targetDir: TEST_BASE
    });

    expect(result.checkpointsRead).toBe(0);
    expect(result.memoriesWritten).toBe(0);
    expect(result.filesCreated).toHaveLength(0);
    expect(result.skipped).toBe(0);
  });
});
