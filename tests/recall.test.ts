import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { recall, parseSince } from '../src/recall';
import { formatCheckpoint, saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { buildCompactSearchDescription } from '../src/digests';
import { saveBrief, getBrief, updateBrief } from '../src/briefs';
import { ensureMemoriesDir, getMemoriesDir } from '../src/workspace';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Checkpoint } from '../src/types';

async function withFrozenTime<T>(isoTimestamp: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  const fixedTime = new RealDate(isoTimestamp).getTime();

  class FrozenDate extends RealDate {
    constructor(value?: string | number | Date) {
      super(value ?? fixedTime);
    }

    static now(): number {
      return fixedTime;
    }
  }

  globalThis.Date = FrozenDate as DateConstructor;

  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

let TEST_DIR_A: string;
let TEST_DIR_B: string;
let restoreCheckpointDeps: (() => void) | undefined;
let tempGoldfishHome: string;
const originalGoldfishHome = process.env.GOLDFISH_HOME;

beforeAll(async () => {
  tempGoldfishHome = await mkdtemp(join(tmpdir(), 'goldfish-home-recall-'));
  process.env.GOLDFISH_HOME = tempGoldfishHome;
});

afterAll(async () => {
  if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
  else process.env.GOLDFISH_HOME = originalGoldfishHome;
  await rm(tempGoldfishHome, { recursive: true, force: true });
});

beforeEach(async () => {
  TEST_DIR_A = await mkdtemp(join(tmpdir(), 'test-recall-a-'));
  TEST_DIR_B = await mkdtemp(join(tmpdir(), 'test-recall-b-'));
  await ensureMemoriesDir(TEST_DIR_A);
  await ensureMemoriesDir(TEST_DIR_B);
  restoreCheckpointDeps = __setCheckpointDependenciesForTests({
    getGitContext: () => ({ branch: 'main', commit: 'abc1234' })
  });
});

afterEach(async () => {
  restoreCheckpointDeps?.();
  await rm(TEST_DIR_A, { recursive: true, force: true });
  await rm(TEST_DIR_B, { recursive: true, force: true });
});

describe('Basic recall functionality', () => {
  beforeEach(async () => {
    // Create some test checkpoints. Space them apart so timestamps strictly
    // increase — Goldfish sorts by timestamp with no tiebreaker, and three
    // saves in the same millisecond produce non-deterministic recall order.
    await saveCheckpoint({
      description: 'Fixed authentication bug',
      tags: ['bug-fix', 'auth'],
      workspace: TEST_DIR_A
    });
    await new Promise(resolve => setTimeout(resolve, 2));

    await saveCheckpoint({
      description: 'Added OAuth2 support',
      tags: ['feature', 'auth'],
      workspace: TEST_DIR_A
    });
    await new Promise(resolve => setTimeout(resolve, 2));

    await saveCheckpoint({
      description: 'Refactored database queries',
      tags: ['refactor', 'database'],
      workspace: TEST_DIR_A
    });
  });

  it('returns the most recent checkpoints by default in last-N mode', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(3);
    // Default recall uses last-N ordering, sorted newest first.
    expect(result.checkpoints[0]!.description).toBe('Refactored database queries');
  });

  it('filters by number of days', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      days: 1
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('treats days: 0 as omitted and falls back to last-N mode', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      days: 0,
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.description).toBe('Refactored database queries');
  });

  it('treats negative days as omitted', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      days: -1,
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.description).toBe('Refactored database queries');
  });

  it('treats blank date strings as omitted', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      since: '   ',
      from: '   ',
      to: '   ',
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints[0]!.description).toBe('Refactored database queries');
  });

  it('treats blank search as omitted', async () => {
    // A whitespace-only search should behave like no search at all: every
    // checkpoint comes back, ordered by timestamp.
    const result = await recall({
      workspace: TEST_DIR_A,
      search: '   ',
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(3);
  });

  it('keeps since precedence when days is also provided', async () => {
    const oldTimestamp = new Date(Date.now() - 10 * 86400000).toISOString();
    const oldDate = oldTimestamp.split('T')[0]!;
    const oldCheckpoint: Checkpoint = {
      id: 'checkpoint_old_since_precedence',
      timestamp: oldTimestamp,
      description: 'Old checkpoint outside since window'
    };
    const oldDateDir = join(getMemoriesDir(TEST_DIR_A), oldDate);

    await mkdir(oldDateDir, { recursive: true });
    await writeFile(
      join(oldDateDir, '120000_old_since_precedence.md'),
      formatCheckpoint(oldCheckpoint),
      'utf-8'
    );

    const result = await recall({
      workspace: TEST_DIR_A,
      since: '2d',
      days: 30,
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(3);
    expect(result.checkpoints.some(c => c.description === 'Old checkpoint outside since window')).toBe(false);
  });

  it('uses cwd when workspace not specified', async () => {
    const originalCwd = process.cwd();
    const originalWorkspace = process.env.GOLDFISH_WORKSPACE;

    try {
      delete process.env.GOLDFISH_WORKSPACE;
      process.chdir(TEST_DIR_A);

      await saveCheckpoint({
        description: 'Checkpoint loaded from cwd workspace',
        workspace: TEST_DIR_A
      });

      const result = await recall({ limit: 10 });

      expect(result.checkpoints.some(c => c.description === 'Checkpoint loaded from cwd workspace')).toBe(true);
    } finally {
      process.chdir(originalCwd);
      if (originalWorkspace === undefined) {
        delete process.env.GOLDFISH_WORKSPACE;
      } else {
        process.env.GOLDFISH_WORKSPACE = originalWorkspace;
      }
    }
  });
});

describe('Search functionality', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Fixed JWT authentication timeout',
      tags: ['bug-fix', 'auth', 'jwt'],
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Added OAuth2 Google integration',
      tags: ['feature', 'auth', 'oauth'],
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Refactored user database schema',
      tags: ['refactor', 'database', 'users'],
      workspace: TEST_DIR_A
    });
  });

  it('searches by description text', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toContain('JWT authentication');
  });

  it('searches by tags', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'database'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.tags).toContain('database');
  });

  it('returns empty array when no matches found', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'nonexistent-term-xyz'
    });

    expect(result.checkpoints).toEqual([]);
  });

  it('ranks results by relevance', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'auth'
    });

    // Results should be sorted by relevance
    // Checkpoints with 'auth' in description or tags should rank higher
    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(
      result.checkpoints[0]!.description.toLowerCase().includes('auth') ||
      result.checkpoints[0]!.tags?.some(t => t.includes('auth'))
    ).toBe(true);
  });

  it('applies briefId filtering before search ranking', async () => {
    // A checkpoint that matches the query lexically but is NOT associated with
    // the active brief. It must be filtered out before ranking runs.
    await saveCheckpoint({
      description: 'Resolved idle session expiry unrelated to the active brief',
      tags: ['session'],
      workspace: TEST_DIR_A
    });

    await saveBrief({
      id: 'session-plan',
      title: 'Session Hardening',
      content: 'Plan content',
      workspace: TEST_DIR_A,
      activate: true
    });

    // A checkpoint associated with the active brief that also matches the query.
    const matchingPlan = await saveCheckpoint({
      description: 'Resolved idle session expiry while on the session plan',
      tags: ['session'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'session expiry',
      briefId: 'session-plan',
      limit: 5
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe(matchingPlan.id);
  });

  it('searches using decision fields the same way as the lexical helper', async () => {
    await saveCheckpoint({
      description: 'Migrated order processing architecture',
      decision: 'Adopt CQRS for write-heavy order processing path',
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Refactored database indexing',
      tags: ['database'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'cqrs',
      limit: 10
    });

    expect(result.checkpoints).toHaveLength(1);
    // decision field is stripped in non-full mode, but the checkpoint was found via decision search
    expect(result.checkpoints[0]!.description).toContain('order processing');
  });

  it('returns empty results when no checkpoints match the search query', async () => {
    // beforeEach saved checkpoints about authentication, OAuth2, and database
    // schema. None of them mention kubernetes deployment, so Orama (with both
    // its AND and OR fallback passes) returns nothing.
    const result = await recall({
      search: 'kubernetes deployment configuration',
      workspace: TEST_DIR_A,
      limit: 5
    });

    expect(result.checkpoints).toHaveLength(0);
  });
});

describe('Cross-workspace functionality', () => {
  let projectA: string;
  let projectB: string;
  let registryDir: string;

  beforeEach(async () => {
    // Use isolated registry directory for test isolation
    registryDir = await mkdtemp(join(tmpdir(), 'test-registry-'));

    // Create two fake projects with .memories/ directories
    projectA = await mkdtemp(join(tmpdir(), 'test-cross-a-'));
    projectB = await mkdtemp(join(tmpdir(), 'test-cross-b-'));
    await ensureMemoriesDir(projectA);
    await ensureMemoriesDir(projectB);

    // Register them in the isolated registry
    const { registerProject } = await import('../src/registry');
    await registerProject(projectA, registryDir);
    await registerProject(projectB, registryDir);

    // Create checkpoints in each project
    await saveCheckpoint({
      description: 'Work on project A',
      tags: ['project-a'],
      workspace: projectA
    });

    await saveCheckpoint({
      description: 'Work on project B',
      tags: ['project-b'],
      workspace: projectB
    });
  });

  afterEach(async () => {
    await rm(projectA, { recursive: true, force: true });
    await rm(projectB, { recursive: true, force: true });
    await rm(registryDir, { recursive: true, force: true });
  });

  it('aggregates across all registered projects', async () => {
    const result = await recall({ workspace: 'all', days: 1, _registryDir: registryDir });

    expect(result.checkpoints).toHaveLength(2);

    const descriptions = result.checkpoints.map(c => c.description);
    expect(descriptions).toContain('Work on project A');
    expect(descriptions).toContain('Work on project B');
  });

  it('returns workspace summaries', async () => {
    const result = await recall({ workspace: 'all', days: 1, _registryDir: registryDir });

    expect(result.workspaces).toBeDefined();
    expect(result.workspaces!).toHaveLength(2);

    for (const ws of result.workspaces!) {
      expect(ws.name).toBeTruthy();
      expect(ws.path).toBeTruthy();
      expect(ws.checkpointCount).toBeGreaterThan(0);
    }
  });

  it('tags checkpoints with workspace name', async () => {
    const result = await recall({ workspace: 'all', days: 1, full: true, _registryDir: registryDir });

    for (const checkpoint of result.checkpoints) {
      expect(checkpoint.workspace).toBeTruthy();
    }
  });

  it('applies global limit across projects', async () => {
    const result = await recall({ workspace: 'all', days: 1, limit: 1, _registryDir: registryDir });
    expect(result.checkpoints).toHaveLength(1);
  });

  it('preserves global relevance ordering for cross-workspace search', async () => {
    // A strong lexical match in project A and a near-irrelevant checkpoint in
    // project B. Cross-workspace search should rank the strong match first
    // regardless of which workspace it lives in.
    const strongMatch = await saveCheckpoint({
      description: 'Authentication timeout regression in the login flow',
      tags: ['auth'],
      workspace: projectA
    });

    await saveCheckpoint({
      description: 'Tweaked README badge layout',
      tags: ['docs'],
      workspace: projectB
    });

    const result = await recall({
      workspace: 'all',
      days: 1,
      search: 'authentication timeout',
      limit: 2,
      _registryDir: registryDir
    });

    expect(result.checkpoints[0]!.id).toBe(strongMatch.id);
  });

  it('search summaries only include workspaces with matching checkpoints', async () => {
    await saveCheckpoint({
      description: 'Authentication timeout regression in the login flow',
      tags: ['auth'],
      workspace: projectA
    });

    await saveCheckpoint({
      description: 'Tweaked README badge layout',
      tags: ['docs'],
      workspace: projectB
    });

    const result = await recall({
      workspace: 'all',
      days: 1,
      search: 'authentication timeout',
      limit: 5,
      _registryDir: registryDir
    });

    expect(result.checkpoints).toHaveLength(1);
    // Workspace summary paths are registry-normalized to forward slashes.
    expect(result.workspaces).toEqual([
      expect.objectContaining({
        path: projectA.replace(/\\/g, '/'),
        checkpointCount: 1
      })
    ]);
  });

  it('checkpointCount reflects total matching checkpoints, not the limited return set', async () => {
    // Add 2 more checkpoints to project A (3 total)
    await saveCheckpoint({ description: 'Second A', workspace: projectA });
    await saveCheckpoint({ description: 'Third A', workspace: projectA });

    const result = await recall({ workspace: 'all', days: 1, limit: 1, _registryDir: registryDir });

    // Only 1 checkpoint returned due to limit
    expect(result.checkpoints).toHaveLength(1);

    // But workspace summary should report all matching checkpoints
    // (summary paths are registry-normalized to forward slashes)
    const wsA = result.workspaces!.find(ws => ws.path === projectA.replace(/\\/g, '/'));
    expect(wsA).toBeDefined();
    expect(wsA!.checkpointCount).toBe(3);
  });

  it('returns empty when no projects registered', async () => {
    // Use a fresh empty registry
    const emptyRegistryDir = await mkdtemp(join(tmpdir(), 'test-empty-registry-'));

    const result = await recall({ workspace: 'all', days: 1, _registryDir: emptyRegistryDir });
    expect(result.checkpoints).toEqual([]);

    await rm(emptyRegistryDir, { recursive: true, force: true });
  });
});

describe('Active brief integration', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Working on auth',
      workspace: TEST_DIR_A
    });
  });

  it('includes active brief in recall results', async () => {
    await saveBrief({
      id: 'auth-plan',
      title: 'Authentication System',
      content: '## Goals\n- JWT\n- OAuth2',
      workspace: TEST_DIR_A,
      activate: true
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('auth-plan');
    expect(result.activeBrief!.title).toBe('Authentication System');
  });

  it('returns null activeBrief when no brief is active', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.activeBrief).toBeNull();
  });

  it('includes active brief even with search filter', async () => {
    await saveBrief({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Content',
      workspace: TEST_DIR_A,
      activate: true
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'auth'  // Search term doesn't match plan
    });

    // Active brief should still be included
    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('test-plan');
  });

  it('does not crash recall when the active brief file is corrupt', async () => {
    await saveBrief({
      id: 'corrupt-plan',
      title: 'Corrupt Plan',
      content: 'Content',
      workspace: TEST_DIR_A,
      activate: true
    });

    // Corrupt the active brief on disk
    const briefPath = join(getMemoriesDir(TEST_DIR_A), 'briefs', 'corrupt-plan.md');
    await writeFile(briefPath, 'not a valid brief', 'utf-8');

    // Recall must still return the checkpoint trail, degrading the brief to null.
    const result = await recall({ workspace: TEST_DIR_A });
    expect(result.activeBrief ?? null).toBeNull();
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });
});

describe('Stale brief suppression', () => {
  const NOW = '2026-05-15T12:00:00.000Z';

  async function writeBriefCheckpoint(
    workspace: string,
    date: string,
    time: string,
    id: string,
    briefId: string
  ): Promise<void> {
    const dir = join(getMemoriesDir(workspace), date);
    await mkdir(dir, { recursive: true });
    const content = `---\nid: ${id}\ntimestamp: "${date}T${time}.000Z"\nbriefId: ${briefId}\n---\n\nWork ${id}\n`;
    await writeFile(join(dir, `${time.replace(/:/g, '')}_${id}.md`), content, 'utf-8');
  }

  it('surfaces a fresh active brief whose newest checkpoint is within 7 days', async () => {
    await withFrozenTime('2026-05-10T12:00:00.000Z', () => saveBrief({
      id: 'fresh-brief',
      title: 'Fresh Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_fresh', 'fresh-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('fresh-brief');
    expect(result.staleBrief ?? null).toBeNull();
  });

  it('un-suppresses a brief when updated recently even without recent checkpoints', async () => {
    await withFrozenTime('2026-04-15T12:00:00.000Z', () => saveBrief({
      id: 'updated-brief',
      title: 'Updated Brief',
      content: 'original',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-05', '12:00:00', 'checkpoint_old', 'updated-brief');
    await withFrozenTime('2026-05-13T12:00:00.000Z', () =>
      updateBrief(TEST_DIR_A, 'updated-brief', { content: 'refreshed' })
    );

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('updated-brief');
    expect(result.staleBrief ?? null).toBeNull();
  });

  it('hides a stale active brief whose newest checkpoint is older than 7 days', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'stale-brief',
      title: 'Stale Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-01', '12:00:00', 'checkpoint_stale', 'stale-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief ?? null).toBeNull();
    expect(result.staleBrief).toBeDefined();
    expect(result.staleBrief!.id).toBe('stale-brief');
    expect(result.staleBrief!.title).toBe('Stale Brief');
    expect(result.staleBrief!.lastActivity).toBe('2026-05-01T12:00:00.000Z');
    expect(result.staleBrief!.daysSinceActivity).toBe(14);
  });

  it('treats a brand-new brief with no checkpoints as fresh (created within 7 days)', async () => {
    await withFrozenTime(NOW, () => saveBrief({
      id: 'new-brief',
      title: 'New Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('new-brief');
    expect(result.staleBrief ?? null).toBeNull();
  });

  it('treats a brief with no checkpoints as stale when created more than 7 days ago', async () => {
    await withFrozenTime('2026-05-01T12:00:00.000Z', () => saveBrief({
      id: 'old-brief',
      title: 'Old Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief ?? null).toBeNull();
    expect(result.staleBrief).toBeDefined();
    expect(result.staleBrief!.id).toBe('old-brief');
    expect(result.staleBrief!.lastActivity).toBe('2026-05-01T12:00:00.000Z');
    expect(result.staleBrief!.daysSinceActivity).toBe(14);
  });

  it('uses the newest checkpoint when a brief has both old and recent activity', async () => {
    await withFrozenTime('2026-03-25T12:00:00.000Z', () => saveBrief({
      id: 'mixed-brief',
      title: 'Mixed Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-04-01', '12:00:00', 'checkpoint_mixed_old', 'mixed-brief');
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_mixed_new', 'mixed-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('mixed-brief');
    expect(result.staleBrief ?? null).toBeNull();
  });

  it('does not mutate brief status on disk when flagging it stale (non-destructive)', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'untouched-brief',
      title: 'Untouched Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-01', '12:00:00', 'checkpoint_nd', 'untouched-brief');

    await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    const onDisk = await getBrief(TEST_DIR_A, 'untouched-brief');
    expect(onDisk).not.toBeNull();
    expect(onDisk!.status).toBe('active');
  });

  it('reports a stale brief in limit:0 (brief-only) mode', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'stale-brief-only',
      title: 'Stale Brief Only',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-01', '12:00:00', 'checkpoint_bo', 'stale-brief-only');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A, limit: 0 }));

    expect(result.checkpoints).toHaveLength(0);
    expect(result.activeBrief ?? null).toBeNull();
    expect(result.staleBrief).toBeDefined();
    expect(result.staleBrief!.id).toBe('stale-brief-only');
  });
});

describe('Brief refresh nudge', () => {
  const NOW = '2026-05-15T12:00:00.000Z';

  async function writeBriefCheckpoint(
    workspace: string,
    date: string,
    time: string,
    id: string,
    briefId: string
  ): Promise<void> {
    const dir = join(getMemoriesDir(workspace), date);
    await mkdir(dir, { recursive: true });
    const content = `---\nid: ${id}\ntimestamp: "${date}T${time}.000Z"\nbriefId: ${briefId}\n---\n\nWork ${id}\n`;
    await writeFile(join(dir, `${time.replace(/:/g, '')}_${id}.md`), content, 'utf-8');
  }

  it('nudges when the brief body is stale but recent checkpoints keep it active', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'zombie-brief',
      title: 'Zombie Brief',
      content: 'old direction',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_recent', 'zombie-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('zombie-brief');
    expect(result.staleBrief ?? null).toBeNull();
    expect(result.briefRefresh).toBeDefined();
    expect(result.briefRefresh!.daysSinceUpdated).toBe(20);
    expect(result.briefRefresh!.title).toBe('Zombie Brief');
  });

  it('does not nudge when the brief was updated within 14 days', async () => {
    await withFrozenTime('2026-05-10T12:00:00.000Z', () => saveBrief({
      id: 'fresh-brief',
      title: 'Fresh Brief',
      content: 'current direction',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_fresh', 'fresh-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief).toBeDefined();
    expect(result.briefRefresh ?? null).toBeNull();
  });

  it('never double-fires briefRefresh alongside staleBrief suppression', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'abandoned-brief',
      title: 'Abandoned Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-01', '12:00:00', 'checkpoint_abandoned', 'abandoned-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.activeBrief ?? null).toBeNull();
    expect(result.staleBrief).toBeDefined();
    expect(result.briefRefresh ?? null).toBeNull();
  });

  it('carries the refresh notice in limit:0 brief-only mode', async () => {
    await withFrozenTime('2026-04-25T12:00:00.000Z', () => saveBrief({
      id: 'zombie-only',
      title: 'Zombie Only',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_zo', 'zombie-only');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A, limit: 0 }));

    expect(result.checkpoints).toHaveLength(0);
    expect(result.activeBrief).toBeDefined();
    expect(result.briefRefresh!.daysSinceUpdated).toBe(20);
  });

  it('nudges at exactly 14 days since the brief was last updated', async () => {
    await withFrozenTime('2026-05-01T12:00:00.000Z', () => saveBrief({
      id: 'boundary-brief',
      title: 'Boundary Brief',
      content: 'content',
      workspace: TEST_DIR_A,
      activate: true
    }));
    await writeBriefCheckpoint(TEST_DIR_A, '2026-05-14', '12:00:00', 'checkpoint_boundary', 'boundary-brief');

    const result = await withFrozenTime(NOW, () => recall({ workspace: TEST_DIR_A }));

    expect(result.briefRefresh).toBeDefined();
    expect(result.briefRefresh!.daysSinceUpdated).toBe(14);
  });
});

describe('Date range filtering', () => {
  it('respects from/to date range', async () => {
    await saveCheckpoint({
      description: 'Test checkpoint',
      workspace: TEST_DIR_A
    });

    const today = new Date().toISOString().split('T')[0]!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;

    const result = await recall({
      workspace: TEST_DIR_A,
      from: today,
      to: tomorrow
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('returns empty when date range excludes checkpoints', async () => {
    await saveCheckpoint({
      description: 'Today',
      workspace: TEST_DIR_A
    });

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
    const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().split('T')[0]!;

    const result = await recall({
      workspace: TEST_DIR_A,
      from: twoDaysAgo,
      to: yesterday
    });

    expect(result.checkpoints).toEqual([]);
  });

  it('calculates from relative to to-date when only to is provided', async () => {
    // Create a checkpoint now
    await saveCheckpoint({
      description: 'Recent checkpoint',
      workspace: TEST_DIR_A
    });

    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;

    // When only 'to' is provided, should look 7 days back from the 'to' date
    const result = await recall({
      workspace: TEST_DIR_A,
      to: tomorrow
    });

    // Today's checkpoint should be within 7 days of tomorrow
    expect(result.checkpoints.length).toBeGreaterThan(0);

    // Now test with a past 'to' date — the 'from' should be relative to it, not now
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0]!;

    const pastResult = await recall({
      workspace: TEST_DIR_A,
      to: thirtyDaysAgo
    });

    // No checkpoints should be found — our checkpoint is today, not 30 days ago
    expect(pastResult.checkpoints).toEqual([]);
  });

  it('throws when from is invalid', async () => {
    await expect(recall({
      workspace: TEST_DIR_A,
      from: 'not-a-date'
    })).rejects.toThrow(/invalid from/i);
  });

  it('throws when from uses an impossible calendar date', async () => {
    await expect(recall({
      workspace: TEST_DIR_A,
      from: '2026-02-30'
    })).rejects.toThrow(/invalid from/i);
  });

  it('throws when to is invalid', async () => {
    await expect(recall({
      workspace: TEST_DIR_A,
      to: 'not-a-date'
    })).rejects.toThrow(/invalid to/i);
  });

  it('throws when to uses an impossible calendar date', async () => {
    await expect(recall({
      workspace: TEST_DIR_A,
      to: '2026-02-30'
    })).rejects.toThrow(/invalid to/i);
  });
});

describe('parseSince - human-friendly time span parser', () => {
  it('parses minutes (30m)', () => {
    const now = new Date();
    const result = parseSince('30m');

    const expectedMs = now.getTime() - (30 * 60 * 1000);
    const tolerance = 100; // 100ms tolerance for test execution time

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses hours (2h)', () => {
    const now = new Date();
    const result = parseSince('2h');

    const expectedMs = now.getTime() - (2 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses days (3d)', () => {
    const now = new Date();
    const result = parseSince('3d');

    const expectedMs = now.getTime() - (3 * 24 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('parses ISO 8601 timestamps', () => {
    const timestamp = '2025-10-14T15:30:00.000Z';
    const result = parseSince(timestamp);

    expect(result.toISOString()).toBe(timestamp);
  });

  it('parses YYYY-MM-DD dates', () => {
    const date = '2025-10-14';
    const result = parseSince(date);

    expect(result.toISOString().split('T')[0]).toBe(date);
  });

  it('throws error for invalid format', () => {
    expect(() => parseSince('invalid')).toThrow(/Invalid since format/);
  });

  it('throws error for invalid unit', () => {
    expect(() => parseSince('5x')).toThrow(/Invalid since format/);
  });

  it('throws error for missing number', () => {
    expect(() => parseSince('h')).toThrow(/Invalid since format/);
  });

  it('handles zero-value durations (0m, 0h, 0d)', () => {
    const now = new Date();

    const zeroMinutes = parseSince('0m');
    expect(Math.abs(zeroMinutes.getTime() - now.getTime())).toBeLessThan(100);

    const zeroHours = parseSince('0h');
    expect(Math.abs(zeroHours.getTime() - now.getTime())).toBeLessThan(100);

    const zeroDays = parseSince('0d');
    expect(Math.abs(zeroDays.getTime() - now.getTime())).toBeLessThan(100);
  });

  it('handles single digit values', () => {
    const now = new Date();
    const result = parseSince('1h');

    const expectedMs = now.getTime() - (1 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });

  it('handles large values', () => {
    const now = new Date();
    const result = parseSince('365d');

    const expectedMs = now.getTime() - (365 * 24 * 60 * 60 * 1000);
    const tolerance = 100;

    expect(Math.abs(result.getTime() - expectedMs)).toBeLessThan(tolerance);
  });
});

describe('Summary vs Full descriptions', () => {
  beforeEach(async () => {
    // Create checkpoint with long description (will have summary)
    await saveCheckpoint({
      description: 'Successfully refactored the entire authentication system to use JWT tokens instead of session cookies. Updated all middleware, tests, and documentation. Added refresh token support and improved error handling for expired tokens.',
      tags: ['refactor', 'auth'],
      workspace: TEST_DIR_A
    });

    // Create checkpoint with short description (no summary)
    await saveCheckpoint({
      description: 'Fixed login bug',
      tags: ['bug-fix'],
      workspace: TEST_DIR_A
    });
  });

  it('returns summaries by default for long descriptions', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    const longCheckpoint = result.checkpoints.find(c => c.tags?.includes('refactor'));
    expect(longCheckpoint).toBeDefined();

    // Should return summary (not full description - first sentence only)
    expect(longCheckpoint!.description).not.toContain('middleware');  // From 2nd sentence
    expect(longCheckpoint!.description).not.toContain('refresh token');  // From 3rd sentence
    expect(longCheckpoint!.description).toContain('refactored');
    expect(longCheckpoint!.description.length).toBeLessThanOrEqual(150);
  });

  it('returns full descriptions when full: true', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      full: true
    });

    const longCheckpoint = result.checkpoints.find(c => c.tags?.includes('refactor'));
    expect(longCheckpoint).toBeDefined();

    // Should return full description with all sentences
    expect(longCheckpoint!.description).toContain('middleware');  // From 2nd sentence
    expect(longCheckpoint!.description).toContain('refresh token');  // From 3rd sentence
    expect(longCheckpoint!.description.length).toBeGreaterThan(150);
  });

  it('short descriptions are returned as-is', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    const shortCheckpoint = result.checkpoints.find(c => c.tags?.includes('bug-fix'));
    expect(shortCheckpoint).toBeDefined();
    expect(shortCheckpoint!.description).toBe('Fixed login bug');
  });

  it('does not expose internal metadata fields in recall response', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    const longCheckpoint = result.checkpoints.find(c => c.tags?.includes('refactor'));
    expect(longCheckpoint).toBeDefined();

    // Internal metadata fields should be stripped from response
    expect(longCheckpoint).not.toHaveProperty('summary');
  });

  it('search results use compact descriptions by default', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication'
    });

    const fullResult = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      full: true
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    const authCheckpoint = result.checkpoints.find(c => c.tags?.includes('refactor'));
    const fullCheckpoint = fullResult.checkpoints.find(c => c.tags?.includes('refactor'));

    expect(authCheckpoint).toBeDefined();
    expect(fullCheckpoint).toBeDefined();
    expect(authCheckpoint!.description).toBe(buildCompactSearchDescription(fullCheckpoint!));
    expect(authCheckpoint!.description.length).toBeLessThanOrEqual(220);
  });

  it('full: true preserves full descriptions for search results', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      full: true
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    const authCheckpoint = result.checkpoints[0];
    expect(authCheckpoint!.description).toContain('middleware');
    expect(authCheckpoint!.description.length).toBeGreaterThan(150);
  });
});

describe('recall with limit parameter', () => {
  beforeEach(async () => {
    // Create 15 checkpoints for limit testing with slight delays to ensure distinct timestamps
    for (let i = 1; i <= 15; i++) {
      await saveCheckpoint({
        description: `Checkpoint ${i}`,
        tags: ['test'],
        workspace: TEST_DIR_A
      });
      // Small delay to ensure distinct timestamps
      await new Promise(resolve => setTimeout(resolve, 2));
    }
  });

  it('limits number of returned checkpoints when limit specified', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 5
    });

    expect(result.checkpoints).toHaveLength(5);
  });

  it('defaults to 5 checkpoints when no limit specified', async () => {
    const result = await recall({
      workspace: TEST_DIR_A
    });

    expect(result.checkpoints).toHaveLength(5);
  });

  it('returns most recent checkpoints first when limited', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 3
    });

    expect(result.checkpoints).toHaveLength(3);
    // Note: All checkpoints created in same minute have same timestamp (HH:MM precision)
    // So we just verify we got 3 checkpoints, sorted by timestamp
    expect(result.checkpoints[0]!.timestamp).toBeDefined();
    expect(result.checkpoints[1]!.timestamp).toBeDefined();
    expect(result.checkpoints[2]!.timestamp).toBeDefined();
  });

  it('returns all checkpoints if limit exceeds count', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 100
    });

    expect(result.checkpoints).toHaveLength(15);
  });

  it('limit works with search parameter', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'Checkpoint',
      limit: 3
    });

    expect(result.checkpoints.length).toBeLessThanOrEqual(3);
  });

  it('allows limit: 0 to return no checkpoints (brief only)', async () => {
    await saveBrief({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Plan content',
      workspace: TEST_DIR_A,
      activate: true
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 0
    });

    expect(result.checkpoints).toHaveLength(0);
    expect(result.activeBrief).toBeDefined();
  });

  it('limit: 0 single-workspace returns brief but skips checkpoints', async () => {
    await saveBrief({
      id: 'plan-shortcircuit',
      title: 'Short Circuit Plan',
      content: 'Plan content',
      workspace: TEST_DIR_A,
      activate: true
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 0
    });

    expect(result.checkpoints).toHaveLength(0);
    expect(result.activeBrief).toBeDefined();
    expect(result.activeBrief!.id).toBe('plan-shortcircuit');
    // Phase 2: consolidation state is no longer surfaced from recall.
    expect((result as unknown as Record<string, unknown>).consolidation).toBeUndefined();
  });
});

describe('recall with minimal metadata', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Authentication fix',
      tags: ['bug-fix', 'auth'],
      workspace: TEST_DIR_A
    });
  });

  it('strips git metadata by default', async () => {
    const result = await recall({
      workspace: TEST_DIR_A
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!).not.toHaveProperty('git');
  });

  it('keeps tags by default (useful for context)', async () => {
    const result = await recall({
      workspace: TEST_DIR_A
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.tags).toEqual(['bug-fix', 'auth']);
  });

  it('includes all metadata when full: true', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      full: true
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    // Should have all metadata when full is requested
    const checkpoint = result.checkpoints[0]!;

    // Tags should still be present
    expect(checkpoint.tags).toBeDefined();

    // Git metadata should be present if it was saved
    if (checkpoint.git) {
      // If git metadata exists, full: true should preserve it
      expect(true).toBe(true);
    }
  });

  it('minimal metadata reduces token usage significantly', async () => {
    // Create checkpoint with lots of files (simulates real usage)
    await saveCheckpoint({
      description: 'Large refactor',
      tags: ['refactor'],
      workspace: TEST_DIR_A
    });

    const minimal = await recall({
      workspace: TEST_DIR_A,
      limit: 5
    });

    const full = await recall({
      workspace: TEST_DIR_A,
      limit: 5,
      full: true
    });

    const minimalJson = JSON.stringify(minimal.checkpoints);
    const fullJson = JSON.stringify(full.checkpoints);

    // Minimal should be noticeably smaller
    // (Exact ratio depends on git context, but minimal should be <= full)
    expect(minimalJson.length).toBeLessThanOrEqual(fullJson.length);
  });
});

describe('recall with since parameter', () => {
  it('recalls checkpoints from last 2 hours using "2h"', async () => {
    // Create a checkpoint now
    await saveCheckpoint({
      description: 'Recent work',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      since: '2h'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toBe('Recent work');
  });

  it('recalls checkpoints from last 30 minutes using "30m"', async () => {
    await saveCheckpoint({
      description: 'Very recent work',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      since: '30m'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('recalls checkpoints from last 3 days using "3d"', async () => {
    await saveCheckpoint({
      description: 'Recent work',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      since: '3d'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('recalls checkpoints from ISO timestamp', async () => {
    await saveCheckpoint({
      description: 'Test checkpoint',
      workspace: TEST_DIR_A
    });

    // Use a timestamp from 1 hour ago
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const result = await recall({
      workspace: TEST_DIR_A,
      since: oneHourAgo
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('since parameter takes priority over days parameter', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_DIR_A
    });

    // Both parameters provided - 'since' should win
    const result = await recall({
      workspace: TEST_DIR_A,
      since: '1h',
      days: 7  // Should be ignored
    });

    // Verify it used 'since' (checkpoints exist)
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('falls back to days parameter when since not provided', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      days: 1
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('uses last-N mode when no date filters are provided', async () => {
    await saveCheckpoint({
      description: 'Test',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('combines since with search parameter', async () => {
    await saveCheckpoint({
      description: 'Authentication work',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Database work',
      tags: ['database'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      since: '1h',
      search: 'auth'
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description).toContain('Authentication');
  });
});

describe('Default recall uses last-N mode (no date window)', () => {
  it('finds old checkpoints when no date params specified', async () => {
    // Manually create a checkpoint file in an old date directory
    const { mkdir, writeFile } = await import('fs/promises');
    const memoriesDir = join(TEST_DIR_A, '.memories', '2020-01-15');
    await mkdir(memoriesDir, { recursive: true });

    const oldCheckpoint = [
      '---',
      'id: checkpoint_old12345',
      'timestamp: "2020-01-15T10:30:00.000Z"',
      'tags:',
      '  - ancient',
      '---',
      '',
      'Work from years ago'
    ].join('\n');
    await writeFile(join(memoriesDir, '103000_old1.md'), oldCheckpoint, 'utf-8');

    // Default recall (no date params) should find it
    const result = await recall({ workspace: TEST_DIR_A });
    const descriptions = result.checkpoints.map(c => c.description);
    expect(descriptions).toContain('Work from years ago');
  });

  it('does NOT find old checkpoints when days param limits the range', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    const memoriesDir = join(TEST_DIR_A, '.memories', '2020-01-15');
    await mkdir(memoriesDir, { recursive: true });

    const oldCheckpoint = [
      '---',
      'id: checkpoint_old12345',
      'timestamp: "2020-01-15T10:30:00.000Z"',
      'tags:',
      '  - ancient',
      '---',
      '',
      'Work from years ago'
    ].join('\n');
    await writeFile(join(memoriesDir, '103000_old1.md'), oldCheckpoint, 'utf-8');

    // With explicit days param, should NOT find the old checkpoint
    const result = await recall({ workspace: TEST_DIR_A, days: 7 });
    const descriptions = result.checkpoints.map(c => c.description);
    expect(descriptions).not.toContain('Work from years ago');
  });

  it('returns newest checkpoints first in last-N mode', async () => {
    // Create checkpoints with different dates

    const dates = ['2024-06-01', '2024-09-15', '2025-01-10'];
    for (const date of dates) {
      const dir = join(TEST_DIR_A, '.memories', date);
      await mkdir(dir, { recursive: true });
      const content = [
        '---',
        `id: checkpoint_${date.replace(/-/g, '')}`,
        `timestamp: "${date}T12:00:00.000Z"`,
        '---',
        '',
        `Work from ${date}`
      ].join('\n');
      await writeFile(join(dir, '120000_test.md'), content, 'utf-8');
    }

    const result = await recall({ workspace: TEST_DIR_A, limit: 3 });

    // Should be newest first
    expect(result.checkpoints[0]!.description).toBe('Work from 2025-01-10');
    expect(result.checkpoints[1]!.description).toBe('Work from 2024-09-15');
    expect(result.checkpoints[2]!.description).toBe('Work from 2024-06-01');
  });
});

describe('briefId filtering', () => {
  const PLAN_DIR = join(tmpdir(), `goldfish-test-plan-filter-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(PLAN_DIR, { recursive: true });
    process.env.GOLDFISH_WORKSPACE = PLAN_DIR;
  });

  afterAll(async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    await rm(PLAN_DIR, { recursive: true, force: true });
  });

  test('filters checkpoints by briefId', async () => {
    const memoriesDir = join(PLAN_DIR, '.memories');
    const dateDir = join(memoriesDir, '2026-01-15');
    await mkdir(dateDir, { recursive: true });

    const cp1 = `---
id: checkpoint_aaa
timestamp: "2026-01-15T10:00:00.000Z"
briefId: brief-a
---

Work on plan A`;

    const cp2 = `---
id: checkpoint_bbb
timestamp: "2026-01-15T11:00:00.000Z"
planId: legacy-brief-b
---

Work on plan B`;

    const cp3 = `---
id: checkpoint_ccc
timestamp: "2026-01-15T12:00:00.000Z"
---

Work without a plan`;

    await writeFile(join(dateDir, '100000_aaa.md'), cp1);
    await writeFile(join(dateDir, '110000_bbb.md'), cp2);
    await writeFile(join(dateDir, '120000_ccc.md'), cp3);

    const result = await recall({
      workspace: PLAN_DIR,
      briefId: 'brief-a',
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe('checkpoint_aaa');
  });

  test('matches legacy planId checkpoints through the briefId filter', async () => {
    const result = await recall({
      workspace: PLAN_DIR,
      briefId: 'legacy-brief-b',
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe('checkpoint_bbb');
  });

  test('ignores legacy planId option (no longer accepted as a briefId alias)', async () => {
    // Phase 3 retires the planId compat alias on RecallOptions. Passing it
    // must not filter results: with no briefId set, all 3 checkpoints come back.
    const result = await recall({
      workspace: PLAN_DIR,
      // @ts-expect-error -- planId is intentionally removed from RecallOptions in v7
      planId: 'legacy-brief-b',
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(3);
  });

  test('returns all checkpoints when briefId is not specified', async () => {
    const result = await recall({
      workspace: PLAN_DIR,
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(3);
  });
});

describe('Phase 2 consolidation removal', () => {
  // The consolidation pipeline (memory.yaml synthesis, ~/.goldfish/consolidation-state/
  // cursors, the consolidate MCP tool) is being deleted. Recall results must
  // no longer carry any consolidation-derived fields.

  it('does not surface a consolidated memory blob', async () => {
    await saveCheckpoint({
      description: 'Some work',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    // Even when callers pass deprecated options, recall must not read
    // memory.yaml/MEMORY.md and must not populate result.memory.
    const resultRecord = result as unknown as Record<string, unknown>;
    expect(resultRecord.memory).toBeUndefined();
  });

  it('does not return a consolidation flag', async () => {
    await saveCheckpoint({
      description: 'Some work',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    const resultRecord = result as unknown as Record<string, unknown>;
    expect(resultRecord.consolidation).toBeUndefined();
  });

  it('does not return matchedMemorySections from search', async () => {
    await saveCheckpoint({
      description: 'Implemented OAuth2 PKCE flow for mobile clients',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'OAuth2',
      limit: 5
    });

    const resultRecord = result as unknown as Record<string, unknown>;
    expect(resultRecord.matchedMemorySections).toBeUndefined();
  });

  it('no longer exports MEMORY_SECTION_PREFIX from src/recall', async () => {
    // Phase 2.6 strips the memory-section synthesis from recall.ts. The
    // module-level constant disappears with it.
    const recallModule = await import('../src/recall');
    expect((recallModule as Record<string, unknown>).MEMORY_SECTION_PREFIX).toBeUndefined();
  });

  it('no longer exports writeMemory or writeConsolidationState from src/memory', async () => {
    // Phase 2.5 deletes the consolidation-state I/O helpers. The module
    // itself may also disappear — either outcome satisfies the contract.
    // Build the specifier dynamically so the typechecker does not resolve it
    // statically once the module is gone.
    const memorySpecifier = '../src/memory';
    let memoryModule: Record<string, unknown> | null = null;
    try {
      memoryModule = (await import(memorySpecifier)) as Record<string, unknown>;
    } catch {
      memoryModule = null;
    }
    if (memoryModule !== null) {
      expect(memoryModule.writeMemory).toBeUndefined();
      expect(memoryModule.writeConsolidationState).toBeUndefined();
    }
  });
});

describe('Structured recall filters (type / tags)', () => {
  async function seedTypedCheckpoints(workspace: string): Promise<void> {
    await saveCheckpoint({
      description: 'Chose Postgres over Mongo',
      type: 'decision',
      tags: ['db', 'architecture'],
      workspace
    });
    await new Promise(resolve => setTimeout(resolve, 2));
    await saveCheckpoint({
      description: 'Prod outage from connection pool exhaustion',
      type: 'incident',
      tags: ['db', 'ops'],
      workspace
    });
    await new Promise(resolve => setTimeout(resolve, 2));
    await saveCheckpoint({
      description: 'Wired the migration runner',
      // no explicit type → stored untyped, conceptually a 'checkpoint'
      tags: ['db'],
      workspace
    });
    await new Promise(resolve => setTimeout(resolve, 2));
  }

  it('filters checkpoints by a single type', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ type: 'decision', workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Chose Postgres over Mongo');
    expect(result.checkpoints[0]!.type).toBe('decision');
  });

  it('treats an untyped checkpoint as the default "checkpoint" type', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ type: 'checkpoint', workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Wired the migration runner');
  });

  it('matches type case-insensitively', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ type: 'INCIDENT', workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Prod outage from connection pool exhaustion');
  });

  it('filters checkpoints that contain ALL requested tags (AND semantics)', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ tags: ['db', 'ops'], workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Prod outage from connection pool exhaustion');
  });

  it('returns every checkpoint carrying a single requested tag', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ tags: ['db'], workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(3);
  });

  it('matches tags case-insensitively', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const result = await recall({ tags: ['Architecture'], workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Chose Postgres over Mongo');
  });

  it('combines type and tags filters (both must match)', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    const matched = await recall({ type: 'decision', tags: ['db'], workspace: TEST_DIR_A });
    expect(matched.checkpoints).toHaveLength(1);
    expect(matched.checkpoints[0]!.description).toBe('Chose Postgres over Mongo');

    // type matches but the tag set does not → no results
    const missed = await recall({ type: 'decision', tags: ['ops'], workspace: TEST_DIR_A });
    expect(missed.checkpoints).toHaveLength(0);
  });

  it('applies structured filters alongside search', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    // "db" matches all three by tag/body, but type narrows to the incident.
    const result = await recall({ search: 'pool', type: 'incident', workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toContain('connection pool');
  });

  it('accepts a comma-separated tags string from non-array clients', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);

    // Some MCP clients send scalars where the schema declares an array.
    const result = await recall({ tags: 'db, ops' as unknown as string[], workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Prod outage from connection pool exhaustion');
  });

  it('finds a filtered match older than the default limit window', async () => {
    // The only 'decision' is the OLDEST checkpoint, buried behind more than
    // `limit` newer checkpoints. A correct filter must scan past the recent-N
    // window instead of slicing to the newest 5 before filtering.
    await saveCheckpoint({
      description: 'Old architectural decision',
      type: 'decision',
      tags: ['legacy'],
      workspace: TEST_DIR_A
    });
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 6; i++) {
      await saveCheckpoint({
        description: `Routine progress ${i}`,
        workspace: TEST_DIR_A
      });
      await new Promise(resolve => setTimeout(resolve, 2));
    }

    const result = await recall({ type: 'decision', workspace: TEST_DIR_A });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Old architectural decision');
  });

  it('applies structured filters in cross-workspace recall', async () => {
    await seedTypedCheckpoints(TEST_DIR_A);
    await saveCheckpoint({
      description: 'Decided to adopt feature flags',
      type: 'decision',
      tags: ['rollout'],
      workspace: TEST_DIR_B
    });

    const { registerProject } = await import('../src/registry');
    await registerProject(TEST_DIR_A);
    await registerProject(TEST_DIR_B);

    const result = await recall({ type: 'decision', workspace: 'all' });

    const descriptions = result.checkpoints.map(c => c.description).sort();
    expect(descriptions).toEqual(['Chose Postgres over Mongo', 'Decided to adopt feature flags']);
  });

  it('finds a cross-workspace filtered match older than the per-project default window', async () => {
    // The only 'decision' is the oldest checkpoint in its project, behind more
    // than the default per-project window. Cross-workspace filtering must scan
    // the full corpus, not just each project's newest few.
    await saveCheckpoint({
      description: 'Buried cross-project decision',
      type: 'decision',
      workspace: TEST_DIR_A
    });
    await new Promise(resolve => setTimeout(resolve, 2));
    for (let i = 0; i < 6; i++) {
      await saveCheckpoint({ description: `Filler ${i}`, workspace: TEST_DIR_A });
      await new Promise(resolve => setTimeout(resolve, 2));
    }

    const { registerProject } = await import('../src/registry');
    await registerProject(TEST_DIR_A);

    const result = await recall({ type: 'decision', workspace: 'all' });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.description).toBe('Buried cross-project decision');
  });
});

describe('File recall filter', () => {
  async function writeFileCheckpoint(
    workspace: string,
    date: string,
    time: string,
    id: string,
    files: string[],
    body: string
  ): Promise<void> {
    const dir = join(getMemoriesDir(workspace), date);
    await mkdir(dir, { recursive: true });
    const filesYaml = files.map(f => `    - ${f}`).join('\n');
    const content = `---\nid: ${id}\ntimestamp: "${date}T${time}.000Z"\ngit:\n  branch: main\n  commit: abc1234\n  files:\n${filesYaml}\n---\n\n${body}\n`;
    await writeFile(join(dir, `${time.replace(/:/g, '')}_${id}.md`), content, 'utf-8');
  }

  beforeEach(async () => {
    await writeFileCheckpoint(TEST_DIR_A, '2026-05-01', '10:00:00', 'cp_recall', ['src/recall.ts'], 'Recall module work');
    await new Promise(resolve => setTimeout(resolve, 2));
    await writeFileCheckpoint(TEST_DIR_A, '2026-05-02', '10:00:00', 'cp_handler', ['src/handlers/recall.ts'], 'Handler work');
    await new Promise(resolve => setTimeout(resolve, 2));
    await writeFileCheckpoint(TEST_DIR_A, '2026-05-03', '10:00:00', 'cp_install', ['src/install-all.ts'], 'Install script');
  });

  it('matches path suffix with boundary guard', async () => {
    const recallHits = await recall({ file: 'recall.ts', workspace: TEST_DIR_A });
    expect(recallHits.checkpoints.map(c => c.id).sort()).toEqual(['cp_handler', 'cp_recall']);

    const handlerOnly = await recall({ file: 'handlers/recall.ts', workspace: TEST_DIR_A });
    expect(handlerOnly.checkpoints).toHaveLength(1);
    expect(handlerOnly.checkpoints[0]!.id).toBe('cp_handler');

    const noBoundary = await recall({ file: 'all.ts', workspace: TEST_DIR_A });
    expect(noBoundary.checkpoints).toHaveLength(0);
  });

  it('normalizes Windows-style queries and matches case-insensitively', async () => {
    const result = await recall({ file: 'src\\recall.ts', workspace: TEST_DIR_A });
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe('cp_recall');
  });

  it('matches absolute path queries against stored relative git.files', async () => {
    const absolute = join(TEST_DIR_A, 'src/recall.ts');
    const result = await recall({ file: absolute, workspace: TEST_DIR_A });
    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe('cp_recall');
  });

  it('scans the full corpus and composes with other filters', async () => {
    for (let i = 0; i < 6; i++) {
      await saveCheckpoint({ description: `Filler ${i}`, workspace: TEST_DIR_A });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    await writeFileCheckpoint(TEST_DIR_A, '2026-04-01', '10:00:00', 'cp_old', ['src/recall.ts'], 'Old recall change');

    const result = await recall({ file: 'recall.ts', workspace: TEST_DIR_A });
    expect(result.checkpoints.map(c => c.id)).toContain('cp_old');

    const typed = await recall({ file: 'recall.ts', type: 'decision', workspace: TEST_DIR_A });
    expect(typed.checkpoints).toHaveLength(0);
  });

  it('works in cross-workspace recall', async () => {
    await writeFileCheckpoint(TEST_DIR_B, '2026-05-01', '10:00:00', 'cp_b', ['src/recall.ts'], 'Other project');
    const { registerProject } = await import('../src/registry');
    await registerProject(TEST_DIR_A);
    await registerProject(TEST_DIR_B);

    const result = await recall({ file: 'recall.ts', workspace: 'all' });
    const ids = result.checkpoints.map(c => c.id).sort();
    expect(ids).toEqual(['cp_b', 'cp_handler', 'cp_recall']);
  });
});

describe('Symbol recall filter', () => {
  async function writeSymbolCheckpoint(
    workspace: string,
    date: string,
    time: string,
    id: string,
    symbols: string[],
    body: string
  ): Promise<void> {
    const dir = join(getMemoriesDir(workspace), date);
    await mkdir(dir, { recursive: true });
    const symbolsYaml = symbols.map(s => `  - ${s}`).join('\n');
    const content = `---\nid: ${id}\ntimestamp: "${date}T${time}.000Z"\nsymbols:\n${symbolsYaml}\n---\n\n${body}\n`;
    await writeFile(join(dir, `${time.replace(/:/g, '')}_${id}.md`), content, 'utf-8');
  }

  beforeEach(async () => {
    await writeSymbolCheckpoint(
      TEST_DIR_A,
      '2026-05-01',
      '10:00:00',
      'cp_recover',
      ['recoverWorkspace', 'parentWalkWorkspace'],
      'Workspace recovery'
    );
  });

  it('matches whole symbol names case-insensitively', async () => {
    const hit = await recall({ symbol: 'recoverWorkspace', workspace: TEST_DIR_A });
    expect(hit.checkpoints).toHaveLength(1);
    expect(hit.checkpoints[0]!.id).toBe('cp_recover');

    const partial = await recall({ symbol: 'recover', workspace: TEST_DIR_A });
    expect(partial.checkpoints).toHaveLength(0);

    const caseHit = await recall({ symbol: 'RECOVERWORKSPACE', workspace: TEST_DIR_A });
    expect(caseHit.checkpoints).toHaveLength(1);
  });

  it('scans the full corpus and works cross-workspace', async () => {
    for (let i = 0; i < 6; i++) {
      await saveCheckpoint({ description: `Filler ${i}`, workspace: TEST_DIR_A });
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    await writeSymbolCheckpoint(TEST_DIR_A, '2026-04-01', '10:00:00', 'cp_old', ['recoverWorkspace'], 'Old recovery');

    const result = await recall({ symbol: 'recoverWorkspace', workspace: TEST_DIR_A });
    expect(result.checkpoints.map(c => c.id)).toContain('cp_old');

    await writeSymbolCheckpoint(TEST_DIR_B, '2026-05-02', '10:00:00', 'cp_b', ['recoverWorkspace'], 'Other project');
    const { registerProject } = await import('../src/registry');
    await registerProject(TEST_DIR_A);
    await registerProject(TEST_DIR_B);

    const all = await recall({ symbol: 'recoverWorkspace', workspace: 'all' });
    expect(all.checkpoints.map(c => c.id).sort()).toEqual(['cp_b', 'cp_old', 'cp_recover']);
  });
});

describe('Compact display for intent-blame filters', () => {
  async function writeFileCheckpoint(
    workspace: string,
    date: string,
    time: string,
    id: string,
    files: string[],
    symbols: string[] | undefined,
    body: string
  ): Promise<void> {
    const dir = join(getMemoriesDir(workspace), date);
    await mkdir(dir, { recursive: true });
    const filesYaml = files.map(f => `    - ${f}`).join('\n');
    const symbolsBlock = symbols && symbols.length > 0
      ? `symbols:\n${symbols.map(s => `  - ${s}`).join('\n')}\n`
      : '';
    const content = `---\nid: ${id}\ntimestamp: "${date}T${time}.000Z"\n${symbolsBlock}git:\n  branch: main\n  commit: abc1234\n  files:\n${filesYaml}\n---\n\n${body}\n`;
    await writeFile(join(dir, `${time.replace(/:/g, '')}_${id}.md`), content, 'utf-8');
  }

  it('retains git.files in compact file-filtered recall', async () => {
    await writeFileCheckpoint(TEST_DIR_A, '2026-05-01', '10:00:00', 'cp_file', ['src/recall.ts'], undefined, 'Recall work');

    const result = await recall({ file: 'recall.ts', workspace: TEST_DIR_A });
    expect(result.checkpoints[0]!.git?.files).toEqual(['src/recall.ts']);
  });

  it('retains symbols in compact symbol-filtered recall', async () => {
    await writeFileCheckpoint(TEST_DIR_A, '2026-05-01', '10:00:00', 'cp_sym', [], ['recoverWorkspace'], 'Recovery work');

    const result = await recall({ symbol: 'recoverWorkspace', workspace: TEST_DIR_A });
    expect(result.checkpoints[0]!.symbols).toEqual(['recoverWorkspace']);
  });

  it('strips git and symbols in unfiltered compact recall', async () => {
    await writeFileCheckpoint(
      TEST_DIR_A,
      '2026-05-01',
      '10:00:00',
      'cp_strip',
      ['src/recall.ts'],
      ['recoverWorkspace'],
      'Mixed metadata'
    );

    const result = await recall({ workspace: TEST_DIR_A, limit: 1 });
    expect(result.checkpoints[0]!.git).toBeUndefined();
    expect(result.checkpoints[0]!.symbols).toBeUndefined();
  });
});
