import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { ensureMemoriesDir, getPlansDir } from '../src/workspace';
import { savePlan, setActivePlan, updatePlan } from '../src/plans';
import { handleConsolidate } from '../src/handlers/consolidate';

let TEST_DIR: string;
let restoreDeps: (() => void) | undefined;

/** Extract checkpoint file paths from the consolidation prompt text */
function extractFilesFromPrompt(prompt: string): string[] {
  const matches = prompt.matchAll(/\d+\.\s+`([^`]+\.md)`/g);
  return [...matches].map(m => m[1]);
}

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'goldfish-consolidate-'));
  await ensureMemoriesDir(TEST_DIR);
  restoreDeps = __setCheckpointDependenciesForTests({
    queueSemanticRecord: async () => {},
    getGitContext: () => ({ branch: 'main', commit: 'abc1234' })
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

  it('does not include checkpointFiles in payload (paths are in prompt only)', async () => {
    await saveCheckpoint({ description: 'first checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointCount).toBe(1);
    // checkpointFiles must NOT be in the payload (they live in the prompt)
    expect(parsed.checkpointFiles).toBeUndefined();

    // But the prompt should contain the file path
    const files = extractFilesFromPrompt(parsed.prompt);
    expect(files.length).toBe(1);
    expect(files[0]).toContain(`${sep}.memories${sep}`);
    expect(files[0]).toEndWith('.md');

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

  it('lists checkpoint files in chronological (oldest-first) order in prompt', async () => {
    await saveCheckpoint({ description: 'first', workspace: TEST_DIR });
    // Sleep past second boundary so filenames differ in HHMMSS portion
    await new Promise(resolve => setTimeout(resolve, 1100));
    await saveCheckpoint({ description: 'second', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.checkpointCount).toBe(2);
    const files = extractFilesFromPrompt(parsed.prompt);
    expect(files.length).toBe(2);
    // Read both files and verify timestamps are in order
    const { readFile } = await import('fs/promises');
    const content1 = await readFile(files[0], 'utf-8');
    const content2 = await readFile(files[1], 'utf-8');
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
    expect(parsed.checkpointCount).toBe(1);
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
    expect(parsed.prompt).toContain(`${sep}.memories${sep}`);
    expect(parsed.prompt).toContain('MEMORY.md');
  });

  it('prompt uses last batch checkpoint timestamp, not current time', async () => {
    // Create two checkpoints with known timestamps spread apart
    await saveCheckpoint({ description: 'first', workspace: TEST_DIR });
    await new Promise(resolve => setTimeout(resolve, 50));
    await saveCheckpoint({ description: 'second', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    // The prompt should NOT tell the subagent to use "now" or "current time"
    expect(parsed.prompt).not.toContain('UTC ISO timestamp of now');
    expect(parsed.prompt).not.toContain('current UTC time');

    // The prompt should contain a concrete ISO timestamp from the last checkpoint
    // Read the last checkpoint file to get its actual timestamp
    const { readFile } = await import('fs/promises');
    const files = extractFilesFromPrompt(parsed.prompt);
    const lastFile = files[files.length - 1];
    const content = await readFile(lastFile, 'utf-8');
    const match = content.match(/timestamp: (.+)/);
    expect(match).toBeTruthy();
    const lastCheckpointTs = match![1].trim();

    // The prompt's JSON block should contain this exact timestamp
    expect(parsed.prompt).toContain(lastCheckpointTs);
  });

  it('caps all: true at 100 checkpoints per batch', async () => {
    // Create 110 checkpoints to prove the cap
    const promises = [];
    for (let i = 0; i < 110; i++) {
      promises.push(saveCheckpoint({ description: `checkpoint ${i}`, workspace: TEST_DIR }));
    }
    await Promise.all(promises);

    const result = await handleConsolidate({ workspace: TEST_DIR, all: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointCount).toBe(100);
    expect(parsed.remainingCount).toBe(10);
  });

  it('returns all checkpoints in one batch when all: true and under cap', async () => {
    const promises = [];
    for (let i = 0; i < 55; i++) {
      promises.push(saveCheckpoint({ description: `checkpoint ${i}`, workspace: TEST_DIR }));
    }
    await Promise.all(promises);

    const result = await handleConsolidate({ workspace: TEST_DIR, all: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointCount).toBe(55);
    expect(parsed.remainingCount).toBe(0);
  });

  it('still batches at default cap without all: true', async () => {
    const promises = [];
    for (let i = 0; i < 55; i++) {
      promises.push(saveCheckpoint({ description: `checkpoint ${i}`, workspace: TEST_DIR }));
    }
    await Promise.all(promises);

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointCount).toBe(50);
    expect(parsed.remainingCount).toBe(5);
  });

  it('excludes legacy .json checkpoint files', async () => {
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

    // Prompt should only reference .md files
    const files = extractFilesFromPrompt(parsed.prompt);
    for (const f of files) {
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
    expect(parsed.activePlanPath).toContain(`${sep}.memories${sep}plans${sep}`);
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

  it('excludes checkpoints older than 30 days', async () => {
    // Create a checkpoint with a timestamp 45 days ago by writing the file directly
    const { writeFile, mkdir } = await import('fs/promises');
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const dateStr = oldDate.toISOString().split('T')[0];
    const dateDir = join(TEST_DIR, '.memories', dateStr);
    await mkdir(dateDir, { recursive: true });
    const oldCheckpointContent = [
      '---',
      `id: checkpoint_old001`,
      `timestamp: ${oldDate.toISOString()}`,
      'tags: [old]',
      '---',
      '## Old checkpoint',
      'This is from 45 days ago.'
    ].join('\n');
    await writeFile(join(dateDir, '120000_old1.md'), oldCheckpointContent);

    // Create a recent checkpoint normally
    await saveCheckpoint({ description: 'recent work', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointCount).toBe(1);
    // The old checkpoint should not appear in the prompt
    const files = extractFilesFromPrompt(parsed.prompt);
    for (const f of files) {
      expect(f).not.toContain(dateStr);
    }
  });

  it('prompt contains litmus test and traffic light budget', async () => {
    await saveCheckpoint({ description: 'test checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    // Litmus test present
    expect(parsed.prompt).toContain('derive it from the codebase');

    // Traffic light budget present
    expect(parsed.prompt).toContain('25');
    expect(parsed.prompt).toContain('40');

    // Old bloat-inducing patterns gone
    expect(parsed.prompt).not.toContain('500 lines');
    expect(parsed.prompt).not.toContain('## Project Overview');
    expect(parsed.prompt).not.toContain('## Architecture');
    expect(parsed.prompt).not.toContain('## Current State');
  });

  it('returns current when all unconsolidated checkpoints are older than 30 days', async () => {
    const { writeFile, mkdir } = await import('fs/promises');
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const dateStr = oldDate.toISOString().split('T')[0];
    const dateDir = join(TEST_DIR, '.memories', dateStr);
    await mkdir(dateDir, { recursive: true });
    const oldCheckpointContent = [
      '---',
      `id: checkpoint_old002`,
      `timestamp: ${oldDate.toISOString()}`,
      'tags: [old]',
      '---',
      '## Ancient checkpoint',
      'Way too old to consolidate.'
    ].join('\n');
    await writeFile(join(dateDir, '120000_old2.md'), oldCheckpointContent);

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('current');
  });
});
