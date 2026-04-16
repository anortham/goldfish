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

  it('returns empty array for no matches', () => {
    const results = searchCheckpoints('nonexistent', checkpoints);
    expect(results).toEqual([]);
  });

  it('searches partial words via stemming', () => {
    const results = searchCheckpoints('refactoring', checkpoints);

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
