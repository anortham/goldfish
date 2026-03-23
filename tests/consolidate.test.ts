import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { ensureMemoriesDir } from '../src/workspace';
import { handleConsolidate } from '../src/handlers/consolidate';

let TEST_DIR: string;

// Suppress semantic cache writes in tests
let restoreDeps: (() => void) | undefined;

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'goldfish-consolidate-'));
  await ensureMemoriesDir(TEST_DIR);
  restoreDeps = __setCheckpointDependenciesForTests({
    queueSemanticRecord: async () => {}
  });
});

afterEach(async () => {
  restoreDeps?.();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('handleConsolidate', () => {
  it('returns "current" status when no unconsolidated checkpoints exist', async () => {
    // Write a checkpoint first
    await saveCheckpoint({ description: 'old checkpoint', workspace: TEST_DIR });

    // Set consolidation state to a future timestamp so everything is "already consolidated"
    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    await writeConsolidationState(TEST_DIR, {
      timestamp: futureTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('current');
    expect(parsed.message).toBeTruthy();
  });

  it('returns "ready" payload with unconsolidated checkpoints when no consolidation state exists', async () => {
    await saveCheckpoint({ description: 'first checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.unconsolidatedCheckpoints).toBeDefined();
    expect(parsed.unconsolidatedCheckpoints.length).toBeGreaterThan(0);
    expect(parsed.prompt).toBeTruthy();
  });

  it('includes existing MEMORY.md content in the payload', async () => {
    const memoryContent = '## Project Overview\n\nThis is a test project.';
    await writeMemory(TEST_DIR, memoryContent);
    await saveCheckpoint({ description: 'a checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.currentMemory).toBe(memoryContent);
  });

  it('only includes checkpoints after last consolidation timestamp', async () => {
    // Save an "old" checkpoint, then record the time, then save a new one.
    // Set consolidation state to between the two checkpoint timestamps.
    await saveCheckpoint({ description: 'old checkpoint before consolidation', workspace: TEST_DIR });

    // Wait a small moment so the consolidation timestamp is clearly after the old checkpoint
    await new Promise(resolve => setTimeout(resolve, 5));
    const consolidationTimestamp = new Date().toISOString();

    // Wait again so the new checkpoint is clearly after the consolidation timestamp
    await new Promise(resolve => setTimeout(resolve, 5));
    await saveCheckpoint({ description: 'new checkpoint after consolidation', workspace: TEST_DIR });

    await writeConsolidationState(TEST_DIR, {
      timestamp: consolidationTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    const descriptions = parsed.unconsolidatedCheckpoints.map((c: any) => c.description);
    expect(descriptions.some((d: string) => d.includes('new checkpoint after consolidation'))).toBe(true);
    expect(descriptions.some((d: string) => d.includes('old checkpoint before consolidation'))).toBe(false);
  });

  it('payload has all expected fields when status is ready', async () => {
    await saveCheckpoint({ description: 'some work done', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');

    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(typeof parsed.checkpointCount).toBe('number');
    expect(Array.isArray(parsed.unconsolidatedCheckpoints)).toBe(true);
    expect(typeof parsed.prompt).toBe('string');
    // currentMemory may be empty string or null when no MEMORY.md exists
    expect('currentMemory' in parsed).toBe(true);
  });
});
