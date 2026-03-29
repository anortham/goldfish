import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { writeFileSync, mkdirSync } from 'fs';
import { countStaleCheckpoints } from '../hooks/count-stale';
import { getConsolidationStatePath, getConsolidationStateDir } from '../src/workspace';
import { CONSOLIDATION_AGE_LIMIT_DAYS } from '../src/checkpoints';

let TEST_DIR: string;
let memoriesDir: string;
let tempGoldfishHome: string;
const originalGoldfishHome = process.env.GOLDFISH_HOME;

function makeCheckpointContent(timestamp: string): string {
  return `---\nid: checkpoint_test\ntimestamp: "${timestamp}"\n---\n\nTest checkpoint\n`;
}

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'goldfish-count-stale-'));
  memoriesDir = join(TEST_DIR, '.memories');
  tempGoldfishHome = await mkdtemp(join(tmpdir(), 'goldfish-home-'));
  process.env.GOLDFISH_HOME = tempGoldfishHome;
  await mkdir(memoriesDir, { recursive: true });
});

afterEach(async () => {
  process.env.GOLDFISH_HOME = originalGoldfishHome;
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(tempGoldfishHome, { recursive: true, force: true });
});

describe('countStaleCheckpoints', () => {
  it('uses frontmatter timestamp, not file mtime', () => {
    // Write a checkpoint with OLD frontmatter (45 days ago) but the file itself
    // has a fresh mtime (just created). The old implementation using mtimeMs
    // would count this as stale; the correct implementation should count 0
    // because the frontmatter timestamp is older than 30 days.
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const dateStr = oldDate.toISOString().split('T')[0]!;
    const dateDir = join(memoriesDir, dateStr);
    mkdirSync(dateDir, { recursive: true });

    const oldTimestamp = oldDate.toISOString();
    writeFileSync(
      join(dateDir, '120000_abcd.md'),
      makeCheckpointContent(oldTimestamp)
    );

    // No consolidation state, so all checkpoints within 30 days are stale.
    // This old one should NOT be counted.
    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(0);
  });

  it('ignores checkpoints older than 30 days', () => {
    // One recent checkpoint (5 days ago)
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const recentDateStr = recentDate.toISOString().split('T')[0]!;
    const recentDir = join(memoriesDir, recentDateStr);
    mkdirSync(recentDir, { recursive: true });
    writeFileSync(
      join(recentDir, '100000_aaaa.md'),
      makeCheckpointContent(recentDate.toISOString())
    );

    // One old checkpoint (45 days ago)
    const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const oldDateStr = oldDate.toISOString().split('T')[0]!;
    const oldDir = join(memoriesDir, oldDateStr);
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(
      join(oldDir, '120000_bbbb.md'),
      makeCheckpointContent(oldDate.toISOString())
    );

    // No consolidation state: count should be 1 (only the recent one)
    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(1);
  });

  it('counts only checkpoints newer than last consolidation AND within 30 days', () => {
    // Consolidation happened 10 days ago
    const consolidationDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const statePath = getConsolidationStatePath(TEST_DIR);
    mkdirSync(getConsolidationStateDir(), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      timestamp: consolidationDate.toISOString(),
      checkpointsConsolidated: 5
    }));

    // Checkpoint from 15 days ago (before consolidation, within 30 days) -- should NOT count
    const beforeConsolidation = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const beforeDateStr = beforeConsolidation.toISOString().split('T')[0]!;
    const beforeDir = join(memoriesDir, beforeDateStr);
    mkdirSync(beforeDir, { recursive: true });
    writeFileSync(
      join(beforeDir, '100000_cccc.md'),
      makeCheckpointContent(beforeConsolidation.toISOString())
    );

    // Checkpoint from 5 days ago (after consolidation, within 30 days) -- SHOULD count
    const afterConsolidation = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const afterDateStr = afterConsolidation.toISOString().split('T')[0]!;
    const afterDir = join(memoriesDir, afterDateStr);
    mkdirSync(afterDir, { recursive: true });
    writeFileSync(
      join(afterDir, '110000_dddd.md'),
      makeCheckpointContent(afterConsolidation.toISOString())
    );

    // Checkpoint from 45 days ago (before consolidation, outside 30 days) -- should NOT count
    const veryOld = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const veryOldDateStr = veryOld.toISOString().split('T')[0]!;
    const veryOldDir = join(memoriesDir, veryOldDateStr);
    mkdirSync(veryOldDir, { recursive: true });
    writeFileSync(
      join(veryOldDir, '090000_eeee.md'),
      makeCheckpointContent(veryOld.toISOString())
    );

    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(1);
  });

  it('returns 0 when no checkpoints exist', () => {
    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(0);
  });

  it('uses the shared CONSOLIDATION_AGE_LIMIT_DAYS constant (30)', () => {
    // Verify the constant value matches expectations
    expect(CONSOLIDATION_AGE_LIMIT_DAYS).toBe(30);
  });

  it('handles checkpoint at exactly the age boundary', () => {
    // Checkpoint at exactly 30 days ago (should be included -- the filter is >=)
    const boundaryDate = new Date(Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000);
    const dateStr = boundaryDate.toISOString().split('T')[0]!;
    const dateDir = join(memoriesDir, dateStr);
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(
      join(dateDir, '120000_ffff.md'),
      makeCheckpointContent(boundaryDate.toISOString())
    );

    const count = countStaleCheckpoints(memoriesDir);
    // At exactly the boundary, cpTime >= ageLimit should be true
    expect(count).toBe(1);
  });

  it('skips non-markdown files', () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const dateStr = recentDate.toISOString().split('T')[0]!;
    const dateDir = join(memoriesDir, dateStr);
    mkdirSync(dateDir, { recursive: true });

    // Write a .json file (legacy format) -- should be skipped
    writeFileSync(
      join(dateDir, 'legacy.json'),
      JSON.stringify({ id: 'test', timestamp: recentDate.toISOString() })
    );

    // Write a .md file -- should be counted
    writeFileSync(
      join(dateDir, '100000_gggg.md'),
      makeCheckpointContent(recentDate.toISOString())
    );

    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(1);
  });

  it('handles malformed frontmatter gracefully', () => {
    const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const dateStr = recentDate.toISOString().split('T')[0]!;
    const dateDir = join(memoriesDir, dateStr);
    mkdirSync(dateDir, { recursive: true });

    // Write a file with no frontmatter at all
    writeFileSync(
      join(dateDir, '100000_hhhh.md'),
      '# Just a markdown file\nNo frontmatter here.'
    );

    // Write a valid checkpoint too
    writeFileSync(
      join(dateDir, '110000_iiii.md'),
      makeCheckpointContent(recentDate.toISOString())
    );

    // Should count only the valid one, skip the malformed one
    const count = countStaleCheckpoints(memoriesDir);
    expect(count).toBe(1);
  });
});
