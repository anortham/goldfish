import { describe, expect, it } from 'bun:test'
import type { Checkpoint } from '../src/types'
import { buildHybridRanking, searchCheckpoints } from '../src/ranking'
import type { ScoredCheckpoint } from '../src/types'

describe('buildHybridRanking', () => {
  it('keeps strong lexical matches first while semantic similarity rescues wording mismatches', async () => {
    const exactLexical: Checkpoint = {
      id: 'exact-lexical',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Fixed JWT authentication timeout bug',
      tags: ['auth']
    }

    const semanticRescue: Checkpoint = {
      id: 'semantic-rescue',
      timestamp: '2026-03-11T10:00:00.000Z',
      description: 'Resolved login session expiry issue',
      tags: ['session']
    }

    const irrelevant: Checkpoint = {
      id: 'irrelevant',
      timestamp: '2026-03-12T09:00:00.000Z',
      description: 'Refactored database migration scripts',
      tags: ['database']
    }

    const ranked = await buildHybridRanking({
      query: 'login timeout problem',
      checkpoints: [exactLexical, irrelevant, semanticRescue],
      lexicalOrder: ['exact-lexical', 'irrelevant', 'semantic-rescue'],
      digests: {
        'exact-lexical': 'jwt authentication timeout bug',
        'semantic-rescue': 'login session expiry issue',
        irrelevant: 'database migration scripts'
      },
      readyRecords: [
        { checkpointId: 'exact-lexical', embedding: [0.7, 0.3] },
        { checkpointId: 'semantic-rescue', embedding: [1, 0] },
        { checkpointId: 'irrelevant', embedding: [0, 1] }
      ],
      runtime: {
        isReady: () => true,
        embedTexts: async (texts: string[]) => {
          expect(texts).toEqual(['login timeout problem'])
          return [[1, 0]]
        }
      }
    })

    expect(ranked.map(r => r.checkpoint.id)).toEqual([
      'exact-lexical',
      'semantic-rescue',
      'irrelevant'
    ])
    expect(ranked[0]!.score).toBeGreaterThan(0.15)
    expect(ranked.every(r => typeof r.score === 'number')).toBe(true)
  })

  it('applies lightweight metadata boosts for nearby candidates', async () => {
    const boosted: Checkpoint = {
      id: 'boosted',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Implemented semantic search ranking',
      briefId: 'semantic-recall-phase-1',
      tags: ['semantic', 'ranking'],
      symbols: ['buildHybridRanking'],
      git: {
        branch: 'feature/semantic-recall'
      }
    }

    const plain: Checkpoint = {
      id: 'plain',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Implemented semantic search ranking',
      tags: ['ranking']
    }

    const ranked = await buildHybridRanking({
      query: 'semantic recall buildHybridRanking feature/semantic-recall',
      checkpoints: [plain, boosted],
      lexicalOrder: ['plain', 'boosted'],
      digests: {
        boosted: 'implemented semantic search ranking',
        plain: 'implemented semantic search ranking'
      },
      readyRecords: [
        { checkpointId: 'boosted', embedding: [1, 0] },
        { checkpointId: 'plain', embedding: [1, 0] }
      ],
      runtime: {
        isReady: () => true,
        embedTexts: async () => [[1, 0]]
      }
    })

    expect(ranked.map(r => r.checkpoint.id)).toEqual(['boosted', 'plain'])
  })

  it('ignores untyped hidden thread metadata during ranking', async () => {
    const hiddenThread = {
      id: 'hidden-thread',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Implemented semantic search ranking',
      tags: ['ranking'],
      thread: 'semantic-recall-thread'
    } as Checkpoint & { thread: string }

    const plain: Checkpoint = {
      id: 'plain',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Implemented semantic search ranking',
      tags: ['ranking']
    }

    const ranked = await buildHybridRanking({
      query: 'semantic-recall-thread',
      checkpoints: [plain, hiddenThread],
      lexicalOrder: [],
      digests: {
        plain: 'implemented semantic search ranking',
        'hidden-thread': 'implemented semantic search ranking'
      },
      readyRecords: [],
      runtime: {
        isReady: () => false,
        embedTexts: async () => [[1, 0]]
      }
    })

    expect(ranked.map(r => r.checkpoint.id)).toEqual(['plain', 'hidden-thread'])
  })
})

describe('buildHybridRanking with large checkpoint count', () => {
  it('does not throw RangeError when checkpoint count exceeds call stack limit', async () => {
    const count = 200_000
    const checkpoints: Checkpoint[] = Array.from({ length: count }, (_, i) => ({
      id: `cp-${i}`,
      timestamp: new Date(1700000000000 + i * 1000).toISOString(),
      description: `checkpoint ${i}`
    }))

    // Empty lexicalOrder so only recency scoring differentiates checkpoints
    const ranked = await buildHybridRanking({
      query: 'test query',
      checkpoints,
      lexicalOrder: [],
      digests: {},
      readyRecords: [],
      runtime: {
        isReady: () => false,
        embedTexts: async () => [[1, 0]]
      }
    })

    expect(ranked).toHaveLength(count)
    // Verify recency scoring works: newest checkpoint ranks above oldest
    const newestIndex = ranked.findIndex(r => r.checkpoint.id === `cp-${count - 1}`)
    const oldestIndex = ranked.findIndex(r => r.checkpoint.id === 'cp-0')
    expect(newestIndex).toBeLessThan(oldestIndex)
  })
})

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
