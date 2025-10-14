import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  saveCheckpoint,
  getCheckpointsForDay,
  getCheckpointsForDateRange,
  parseCheckpointFile,
  formatCheckpoint
} from '../src/checkpoints';
import type { Checkpoint, CheckpointInput } from '../src/types';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { join } from 'path';
import { rm } from 'fs/promises';

const TEST_WORKSPACE = `test-checkpoints-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  const workspacePath = getWorkspacePath(TEST_WORKSPACE);
  await rm(workspacePath, { recursive: true, force: true });
});

describe('Checkpoint formatting', () => {
  it('formats checkpoint with all fields', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-10-13T14:30:00.000Z',
      description: 'Fixed authentication bug',
      tags: ['bug-fix', 'auth'],
      gitBranch: 'feature/auth',
      gitCommit: 'a1b2c3d',
      files: ['src/auth/jwt.ts', 'src/auth/session.ts']
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('## 14:30');
    expect(formatted).toContain('Fixed authentication bug');
    expect(formatted).toContain('- **Tags**: bug-fix, auth');
    expect(formatted).toContain('- **Branch**: feature/auth');
    expect(formatted).toContain('- **Commit**: a1b2c3d');
    expect(formatted).toContain('- **Files**: src/auth/jwt.ts, src/auth/session.ts');
  });

  it('formats checkpoint with minimal fields', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-10-13T09:00:00.000Z',
      description: 'Simple checkpoint'
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('## 09:00');
    expect(formatted).toContain('Simple checkpoint');
    expect(formatted).not.toContain('Tags');
    expect(formatted).not.toContain('Branch');
  });

  it('uses UTC time for formatting', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-10-13T23:45:00.000Z',
      description: 'Late night work'
    };

    const formatted = formatCheckpoint(checkpoint);
    expect(formatted).toContain('## 23:45');
  });
});

describe('Checkpoint parsing', () => {
  it('parses checkpoint file with multiple entries', () => {
    const content = `# Checkpoints for 2025-10-13

## 09:30 - Fixed authentication timeout bug
Implemented JWT refresh tokens to extend session duration.

- **Tags**: bug-fix, auth, critical
- **Branch**: feature/jwt-refresh
- **Commit**: a1b2c3d
- **Files**: src/auth/jwt.ts, src/auth/refresh.ts

## 14:45 - Discussed memory architecture
Analyzed three previous implementations.

- **Tags**: planning, goldfish
`;

    const checkpoints = parseCheckpointFile(content);

    expect(checkpoints).toHaveLength(2);

    expect(checkpoints[0]!.description).toBe('Fixed authentication timeout bug');
    expect(checkpoints[0]!.tags).toEqual(['bug-fix', 'auth', 'critical']);
    expect(checkpoints[0]!.gitBranch).toBe('feature/jwt-refresh');
    expect(checkpoints[0]!.gitCommit).toBe('a1b2c3d');
    expect(checkpoints[0]!.files).toEqual(['src/auth/jwt.ts', 'src/auth/refresh.ts']);

    expect(checkpoints[1]!.description).toBe('Discussed memory architecture');
    expect(checkpoints[1]!.tags).toEqual(['planning', 'goldfish']);
  });

  it('handles checkpoint without metadata fields', () => {
    const content = `# Checkpoints for 2025-10-13

## 10:00 - Simple checkpoint
Just some description text.
`;

    const checkpoints = parseCheckpointFile(content);

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.description).toBe('Simple checkpoint');
    expect(checkpoints[0]!.tags).toBeUndefined();
  });

  it('extracts timestamp from header', () => {
    const content = `# Checkpoints for 2025-10-13

## 14:30 - Test checkpoint
Description here.
`;

    const checkpoints = parseCheckpointFile(content, '2025-10-13');

    expect(checkpoints[0]!.timestamp).toMatch(/^2025-10-13T14:30:00/);
  });

  it('handles empty file gracefully', () => {
    const checkpoints = parseCheckpointFile('');
    expect(checkpoints).toEqual([]);
  });
});

describe('Checkpoint storage', () => {
  it('saves checkpoint to daily file', async () => {
    const input: CheckpointInput = {
      description: 'Test checkpoint',
      tags: ['test'],
      workspace: TEST_WORKSPACE
    };

    await saveCheckpoint(input);

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    expect(checkpoints.length).toBeGreaterThan(0);
    expect(checkpoints[0]!.description).toBe('Test checkpoint');
    expect(checkpoints[0]!.tags).toEqual(['test']);
  });

  it('appends to existing daily file', async () => {
    await saveCheckpoint({
      description: 'First checkpoint',
      workspace: TEST_WORKSPACE
    });

    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));

    await saveCheckpoint({
      description: 'Second checkpoint',
      workspace: TEST_WORKSPACE
    });

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]!.description).toBe('First checkpoint');
    expect(checkpoints[1]!.description).toBe('Second checkpoint');
  });

  it('captures git context automatically', async () => {
    await saveCheckpoint({
      description: 'Test with git',
      workspace: TEST_WORKSPACE
    });

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    // Git context may or may not exist depending on whether we're in a repo
    // Just verify the fields are present (even if undefined)
    expect(checkpoints[0]).toHaveProperty('gitBranch');
    expect(checkpoints[0]).toHaveProperty('gitCommit');
  });

  it('handles concurrent writes safely', async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      saveCheckpoint({
        description: `Checkpoint ${i}`,
        workspace: TEST_WORKSPACE
      })
    );

    await Promise.all(writes);

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    // All 10 checkpoints should be saved
    expect(checkpoints).toHaveLength(10);
  });

  it('creates daily file if it doesn\'t exist', async () => {
    // First checkpoint of the day
    await saveCheckpoint({
      description: 'First today',
      workspace: TEST_WORKSPACE
    });

    const today = new Date().toISOString().split('T')[0]!;
    const checkpointsPath = join(
      getWorkspacePath(TEST_WORKSPACE),
      'checkpoints',
      `${today}.md`
    );

    const exists = await Bun.file(checkpointsPath).exists();
    expect(exists).toBe(true);
  });
});

describe('Checkpoint retrieval', () => {
  beforeEach(async () => {
    // Create some test checkpoints
    await saveCheckpoint({
      description: 'Morning work',
      tags: ['feature'],
      workspace: TEST_WORKSPACE
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    await saveCheckpoint({
      description: 'Afternoon work',
      tags: ['bug-fix'],
      workspace: TEST_WORKSPACE
    });
  });

  it('retrieves all checkpoints for a specific day', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]!.description).toBe('Morning work');
    expect(checkpoints[1]!.description).toBe('Afternoon work');
  });

  it('returns empty array for day with no checkpoints', async () => {
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, '2020-01-01');
    expect(checkpoints).toEqual([]);
  });

  it('retrieves checkpoints across date range', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;

    // Add a checkpoint with yesterday's date (manually create file)
    const yesterdayPath = join(
      getWorkspacePath(TEST_WORKSPACE),
      'checkpoints',
      `${yesterday}.md`
    );
    const content = `# Checkpoints for ${yesterday}

## 15:00 - Yesterday's work
Some work from yesterday.

- **Tags**: old
`;
    await Bun.write(yesterdayPath, content);

    const checkpoints = await getCheckpointsForDateRange(
      TEST_WORKSPACE,
      yesterday,
      today
    );

    expect(checkpoints.length).toBeGreaterThanOrEqual(3);  // 1 from yesterday + 2 from today
  });

  it('sorts checkpoints by timestamp', async () => {
    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_WORKSPACE, today);

    // Should be in chronological order
    for (let i = 1; i < checkpoints.length; i++) {
      const prev = new Date(checkpoints[i - 1]!.timestamp);
      const curr = new Date(checkpoints[i]!.timestamp);
      expect(curr.getTime()).toBeGreaterThanOrEqual(prev.getTime());
    }
  });
});
