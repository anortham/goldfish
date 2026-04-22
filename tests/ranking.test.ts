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
