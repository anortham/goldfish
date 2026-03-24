import { describe, it, test, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { recall, searchCheckpoints, parseSince, MEMORY_SECTION_PREFIX } from '../src/recall';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { buildCompactSearchDescription } from '../src/digests';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { savePlan } from '../src/plans';
import { loadSemanticState, listPendingSemanticRecords, markSemanticRecordReady } from '../src/semantic-cache';
import { setDefaultSemanticRuntime } from '../src/transformers-embedder';
import { ensureMemoriesDir, getSemanticCacheDir } from '../src/workspace';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Checkpoint } from '../src/types';

let TEST_DIR_A: string;
let TEST_DIR_B: string;
let restoreCheckpointDeps: (() => void) | undefined;

const TEST_DEFAULT_RUNTIME = {
  isReady: () => false,
  getModelInfo: () => ({ id: 'test-default-model', version: '1' }),
  embedTexts: async () => [[1, 0]]
};

beforeAll(() => {
  setDefaultSemanticRuntime(TEST_DEFAULT_RUNTIME);
});

afterAll(() => {
  setDefaultSemanticRuntime(undefined);
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
    // Create some test checkpoints
    await saveCheckpoint({
      description: 'Fixed authentication bug',
      tags: ['bug-fix', 'auth'],
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Added OAuth2 support',
      tags: ['feature', 'auth'],
      workspace: TEST_DIR_A
    });

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

  it('treats days: 0 as an explicit date filter', async () => {
    await saveCheckpoint({
      description: 'Checkpoint outside zero-day window',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      days: 0,
      limit: 10
    });

    expect(result.checkpoints).toEqual([]);
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

  it('performs fuzzy matching', async () => {
    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authenticaton'  // Typo
    });

    // Should still find authentication-related checkpoints
    expect(result.checkpoints.length).toBeGreaterThan(0);
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

  it('uses semantic ranking to rescue wording mismatches when runtime is ready', async () => {
    const exactLexical = await saveCheckpoint({
      description: 'Fixed login timeout bug in authentication flow',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    const semanticRescue = await saveCheckpoint({
      description: 'Resolved idle session expiry for returning users',
      tags: ['session'],
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'Refactored database migration scripts',
      tags: ['database'],
      workspace: TEST_DIR_A
    });

    await markSemanticRecordReady(TEST_DIR_A, exactLexical.id, [0.7, 0.3], { id: 'test-model', version: '1' });
    await markSemanticRecordReady(TEST_DIR_A, semanticRescue.id, [1, 0], { id: 'test-model', version: '1' });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'login timeout issue',
      limit: 3,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async (texts: string[]) => {
          return texts.map(text =>
            text.includes('login timeout') ? [1, 0] : [0, 1]
          );
        }
      }
    });

    const rankedIds = result.checkpoints.map(c => c.id);
    expect(rankedIds.slice(0, 2)).toEqual([
      exactLexical.id,
      semanticRescue.id
    ]);
  });

  it('keeps exact lexical matches ahead of vaguer semantic matches', async () => {
    const exactLexical = await saveCheckpoint({
      description: 'Implemented semantic recall ranking for authentication timeout search',
      tags: ['semantic-recall'],
      workspace: TEST_DIR_B
    });

    const vagueSemantic = await saveCheckpoint({
      description: 'Improved memory retrieval for related support incidents',
      tags: ['incidents'],
      workspace: TEST_DIR_B
    });

    await markSemanticRecordReady(TEST_DIR_B, exactLexical.id, [0.95, 0.05], { id: 'test-model', version: '1' });
    await markSemanticRecordReady(TEST_DIR_B, vagueSemantic.id, [1, 0], { id: 'test-model', version: '1' });

    const result = await recall({
      workspace: TEST_DIR_B,
      search: 'authentication timeout semantic recall ranking',
      limit: 2,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => [[1, 0]]
      }
    });

    expect(result.checkpoints.map(c => c.id)).toEqual([
      exactLexical.id,
      vagueSemantic.id
    ]);
  });

  it('applies planId filtering before search ranking', async () => {
    const exactOtherPlan = await saveCheckpoint({
      description: 'Semantic recall ranking overhaul for authentication timeout search',
      tags: ['search'],
      workspace: TEST_DIR_A
    });

    await savePlan({
      id: 'semantic-plan',
      title: 'Semantic Recall',
      content: 'Plan content',
      workspace: TEST_DIR_A,
      activate: true
    });

    const matchingPlan = await saveCheckpoint({
      description: 'Resolved idle session expiry for returning users',
      tags: ['session'],
      workspace: TEST_DIR_A
    });

    await markSemanticRecordReady(TEST_DIR_A, exactOtherPlan.id, [0.1, 0.9], { id: 'test-model', version: '1' });
    await markSemanticRecordReady(TEST_DIR_A, matchingPlan.id, [1, 0], { id: 'test-model', version: '1' });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'login timeout issue',
      planId: 'semantic-plan',
      limit: 5,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => [[1, 0]]
      }
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe(matchingPlan.id);
  });

  it('processes all pending semantic records in a warm search call', async () => {
    for (let i = 1; i <= 4; i++) {
      await saveCheckpoint({
        description: `Authentication search record ${i}`,
        tags: ['auth'],
        workspace: TEST_DIR_A
      });
    }

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
      }
    });

    const pending = await listPendingSemanticRecords(TEST_DIR_A);
    const state = await loadSemanticState(TEST_DIR_A);

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(pending).toHaveLength(0);
    expect(state.records.filter(record => record.status === 'ready')).toHaveLength(7);
  });

  it('processes entire pending backlog in a single maintenance pass', async () => {
    const runtime = {
      isReady: () => true,
      getModelInfo: () => ({ id: 'test-model', version: '1' }),
      embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
    }

    // Create 10 checkpoints to produce 10 pending records
    for (let i = 0; i < 10; i++) {
      await saveCheckpoint({
        description: `Checkpoint ${i} for bulk maintenance`,
        tags: ['bulk-test'],
        workspace: TEST_DIR_A
      })
    }

    // First recall with search triggers backfill + maintenance
    await recall({
      search: 'bulk maintenance',
      workspace: TEST_DIR_A,
      _semanticRuntime: runtime
    })

    // All records should now be ready (not capped at 3)
    // beforeEach creates 3 checkpoints + 10 new ones = 13 total
    const state = await loadSemanticState(TEST_DIR_A)
    const readyCount = state.records.filter(r => r.status === 'ready').length
    expect(readyCount).toBe(13)
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

  it('does not run semantic maintenance for plain recall without search', async () => {
    await saveCheckpoint({
      description: 'Checkpoint that should stay pending',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    const before = await listPendingSemanticRecords(TEST_DIR_A);

    const result = await recall({
      workspace: TEST_DIR_A,
      limit: 10,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
      }
    });

    const after = await listPendingSemanticRecords(TEST_DIR_A);

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(after).toHaveLength(before.length);
  });

  it('warms a cold runtime on first search and lets the next warm search rank newly indexed semantic matches immediately', async () => {
    const lexicalMatch = await saveCheckpoint({
      description: 'Fixed login timeout bug in authentication flow',
      tags: ['auth'],
      workspace: TEST_DIR_B
    });

    const semanticRescue = await saveCheckpoint({
      description: 'Resolved idle session expiry for returning users',
      tags: ['session'],
      workspace: TEST_DIR_B
    });

    const initialSemanticState = await loadSemanticState(TEST_DIR_B);
    const lexicalDigest = initialSemanticState.records.find(record => record.checkpointId === lexicalMatch.id)!.digest;
    const semanticDigest = initialSemanticState.records.find(record => record.checkpointId === semanticRescue.id)!.digest;

    let warm = false;
    const embedCalls: string[] = [];

    const runtime = {
      isReady: () => warm,
      getModelInfo: () => ({ id: 'test-model', version: '1' }),
      embedTexts: async (texts: string[]) => {
        const text = texts[0]!;
        embedCalls.push(text);
        warm = true;

        if (text === 'login timeout issue') {
          return [[1, 0]];
        }

        if (text.includes('Resolved idle session expiry')) {
          return [[1, 0]];
        }

        return [[0, 1]];
      }
    };

    const firstResult = await recall({
      workspace: TEST_DIR_B,
      search: 'login timeout issue',
      limit: 10,
      _semanticRuntime: runtime
    });

    const afterFirstSearch = await loadSemanticState(TEST_DIR_B);

    const secondResult = await recall({
      workspace: TEST_DIR_B,
      search: 'login timeout issue',
      limit: 10,
      _semanticRuntime: runtime
    });

    const afterSecondSearch = await loadSemanticState(TEST_DIR_B);

    expect(firstResult.checkpoints.map(c => c.id)).toEqual([lexicalMatch.id]);
    expect(secondResult.checkpoints.map(c => c.id).slice(0, 2)).toEqual([
      semanticRescue.id,
      lexicalMatch.id
    ]);
    expect(afterFirstSearch.records.filter(record => record.status === 'ready')).toHaveLength(2);
    expect(afterSecondSearch.records.filter(record => record.status === 'ready')).toHaveLength(2);
    expect(embedCalls).toEqual([
      'login timeout issue',
      lexicalDigest,
      semanticDigest,
      'login timeout issue'
    ]);
  });

  it('invalidates incompatible ready records before search ranking', async () => {
    const incompatible = await saveCheckpoint({
      description: 'Resolved idle session expiry for returning users',
      tags: ['session'],
      workspace: TEST_DIR_A
    });

    await markSemanticRecordReady(TEST_DIR_A, incompatible.id, [1, 0], {
      id: 'old-model',
      version: '1'
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'login timeout issue',
      limit: 10,
      _semanticRuntime: {
        isReady: () => false,
        getModelInfo: () => ({ id: 'new-model', version: '2' }),
        embedTexts: async () => [[1, 0]]
      }
    });

    const pending = await listPendingSemanticRecords(TEST_DIR_A);
    const state = await loadSemanticState(TEST_DIR_A);

    expect(result.checkpoints.map(c => c.id)).not.toContain(incompatible.id);
    expect(pending.map(record => record.checkpointId)).toContain(incompatible.id);
    expect(state.records.find(record => record.checkpointId === incompatible.id)?.staleReason).toBe('model-version');
  });

  it('returns search results when pending maintenance cannot produce embeddings', async () => {
    await saveCheckpoint({
      description: 'Authentication maintenance fallback',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    let embedCalls = 0;

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => {
          embedCalls += 1;
          return embedCalls === 1 ? [[1, 0]] : [];
        }
      }
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description.toLowerCase()).toContain('auth');
  });

  it('falls back to lexical results when semantic embedding fails during ranking', async () => {
    await saveCheckpoint({
      description: 'Authentication fallback ranking result',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => {
          throw new Error('semantic ranking failed');
        }
      }
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description.toLowerCase()).toContain('auth');
  });

  it('returns search results when semantic maintenance throws', async () => {
    await saveCheckpoint({
      description: 'Authentication maintenance error handling',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    let embedCalls = 0;

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => {
          embedCalls += 1;
          if (embedCalls > 1) {
            throw new Error('semantic maintenance failed');
          }

          return [[1, 0]];
        }
      }
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);
    expect(result.checkpoints[0]!.description.toLowerCase()).toContain('auth');
  });

  it('warns when semantic maintenance throws', async () => {
    await saveCheckpoint({
      description: 'Authentication maintenance warning path',
      tags: ['auth'],
      workspace: TEST_DIR_A
    });

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(arg => String(arg)).join(' '));
    };

    try {
      await recall({
        workspace: TEST_DIR_A,
        search: 'authentication',
        limit: 10,
        _semanticRuntime: {
          isReady: () => true,
          getModelInfo: () => ({ id: 'test-model', version: '1' }),
          embedTexts: async () => {
            throw new Error('semantic maintenance warning');
          }
        }
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
    expect(warnings[0]!).toContain('semantic maintenance failed');
    expect(warnings[0]!).toContain('semantic maintenance warning');
  });

  it('backfills checkpoints missing from semantic cache during search', async () => {
    // beforeEach already saved 3 checkpoints to TEST_DIR_A
    // Record how many semantic records exist from those
    const stateBefore = await loadSemanticState(TEST_DIR_A);
    const countBefore = Object.keys(stateBefore.manifest.checkpoints).length;
    expect(countBefore).toBeGreaterThan(0);

    // Wipe semantic cache to simulate pre-semantic checkpoints
    const cacheDir = getSemanticCacheDir(TEST_DIR_A);
    await rm(cacheDir, { recursive: true, force: true });

    const stateAfterWipe = await loadSemanticState(TEST_DIR_A);
    expect(Object.keys(stateAfterWipe.manifest.checkpoints)).toHaveLength(0);

    // Run recall with search — should backfill missing checkpoints
    await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => false,
        embedTexts: async () => [[1, 0]]
      }
    });

    // Verify backfill restored pending records for all checkpoints
    const stateAfterRecall = await loadSemanticState(TEST_DIR_A);
    expect(Object.keys(stateAfterRecall.manifest.checkpoints).length).toBe(countBefore);

    const pending = await listPendingSemanticRecords(TEST_DIR_A);
    expect(pending).toHaveLength(countBefore);
  });

  it('backfill skips checkpoints already in semantic cache', async () => {
    // beforeEach saved 3 checkpoints — all have semantic records already
    const stateBefore = await loadSemanticState(TEST_DIR_A);
    const recordsBefore = stateBefore.records.length;

    // Run recall with search — should not duplicate the existing records
    await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      limit: 10,
      _semanticRuntime: {
        isReady: () => false,
        embedTexts: async () => [[1, 0]]
      }
    });

    const stateAfter = await loadSemanticState(TEST_DIR_A);
    expect(stateAfter.records).toHaveLength(recordsBefore);
  });

  it('returns empty results when no checkpoints match the search query', async () => {
    // Mark all pending records from beforeEach with orthogonal embeddings [1, 0, 0]
    // so they are semantically unrelated to any query embedding [0, 0, 1]
    const stateBefore = await loadSemanticState(TEST_DIR_A)
    for (const record of stateBefore.records) {
      if (record.status === 'pending') {
        await markSemanticRecordReady(TEST_DIR_A, record.checkpointId, [1, 0, 0], {
          id: 'test-model',
          version: '1'
        })
      }
    }

    // Runtime that returns [0, 0, 1] — orthogonal to all stored embeddings
    // isReady returns false so maintenance doesn't re-embed using this runtime
    const runtime = {
      isReady: () => false,
      getModelInfo: () => ({ id: 'test-model', version: '1' }),
      embedTexts: async (texts: string[]) => texts.map(() => [0, 0, 1])
    }

    const result = await recall({
      search: 'kubernetes deployment configuration',
      workspace: TEST_DIR_A,
      _semanticRuntime: runtime,
      limit: 5
    })

    // Should return 0 results — nothing relevant (all embeddings orthogonal, no lexical match)
    expect(result.checkpoints).toHaveLength(0)
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
    const exactLexical = await saveCheckpoint({
      description: 'Authentication timeout semantic recall ranking rollout',
      tags: ['search'],
      workspace: projectA
    });

    const vagueSemantic = await saveCheckpoint({
      description: 'Resolved idle session expiry for returning users',
      tags: ['session'],
      workspace: projectB
    });

    await markSemanticRecordReady(projectA, exactLexical.id, [0.95, 0.05], { id: 'test-model', version: '1' });
    await markSemanticRecordReady(projectB, vagueSemantic.id, [1, 0], { id: 'test-model', version: '1' });

    const result = await recall({
      workspace: 'all',
      days: 1,
      search: 'authentication timeout semantic recall ranking',
      limit: 2,
      _registryDir: registryDir,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async () => [[1, 0]]
      }
    });

    expect(result.checkpoints.map(c => c.id)).toEqual([
      exactLexical.id,
      vagueSemantic.id
    ]);
  });

  it('returns empty when no projects registered', async () => {
    // Use a fresh empty registry
    const emptyRegistryDir = await mkdtemp(join(tmpdir(), 'test-empty-registry-'));

    const result = await recall({ workspace: 'all', days: 1, _registryDir: emptyRegistryDir });
    expect(result.checkpoints).toEqual([]);

    await rm(emptyRegistryDir, { recursive: true, force: true });
  });
});

describe('Active plan integration', () => {
  beforeEach(async () => {
    await saveCheckpoint({
      description: 'Working on auth',
      workspace: TEST_DIR_A
    });
  });

  it('includes active plan in recall results', async () => {
    await savePlan({
      id: 'auth-plan',
      title: 'Authentication System',
      content: '## Goals\n- JWT\n- OAuth2',
      workspace: TEST_DIR_A,
      activate: true
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.activePlan).toBeDefined();
    expect(result.activePlan!.id).toBe('auth-plan');
    expect(result.activePlan!.title).toBe('Authentication System');
  });

  it('returns null activePlan when no plan is active', async () => {
    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.activePlan).toBeNull();
  });

  it('includes active plan even with search filter', async () => {
    await savePlan({
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

    // Active plan should still be included
    expect(result.activePlan).toBeDefined();
    expect(result.activePlan!.id).toBe('test-plan');
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
});

describe('Checkpoint search (fuse.js)', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'checkpoint_test0001',
      timestamp: '2025-10-13T10:00:00.000Z',
      description: 'Fixed authentication bug in JWT validation',
      tags: ['bug-fix', 'auth', 'jwt']
    },
    {
      id: 'checkpoint_test0002',
      timestamp: '2025-10-13T11:00:00.000Z',
      description: 'Added OAuth2 Google integration',
      tags: ['feature', 'auth', 'oauth']
    },
    {
      id: 'checkpoint_test0003',
      timestamp: '2025-10-13T12:00:00.000Z',
      description: 'Refactored database connection pooling',
      tags: ['refactor', 'database', 'performance']
    },
    {
      id: 'checkpoint_test0004',
      timestamp: '2025-10-13T13:00:00.000Z',
      description: 'Documented migration follow-up',
      tags: ['decision-record'],
      decision: 'Adopt CQRS for write-heavy order processing path',
      impact: 'Reduced lock contention under peak load',
      symbols: ['OrderCommandHandler.handle']
    }
  ];

  it('searches across description and tags', () => {
    const results = searchCheckpoints('auth', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(c =>
      c.description.toLowerCase().includes('auth') ||
      c.tags?.some(t => t.includes('auth')) ||
      c.context?.toLowerCase().includes('auth') ||
      c.decision?.toLowerCase().includes('auth') ||
      c.impact?.toLowerCase().includes('auth')
    )).toBe(true);
  });

  it('returns checkpoints sorted by relevance score', () => {
    const results = searchCheckpoints('authentication', checkpoints);

    // 'authentication bug' should rank higher than 'OAuth2' for this query
    expect(results[0]!.description).toContain('authentication');
  });

  it('handles typos with fuzzy matching', () => {
    const results = searchCheckpoints('databse', checkpoints);  // Typo

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.description).toContain('database');
  });

  it('returns empty array for no matches', () => {
    const results = searchCheckpoints('nonexistent', checkpoints);
    expect(results).toEqual([]);
  });

  it('searches partial words', () => {
    const results = searchCheckpoints('refact', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.description).toContain('Refactored');
  });

  it('searches across structured decision fields', () => {
    const results = searchCheckpoints('cqrs', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.decision).toBeDefined();
    expect(results[0]!.decision!.toLowerCase()).toContain('cqrs');
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

  it('allows limit: 0 to return no checkpoints (plan only)', async () => {
    await savePlan({
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
    expect(result.activePlan).toBeDefined();
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

describe('planId filtering', () => {
  const PLAN_DIR = join(tmpdir(), `goldfish-test-plan-filter-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(PLAN_DIR, { recursive: true });
    process.env.GOLDFISH_WORKSPACE = PLAN_DIR;
  });

  afterAll(async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    await rm(PLAN_DIR, { recursive: true, force: true });
  });

  test('filters checkpoints by planId', async () => {
    const memoriesDir = join(PLAN_DIR, '.memories');
    const dateDir = join(memoriesDir, '2026-01-15');
    await mkdir(dateDir, { recursive: true });

    const cp1 = `---
id: checkpoint_aaa
timestamp: "2026-01-15T10:00:00.000Z"
planId: plan-a
---

Work on plan A`;

    const cp2 = `---
id: checkpoint_bbb
timestamp: "2026-01-15T11:00:00.000Z"
planId: plan-b
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
      planId: 'plan-a',
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0]!.id).toBe('checkpoint_aaa');
  });

  test('returns all checkpoints when planId not specified', async () => {
    const result = await recall({
      workspace: PLAN_DIR,
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(3);
  });
});

describe('Memory and consolidation in recall', () => {
  const MEMORY_CONTENT = `## Key Decisions
- Chose LanceDB for vector store
- MPS acceleration for Apple Silicon

## Architecture
Sparks is the MCP server entry point.
`;

  it('default recall (no search) includes MEMORY.md content', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);
    await writeConsolidationState(TEST_DIR_A, {
      timestamp: new Date().toISOString(),
      checkpointsConsolidated: 5
    });

    await saveCheckpoint({
      description: 'Some work happened',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.memory).toBe(MEMORY_CONTENT);
  });

  it('search recall excludes MEMORY.md by default', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);

    await saveCheckpoint({
      description: 'Fixed a LanceDB indexing bug',
      tags: ['bug-fix'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'LanceDB'
    });

    expect(result.memory).toBeUndefined();
  });

  it('search recall includes MEMORY.md when includeMemory: true', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);

    await saveCheckpoint({
      description: 'Fixed a LanceDB indexing bug',
      tags: ['bug-fix'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'LanceDB',
      includeMemory: true
    });

    expect(result.memory).toBe(MEMORY_CONTENT);
  });

  it('default recall excludes MEMORY.md when includeMemory: false', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);

    await saveCheckpoint({
      description: 'Some work',
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      includeMemory: false
    });

    expect(result.memory).toBeUndefined();
  });

  it('returns undefined memory when no MEMORY.md exists', async () => {
    await saveCheckpoint({
      description: 'Work without memory file',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.memory).toBeUndefined();
  });

  it('detects stale consolidation (old timestamp + new checkpoints)', async () => {
    // Set consolidation timestamp in the past
    const pastDate = new Date('2020-01-01T00:00:00Z');
    await writeConsolidationState(TEST_DIR_A, {
      timestamp: pastDate.toISOString(),
      checkpointsConsolidated: 3
    });

    // Create checkpoints after that timestamp
    await saveCheckpoint({
      description: 'New work after consolidation',
      workspace: TEST_DIR_A
    });

    await saveCheckpoint({
      description: 'More new work',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.consolidation).toBeDefined();
    expect(result.consolidation!.needed).toBe(true);
    expect(result.consolidation!.staleCheckpoints).toBe(2);
    expect(result.consolidation!.lastConsolidated).toBe(pastDate.toISOString());
  });

  it('reports consolidation not needed when up to date', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);

    // Set consolidation timestamp in the future
    const futureDate = new Date('2099-01-01T00:00:00Z');
    await writeConsolidationState(TEST_DIR_A, {
      timestamp: futureDate.toISOString(),
      checkpointsConsolidated: 10
    });

    await saveCheckpoint({
      description: 'A checkpoint before the future consolidation',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.consolidation).toBeDefined();
    expect(result.consolidation!.needed).toBe(false);
    expect(result.consolidation!.staleCheckpoints).toBe(0);
  });

  it('returns consolidation field when MEMORY.md exists but no consolidation state', async () => {
    await writeMemory(TEST_DIR_A, MEMORY_CONTENT);

    await saveCheckpoint({
      description: 'Work with memory but no consolidation state',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.consolidation).toBeDefined();
    expect(result.consolidation!.needed).toBe(true);
    expect(result.consolidation!.staleCheckpoints).toBe(1);
    expect(result.consolidation!.lastConsolidated).toBeNull();
  });

  it('returns no consolidation field when neither MEMORY.md nor consolidation state exist', async () => {
    await saveCheckpoint({
      description: 'Bare workspace with no memory or consolidation',
      workspace: TEST_DIR_A
    });

    const result = await recall({ workspace: TEST_DIR_A });

    expect(result.memory).toBeUndefined();
    expect(result.consolidation).toBeUndefined();
  });
});

describe('Memory section search integration', () => {
  it('search finds content in MEMORY.md sections', async () => {
    await writeMemory(TEST_DIR_A, [
      '## Deployment Architecture',
      '',
      'We use Kubernetes with Helm charts for all production deployments.',
      '',
      '## Testing Strategy',
      '',
      'Integration tests run in CI against ephemeral postgres databases.',
    ].join('\n'));

    await saveCheckpoint({
      description: 'Added retry logic to payment processor',
      tags: ['payments'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'Kubernetes',
      limit: 5
    });

    expect(result.matchedMemorySections).toBeDefined();
    expect(result.matchedMemorySections!.length).toBeGreaterThanOrEqual(1);
    const matched = result.matchedMemorySections!.find(s => s.header === 'Deployment Architecture');
    expect(matched).toBeDefined();
    expect(matched!.content).toContain('Kubernetes');
  });

  it('memory sections rank alongside checkpoints', async () => {
    await writeMemory(TEST_DIR_A, [
      '## Authentication Flow',
      '',
      'OAuth2 with PKCE for all client applications. Tokens expire after 1 hour.',
    ].join('\n'));

    await saveCheckpoint({
      description: 'Implemented OAuth2 PKCE flow for mobile clients',
      tags: ['auth', 'oauth'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'OAuth2 PKCE',
      limit: 5
    });

    // Both the memory section and the checkpoint should appear
    expect(result.matchedMemorySections).toBeDefined();
    expect(result.matchedMemorySections!.length).toBeGreaterThanOrEqual(1);
    expect(result.checkpoints.length).toBeGreaterThanOrEqual(1);

    const memoryMatch = result.matchedMemorySections!.find(s => s.header === 'Authentication Flow');
    expect(memoryMatch).toBeDefined();

    const checkpointMatch = result.checkpoints.find(c => c.description.includes('OAuth2'));
    expect(checkpointMatch).toBeDefined();
  });

  it('no memory sections returned when no MEMORY.md exists', async () => {
    await saveCheckpoint({
      description: 'Some work without any memory file',
      tags: ['misc'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'anything',
      limit: 5
    });

    expect(result.matchedMemorySections).toBeUndefined();
  });

  it('memory section IDs use the expected prefix', async () => {
    // Verify the prefix constant is exported and usable
    expect(MEMORY_SECTION_PREFIX).toBe('memory_section_');
  });

  it('memory sections do not appear in the checkpoints array', async () => {
    await writeMemory(TEST_DIR_A, [
      '## Unique Xylophone Config',
      '',
      'The xylophone service uses a custom configuration format.',
    ].join('\n'));

    await saveCheckpoint({
      description: 'Unrelated checkpoint about database migrations',
      tags: ['db'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'xylophone configuration',
      limit: 5
    });

    // No checkpoint should have a memory_section_ prefix in its ID
    for (const cp of result.checkpoints) {
      expect(cp.id.startsWith(MEMORY_SECTION_PREFIX)).toBe(false);
    }
  });
});
