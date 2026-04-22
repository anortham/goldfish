/**
 * BM25 search contract tests for v7.0.0 Orama swap.
 *
 * These tests pin the behaviors the design promises for `searchCheckpoints`:
 *   - Lexical match, stemming, multi-term scoring, field boosts, tag search,
 *     edge cases (empty query/corpus/special chars), and the regression
 *     contract on the 5 conversational queries fuse silently failed on.
 *
 * Tests targeting fuse-failure modes (the regression contract, stemming) are
 * expected to FAIL against the current fuse-backed implementation. Task 1.2
 * replaces the body of `searchCheckpoints` with an Orama BM25 implementation
 * to make them pass.
 */

import { describe, expect, it } from 'bun:test'
import type { Checkpoint } from '../src/types'
import { searchCheckpoints } from '../src/ranking'

function checkpoint(id: string, overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    id,
    timestamp: '2026-04-01T12:00:00.000Z',
    description: '',
    ...overrides
  }
}

describe('searchCheckpoints (BM25 contract)', () => {
  describe('basic lexical matching', () => {
    it('returns the matching checkpoint for a single-term query', async () => {
      const corpus = [
        checkpoint('match', { description: 'Implemented OAuth2 login flow' }),
        checkpoint('miss', { description: 'Refactored database connection pooling' })
      ]

      const results = await searchCheckpoints('oauth2', corpus)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('match')
    })

    it('returns checkpoints when the search term appears in tags', async () => {
      const corpus = [
        checkpoint('tagged', {
          description: 'Reworked retry logic for outbound webhooks',
          tags: ['resilience', 'webhooks']
        }),
        checkpoint('untagged', {
          description: 'Reworked retry logic for outbound webhooks',
          tags: ['cleanup']
        })
      ]

      const results = await searchCheckpoints('resilience', corpus)

      expect(results.length).toBeGreaterThan(0)
      expect(results.some(r => r.id === 'tagged')).toBe(true)
    })

    it('returns checkpoints when the search term appears in briefId', async () => {
      const corpus = [
        checkpoint('brief-match', {
          description: 'Updated ranking heuristics after search bug review',
          briefId: 'search-phase-1'
        }),
        checkpoint('brief-miss', {
          description: 'Updated ranking heuristics after search bug review',
          briefId: 'release-phase-1'
        })
      ]

      const results = await searchCheckpoints('search-phase-1', corpus)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('brief-match')
    })

    it('returns checkpoints when the search term appears in legacy planId', async () => {
      const corpus = [
        checkpoint('plan-match', {
          description: 'Parsed legacy checkpoint metadata during migration',
          planId: 'legacy-plan-42'
        }),
        checkpoint('plan-miss', {
          description: 'Parsed legacy checkpoint metadata during migration',
          planId: 'legacy-plan-99'
        })
      ]

      const results = await searchCheckpoints('legacy-plan-42', corpus)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('plan-match')
    })
  })

  describe('stemming', () => {
    it('matches "tuning" against a checkpoint body containing "tuned"', async () => {
      const corpus = [
        checkpoint('tuned', {
          description: 'Tuned BM25 ranker boosts after profiling recall'
        }),
        checkpoint('unrelated', {
          description: 'Documented onboarding for new contributors'
        })
      ]

      const results = await searchCheckpoints('tuning', corpus)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('tuned')
    })
  })

  describe('multi-term scoring', () => {
    it('prefers checkpoints containing both query terms over checkpoints containing only one', async () => {
      const both = checkpoint('both', {
        description: 'Wrote brief migration guide for the new sprint format'
      })
      const briefOnly = checkpoint('brief-only', {
        description: 'Saved a brief about the upcoming release window'
      })
      const migrationOnly = checkpoint('migration-only', {
        description: 'Ran the database migration on staging without downtime'
      })

      const results = await searchCheckpoints('brief migration', [briefOnly, migrationOnly, both])

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('both')
    })
  })

  describe('field boosts', () => {
    it('ranks a description match above the same term appearing only in git.files', async () => {
      const inDescription = checkpoint('in-description', {
        description: 'Reworked the orama wrapper for ranking',
        git: { files: ['src/unrelated.ts'] }
      })
      const inFilesOnly = checkpoint('in-files', {
        description: 'Tweaked release notes copy',
        git: { files: ['src/orama.ts'] }
      })

      const results = await searchCheckpoints('orama', [inFilesOnly, inDescription])

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.id).toBe('in-description')
    })
  })

  describe('edge cases', () => {
    it('returns the input array unchanged for an empty query', async () => {
      const corpus = [
        checkpoint('a', { description: 'First checkpoint' }),
        checkpoint('b', { description: 'Second checkpoint' })
      ]

      const results = await searchCheckpoints('', corpus)

      expect(results).toEqual(corpus)
    })

    it('returns an empty array for an empty corpus', async () => {
      const results = await searchCheckpoints('anything goes here', [])

      expect(results).toEqual([])
    })

    it('does not crash when the query contains special characters', async () => {
      const corpus = [
        checkpoint('a', { description: 'Refactored helper function called foo' }),
        checkpoint('b', { description: 'Unrelated note about deployments' })
      ]

      const r1 = await searchCheckpoints('foo()', corpus)
      const r2 = await searchCheckpoints('what?!', corpus)
      const r3 = await searchCheckpoints('a/b\\c', corpus)

      expect(r1).toBeDefined()
      expect(r2).toBeDefined()
      expect(r3).toBeDefined()
    })
  })

  describe('regression contract (queries fuse silently failed on)', () => {
    // These checkpoints reproduce the structural pattern that made fuse fail
    // on the real corpus: conversational query phrasing whose individual
    // tokens map to morphological variants or near-synonyms in the body, with
    // signal spread across multiple fields rather than concentrated in one.
    // BM25 with English stemming surfaces them; fuse.js with its
    // edit-distance threshold silently returns zero.
    const corpus: Checkpoint[] = [
      checkpoint('hook-loop', {
        description:
          'Tightened the SessionStart guard so it stops re-entering itself and burning context on every prompt.',
        tags: ['safety'],
        impact: 'Cut runaway looping during prompt cascades.',
        context: 'Hooks were re-triggering each other and inflating token usage.'
      }),
      checkpoint('fuse-alternative', {
        description:
          'Surveyed replacement engines for the existing fuzzy matcher after recall returned nothing on natural-language phrases.',
        tags: ['evaluation'],
        decision: 'Adopt Orama BM25 as the single primitive.',
        alternatives: ['MiniSearch', 'Lunr', 'Stay on fuse and tune thresholds']
      }),
      checkpoint('embedding-download', {
        description:
          'Pulled the local transformer weights from HuggingFace and cached them under the goldfish models directory.',
        tags: ['setup'],
        evidence: ['First cold pull took roughly 30 seconds on a warm network.'],
        next: 'Verify the embedder boots without re-downloading.'
      }),
      checkpoint('semantic-broken', {
        description:
          'Diagnosed why hybrid retrieval stopped returning results after the embedder runtime failed to initialize on cold starts.',
        tags: ['regression'],
        unknowns: ['Whether the failure reproduces deterministically.'],
        impact: 'Recall fell back to fuzzy-only with no warning to the user.'
      }),
      checkpoint('memory-stale', {
        description:
          'Caught the consolidated YAML drifting behind recent checkpoints because the consolidation cursor had stopped advancing.',
        tags: ['drift'],
        next: 'Re-run consolidation and confirm the file refreshes.',
        evidence: ['Cursor pointed at a checkpoint from three sessions ago.']
      }),
      // Distractors so passing results are not vacuous.
      checkpoint('distractor-1', {
        description: 'Cleaned up README badges and reformatted the contributor list.',
        tags: ['docs']
      }),
      checkpoint('distractor-2', {
        description: 'Bumped TypeScript to 5.7 and fixed downstream type errors.',
        tags: ['deps', 'typescript']
      })
    ]

    const queries: Array<{ query: string; expectedId: string }> = [
      { query: 'hook loop token burn', expectedId: 'hook-loop' },
      { query: 'fuse alternative search engine', expectedId: 'fuse-alternative' },
      { query: 'embedding model download', expectedId: 'embedding-download' },
      { query: 'semantic recall broken', expectedId: 'semantic-broken' },
      { query: 'memory.yaml stale', expectedId: 'memory-stale' }
    ]

    for (const { query, expectedId } of queries) {
      it(`returns at least one result for "${query}" and surfaces the relevant checkpoint`, async () => {
        const results = await searchCheckpoints(query, corpus)

        expect(results.length).toBeGreaterThan(0)
        expect(results.some(r => r.id === expectedId)).toBe(true)
      })
    }
  })
})
