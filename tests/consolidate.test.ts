import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { ensureMemoriesDir, getPlansDir } from '../src/workspace';
import { savePlan, setActivePlan, updatePlan } from '../src/plans';
import { handleConsolidate } from '../src/handlers/consolidate';

let TEST_DIR: string;
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
  it('returns "current" when no unconsolidated checkpoints exist', async () => {
    await saveCheckpoint({ description: 'old checkpoint', workspace: TEST_DIR });

    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    await writeConsolidationState(TEST_DIR, {
      timestamp: futureTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('current');
    expect(parsed.message).toBeTruthy();
    expect(parsed.checkpointFiles).toBeUndefined();
  });

  it('returns file paths instead of checkpoint content', async () => {
    await saveCheckpoint({ description: 'first checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(Array.isArray(parsed.checkpointFiles)).toBe(true);
    expect(parsed.checkpointFiles.length).toBe(1);
    expect(parsed.checkpointFiles[0]).toContain('.memories/');
    expect(parsed.checkpointFiles[0]).toEndWith('.md');

    // Content fields must NOT be present
    expect(parsed.unconsolidatedCheckpoints).toBeUndefined();
    expect(parsed.currentMemory).toBeUndefined();
    expect(parsed.activePlan).toBeUndefined();
  });

  it('returns memoryPath and lastConsolidatedPath', async () => {
    await saveCheckpoint({ description: 'a checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.memoryPath).toBe(join(TEST_DIR, '.memories', 'MEMORY.md'));
    expect(parsed.lastConsolidatedPath).toBe(join(TEST_DIR, '.memories', '.last-consolidated'));
  });

  it('returns checkpointFiles in chronological (oldest-first) order', async () => {
    await saveCheckpoint({ description: 'first', workspace: TEST_DIR });
    // Sleep past second boundary so filenames differ in HHMMSS portion
    await new Promise(resolve => setTimeout(resolve, 1100));
    await saveCheckpoint({ description: 'second', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.checkpointFiles.length).toBe(2);
    // Read both files and verify timestamps are in order
    const { readFile } = await import('fs/promises');
    const content1 = await readFile(parsed.checkpointFiles[0], 'utf-8');
    const content2 = await readFile(parsed.checkpointFiles[1], 'utf-8');
    const ts1 = content1.match(/timestamp: (.+)/)?.[1] ?? '';
    const ts2 = content2.match(/timestamp: (.+)/)?.[1] ?? '';
    expect(new Date(ts1).getTime()).toBeLessThan(new Date(ts2).getTime());
  });

  it('only includes checkpoints after last consolidation timestamp', async () => {
    await saveCheckpoint({ description: 'old checkpoint', workspace: TEST_DIR });

    await new Promise(resolve => setTimeout(resolve, 5));
    const consolidationTimestamp = new Date().toISOString();

    await new Promise(resolve => setTimeout(resolve, 5));
    await saveCheckpoint({ description: 'new checkpoint', workspace: TEST_DIR });

    await writeConsolidationState(TEST_DIR, {
      timestamp: consolidationTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointFiles.length).toBe(1);
    expect(parsed.previousTotal).toBe(1);
  });

  it('returns remainingCount of 0 when all fit in batch', async () => {
    await saveCheckpoint({ description: 'only one', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.remainingCount).toBe(0);
  });

  it('includes prompt with file paths embedded', async () => {
    await saveCheckpoint({ description: 'test', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.prompt).toContain('Read the following files');
    expect(parsed.prompt).toContain('.memories/');
    expect(parsed.prompt).toContain('MEMORY.md');
  });

  it('excludes legacy .json checkpoint files from checkpointFiles', async () => {
    // Save a normal .md checkpoint
    await saveCheckpoint({ description: 'md checkpoint', workspace: TEST_DIR });

    // Manually create a legacy .json file in the same date directory
    const today = new Date().toISOString().split('T')[0];
    const dateDir = join(TEST_DIR, '.memories', today);
    const { writeFile } = await import('fs/promises');
    await writeFile(
      join(dateDir, '120000_legacy.json'),
      JSON.stringify({ id: 'legacy_001', timestamp: new Date().toISOString(), description: 'legacy' })
    );

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    // Should only have the .md file
    for (const f of parsed.checkpointFiles) {
      expect(f).toEndWith('.md');
    }
  });

  it('returns activePlanPath when an active plan exists', async () => {
    await saveCheckpoint({ description: 'work done', workspace: TEST_DIR });
    await savePlan({
      title: 'Test Plan',
      content: '# Plan\n\nDo things.',
      workspace: TEST_DIR,
      activate: true
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.activePlanPath).toBeDefined();
    expect(parsed.activePlanPath).toContain('.memories/plans/');
    expect(parsed.activePlanPath).toEndWith('.md');
  });

  it('omits activePlanPath when plan is completed', async () => {
    await saveCheckpoint({ description: 'work done', workspace: TEST_DIR });
    const plan = await savePlan({
      title: 'Done Plan',
      content: '# Plan\n\nAll done.',
      workspace: TEST_DIR,
      activate: true
    });
    await updatePlan(TEST_DIR, plan.id, { status: 'completed' });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.activePlanPath).toBeUndefined();
  });
});
