import { describe, expect, it } from 'bun:test'
import type { Checkpoint } from '../src/types'
import { searchCheckpoints } from '../src/ranking'

describe('Checkpoint search (Orama BM25)', () => {
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

  it('searches across description and tags', async () => {
    const results = await searchCheckpoints('auth', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(c =>
      c.description.toLowerCase().includes('auth') ||
      c.tags?.some(t => t.includes('auth')) ||
      c.context?.toLowerCase().includes('auth') ||
      c.decision?.toLowerCase().includes('auth') ||
      c.impact?.toLowerCase().includes('auth')
    )).toBe(true);
  });

  it('returns checkpoints sorted by relevance score', async () => {
    const results = await searchCheckpoints('authentication', checkpoints);

    // 'authentication bug' should rank higher than 'OAuth2' for this query
    expect(results[0]!.description).toContain('authentication');
  });

  it('returns empty array for no matches', async () => {
    const results = await searchCheckpoints('nonexistent', checkpoints);
    expect(results).toEqual([]);
  });

  it('searches partial words via stemming', async () => {
    const results = await searchCheckpoints('refactoring', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.description).toContain('Refactored');
  });

  it('surfaces a checkpoint by its type even when the word is absent from the body', async () => {
    // A free-text search for "incident" should reach incident-typed checkpoints
    // whose narrative never spells out the word — the type is part of the corpus.
    const typed: Checkpoint[] = [
      {
        id: 'cp_typed_incident',
        timestamp: '2025-10-13T10:00:00.000Z',
        description: 'Database connection pool exhausted during the morning spike',
        type: 'incident'
      },
      {
        id: 'cp_typed_plain',
        timestamp: '2025-10-13T11:00:00.000Z',
        description: 'Tuned the retry budget for the payment client'
      }
    ];

    const results = await searchCheckpoints('incident', typed);

    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe('cp_typed_incident');
  });

  it('searches across structured decision fields', async () => {
    const results = await searchCheckpoints('cqrs', checkpoints);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.decision).toBeDefined();
    expect(results[0]!.decision!.toLowerCase()).toContain('cqrs');
  });

  it('finds narrative description text on structured checkpoints', async () => {
    const structured: Checkpoint[] = [
      {
        id: 'cp_structured1',
        timestamp: '2025-10-13T10:00:00.000Z',
        description: 'Fixed the memory leak in the websocket handler that was causing server crashes',
        decision: 'Use Redis for session storage',
        impact: 'Improved scalability'
      }
    ]

    const results = await searchCheckpoints('websocket', structured)
    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe('cp_structured1')
  });

  it('breaks ties by timestamp, newest first', async () => {
    const tied: Checkpoint[] = [
      {
        id: 'cp_old',
        timestamp: '2025-10-13T10:00:00.000Z',
        description: 'Fixed authentication bug'
      },
      {
        id: 'cp_new',
        timestamp: '2025-10-13T12:00:00.000Z',
        description: 'Fixed authentication bug'
      }
    ]

    const results = await searchCheckpoints('authentication', tied)
    expect(results.length).toBe(2)
    expect(results[0]!.id).toBe('cp_new')
    expect(results[1]!.id).toBe('cp_old')
  });
});

describe('Multi-word search', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'checkpoint_mw000001',
      timestamp: '2026-09-01T10:00:00.000Z',
      description: 'Decided auth token storage moves to the authentication service'
    },
    {
      id: 'checkpoint_mw000002',
      timestamp: '2026-09-02T10:00:00.000Z',
      description: 'Rotated the auth token'
    },
    {
      id: 'checkpoint_mw000003',
      timestamp: '2026-09-03T10:00:00.000Z',
      description: 'Token bucket rate limiter'
    }
  ];

  it('keeps an all-words match whose query word also prefixes another word in the field', async () => {
    const results = await searchCheckpoints('auth token', checkpoints);

    expect(results.map(c => c.id).sort()).toEqual(['checkpoint_mw000001', 'checkpoint_mw000002']);
  });
});

describe('Partial-match fallback', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'checkpoint_c1902f4f',
      timestamp: '2026-09-01T10:00:00.000Z',
      description: 'Fixed JVM source identity across overloads in the extractor output'
    },
    {
      id: 'checkpoint_b0000001',
      timestamp: '2026-09-02T10:00:00.000Z',
      description: 'Mapping notes: mapping tables and mapping keys'
    },
    {
      id: 'checkpoint_b0000002',
      timestamp: '2026-09-03T10:00:00.000Z',
      description: 'Mapping source'
    }
  ];

  it('ranks a checkpoint ID match above an equal count of repeated plain words', async () => {
    const results = await searchCheckpoints('jvm source identity c1902f4f', [
      {
        id: 'checkpoint_c1902f4f',
        timestamp: '2026-09-01T10:00:00.000Z',
        description: 'Fixed JVM source handling across overloads in the extractor output for later review'
      },
      {
        id: 'checkpoint_b0000003',
        timestamp: '2026-09-02T10:00:00.000Z',
        description: 'JVM source identity: JVM source identity for JVM source'
      }
    ]);

    expect(results[0]!.id).toBe('checkpoint_c1902f4f');
  });

  it('ranks the checkpoint matching the most query words first when none match them all', async () => {
    const results = await searchCheckpoints('jvm source identity mapping c1902f4f', checkpoints);

    expect(results.map(c => c.id)).toEqual([
      'checkpoint_c1902f4f',
      'checkpoint_b0000002',
      'checkpoint_b0000001'
    ]);
  });
});

describe('Compound word and ID search', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'checkpoint_c1902f4f',
      timestamp: '2026-09-01T10:00:00.000Z',
      description: 'Mapped JVM source identity'
    },
    {
      id: 'checkpoint_6ff64812',
      timestamp: '2026-09-02T10:00:00.000Z',
      description: 'Simplified the model selection policy',
      briefId: 'agent-tier-delegation-gate-policy-feedback'
    },
    {
      id: 'checkpoint_a0000001',
      timestamp: '2026-09-03T10:00:00.000Z',
      description: 'Repinned julie-extract for the reader'
    },
    {
      id: 'checkpoint_a0000002',
      timestamp: '2026-09-04T10:00:00.000Z',
      description: 'Extract method refactor in the parser'
    },
    {
      id: 'checkpoint_a0000003',
      timestamp: '2026-09-05T10:00:00.000Z',
      description: 'Renamed get_symbol_body in the reader'
    }
  ];

  const ids = async (query: string) => (await searchCheckpoints(query, checkpoints)).map(c => c.id).sort();

  it('finds a checkpoint by the hash part of its ID', async () => {
    expect(await ids('c1902f4f')).toEqual(['checkpoint_c1902f4f']);
  });

  it('finds a checkpoint by its full ID', async () => {
    expect(await ids('checkpoint_c1902f4f')).toEqual(['checkpoint_c1902f4f']);
  });

  it('finds words inside a hyphenated brief ID', async () => {
    expect(await ids('delegation gate')).toEqual(['checkpoint_6ff64812']);
  });

  it('finds one part of a hyphenated word', async () => {
    expect(await ids('extract')).toEqual(['checkpoint_a0000001', 'checkpoint_a0000002']);
  });

  it('requires every part of a hyphenated query word', async () => {
    expect(await ids('julie-extract')).toEqual(['checkpoint_a0000001']);
  });

  it('finds one part of a snake_case identifier', async () => {
    expect(await ids('symbol body')).toEqual(['checkpoint_a0000003']);
  });
});

describe('Version number search', () => {
  const checkpoints: Checkpoint[] = [
    {
      id: 'checkpoint_v0000331',
      timestamp: '2026-09-01T10:00:00.000Z',
      description: 'Released the Qt extractor 3.3.1',
      tags: ['release']
    },
    {
      id: 'checkpoint_v0000330',
      timestamp: '2026-09-01T09:00:00.000Z',
      description: 'Bumped the extractor pin to 3.3.0 and published release notes for the 3.3.0 tag',
      tags: ['release', 'v3.3.0']
    },
    {
      id: 'checkpoint_v0002333',
      timestamp: '2026-09-02T10:00:00.000Z',
      description: 'Released 2.33.3 with parser fixes',
      tags: ['release']
    },
    {
      id: 'checkpoint_v0000031',
      timestamp: '2026-09-03T10:00:00.000Z',
      description: 'Bumped the schema to 3.1 after 3 review rounds',
      tags: ['schema']
    },
    {
      id: 'checkpoint_v0024110',
      timestamp: '2026-09-04T10:00:00.000Z',
      description: 'Repinned the julie dependency',
      tags: ['julie-2.41.1']
    },
    {
      id: 'checkpoint_v0024111',
      timestamp: '2026-09-04T11:00:00.000Z',
      description: 'Verified Julie 2.41.1 against the lockfile',
      tags: ['verify']
    },
    {
      id: 'checkpoint_v0000200',
      timestamp: '2026-09-05T10:00:00.000Z',
      description: 'Shipped the new tools surface',
      tags: ['v2.0.0']
    }
  ];

  const ids = (results: Checkpoint[]) => results.map(c => c.id);

  it('matches a dotted version as a whole, not as separate digits', async () => {
    expect(ids(await searchCheckpoints('3.3.1', checkpoints))).toEqual(['checkpoint_v0000331']);
  });

  it('matches every patch release from a major.minor query', async () => {
    const results = ids(await searchCheckpoints('3.3', checkpoints));

    expect(results.sort()).toEqual(['checkpoint_v0000330', 'checkpoint_v0000331']);
  });

  it('finds a version inside a hyphenated tag', async () => {
    expect(ids(await searchCheckpoints('2.41.1', checkpoints)).sort()).toEqual([
      'checkpoint_v0024110',
      'checkpoint_v0024111'
    ]);
  });

  it('matches a hyphenated name-version query against the name and version written apart', async () => {
    expect(ids(await searchCheckpoints('julie-2.41.1', checkpoints)).sort()).toEqual([
      'checkpoint_v0024110',
      'checkpoint_v0024111'
    ]);
  });

  it('matches a v-prefixed patch release from its major.minor prefix', async () => {
    expect(ids(await searchCheckpoints('2.0 tools', checkpoints))).toEqual(['checkpoint_v0000200']);
  });
});

describe('Search index cache', () => {
  const corpus: Checkpoint[] = [
    {
      id: 'cp_cache_a',
      timestamp: '2026-01-01T10:00:00.000Z',
      description: 'Alpha rollout of the payment retry queue',
      tags: ['payments']
    },
    {
      id: 'cp_cache_b',
      timestamp: '2026-01-02T10:00:00.000Z',
      description: 'Beta hardening of webhook signatures',
      tags: ['webhooks']
    }
  ];

  it('reuses the index for an unchanged fingerprint and rebuilds when it changes', async () => {
    const { __getSearchIndexCacheStatsForTests } = await import('../src/ranking');
    const key = { scope: '/tmp/ws-cache-test', fingerprint: 'fp-1' };

    const start = __getSearchIndexCacheStatsForTests();
    await searchCheckpoints('alpha payment', corpus, key);
    await searchCheckpoints('webhook', corpus, key);

    const afterReuse = __getSearchIndexCacheStatsForTests();
    expect(afterReuse.misses - start.misses).toBe(1);
    expect(afterReuse.hits - start.hits).toBe(1);

    const grown = [...corpus, {
      id: 'cp_cache_c',
      timestamp: '2026-01-03T10:00:00.000Z',
      description: 'Gamma release of the payment reconciliation job',
      tags: ['payments']
    }];
    const results = await searchCheckpoints('payment reconciliation', grown, {
      scope: '/tmp/ws-cache-test',
      fingerprint: 'fp-2'
    });

    expect(results[0]!.id).toBe('cp_cache_c');
    const afterRebuild = __getSearchIndexCacheStatsForTests();
    expect(afterRebuild.misses - start.misses).toBe(2);
  });

  it('never returns checkpoints outside the passed set even on a cache hit', async () => {
    const key = { scope: '/tmp/ws-cache-subset', fingerprint: 'fp-x' };
    await searchCheckpoints('payment', corpus, key);

    const subset = [corpus[1]!];
    const results = await searchCheckpoints('payment webhook', subset, key);

    expect(results.every(c => c.id === 'cp_cache_b')).toBe(true);
  });

  it('returns distinct checkpoints that share a persisted id', async () => {
    const duplicates: Checkpoint[] = [
      {
        id: 'cp_duplicate',
        timestamp: '2026-01-01T10:00:00.000Z',
        description: 'Alpha payment retry investigation'
      },
      {
        id: 'cp_duplicate',
        timestamp: '2026-01-02T10:00:00.000Z',
        description: 'Beta payment retry resolution'
      }
    ];

    const results = await searchCheckpoints('payment retry', duplicates);

    expect(results).toHaveLength(2);
    expect(results.map(checkpoint => checkpoint.id)).toEqual([
      'cp_duplicate',
      'cp_duplicate'
    ]);
    expect(results.map(checkpoint => checkpoint.description).sort()).toEqual([
      'Alpha payment retry investigation',
      'Beta payment retry resolution'
    ]);
  });

  it('finds the selected duplicate from a copied subset on a cache hit', async () => {
    const key = { scope: '/tmp/ws-cache-duplicate-subset', fingerprint: 'fp-duplicate' };
    const corpus: Checkpoint[] = [
      {
        id: 'cp_duplicate_subset',
        timestamp: '2026-01-01T10:00:00.000Z',
        description: 'needle'
      },
      {
        id: 'cp_duplicate_subset',
        timestamp: '2026-01-02T10:00:00.000Z',
        description: 'needle appears in a much longer checkpoint description with extra context'
      }
    ];

    await searchCheckpoints('needle', corpus, key);
    const selected = [{ ...corpus[1]! }];
    const results = await searchCheckpoints('needle', selected, key);

    expect(results).toEqual(selected);
  });

  it('falls back to a partial match when cached exact hits are outside the subset', async () => {
    const key = { scope: '/tmp/ws-cache-subset-fallback', fingerprint: 'fp-fallback' };
    const corpus: Checkpoint[] = [
      {
        id: 'cp_exact',
        timestamp: '2026-01-01T10:00:00.000Z',
        description: 'payment retry'
      },
      {
        id: 'cp_partial',
        timestamp: '2026-01-02T10:00:00.000Z',
        description: 'payment investigation'
      }
    ];

    await searchCheckpoints('payment retry', corpus, key);
    const selected = [{ ...corpus[1]! }];
    const results = await searchCheckpoints('payment retry', selected, key);

    expect(results).toEqual(selected);
  });

  it('preserves identical repeated checkpoints as separate results', async () => {
    const repeated: Checkpoint = {
      id: 'cp_identical',
      timestamp: '2026-01-01T10:00:00.000Z',
      description: 'Identical payment retry record'
    };

    const results = await searchCheckpoints('payment retry', [
      { ...repeated },
      { ...repeated }
    ]);

    expect(results).toHaveLength(2);
    expect(results.every(checkpoint => checkpoint.id === 'cp_identical')).toBe(true);
  });
});
