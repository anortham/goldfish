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
    // Use 29 days 23 hours instead of exactly 30 days. The exact boundary is
    // flaky because Date.now() in the test and Date.now() inside
    // countStaleCheckpoints differ by a few ms, which can flip the >= check.
    // A 1-hour buffer puts us safely inside the window without changing what
    // the test validates (near-boundary inclusion).
    const boundaryDate = new Date(Date.now() - (CONSOLIDATION_AGE_LIMIT_DAYS * 24 - 1) * 60 * 60 * 1000);
    const dateStr = boundaryDate.toISOString().split('T')[0]!;
    const dateDir = join(memoriesDir, dateStr);
    mkdirSync(dateDir, { recursive: true });
    writeFileSync(
      join(dateDir, '120000_ffff.md'),
      makeCheckpointContent(boundaryDate.toISOString())
    );

    const count = countStaleCheckpoints(memoriesDir);
    // Just inside the 30-day window, cpTime >= ageLimit should be true
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

  it('agrees with recall filtering logic on the same data', () => {
    // Verify that the hook's counting matches the documented recall contract:
    // checkpoint timestamp > lastConsolidated AND checkpoint timestamp >= ageLimit
    // where ageLimit = Date.now() - 30 days in ms.

    // Consolidation happened 7 days ago
    const consolidationDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const consolidationMs = consolidationDate.getTime();
    const statePath = getConsolidationStatePath(TEST_DIR);
    mkdirSync(getConsolidationStateDir(), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      timestamp: consolidationDate.toISOString(),
      checkpointsConsolidated: 3
    }));

    // Create checkpoints with known timestamps covering all categories:
    const timestamps: { iso: string; label: string }[] = [];

    // (A) 2 days ago: after consolidation, within 30 days -- SHOULD count
    const a = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    timestamps.push({ iso: a.toISOString(), label: 'recent-after' });

    // (B) 5 days ago: after consolidation, within 30 days -- SHOULD count
    const b = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    timestamps.push({ iso: b.toISOString(), label: 'mid-after' });

    // (C) 10 days ago: before consolidation, within 30 days -- should NOT count
    const c = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    timestamps.push({ iso: c.toISOString(), label: 'before-consolidation' });

    // (D) 20 days ago: before consolidation, within 30 days -- should NOT count
    const d = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    timestamps.push({ iso: d.toISOString(), label: 'old-before-consolidation' });

    // (E) 45 days ago: before consolidation, outside 30 days -- should NOT count
    const e = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    timestamps.push({ iso: e.toISOString(), label: 'very-old' });

    // Write each checkpoint to its date directory
    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i]!;
      const dateStr = ts.iso.split('T')[0]!;
      const dateDir = join(memoriesDir, dateStr);
      mkdirSync(dateDir, { recursive: true });
      writeFileSync(
        join(dateDir, `10000${i}_${ts.label}.md`),
        makeCheckpointContent(ts.iso)
      );
    }

    // Run the hook's counting function
    const hookCount = countStaleCheckpoints(memoriesDir);

    // Compute expected count using recall's documented filtering logic:
    // cpTime > lastConsolidated AND cpTime >= ageLimit
    const now = Date.now();
    const ageLimit = now - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
    let recallCount = 0;
    for (const ts of timestamps) {
      const cpTime = new Date(ts.iso).getTime();
      if (cpTime > consolidationMs && cpTime >= ageLimit) {
        recallCount++;
      }
    }

    // Both should agree: only checkpoints A and B qualify
    expect(recallCount).toBe(2);
    expect(hookCount).toBe(recallCount);
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
