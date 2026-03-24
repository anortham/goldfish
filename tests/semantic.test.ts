import { describe, expect, it } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { invalidateSemanticRecordsForModelVersion, loadSemanticState, markSemanticRecordReady, upsertPendingSemanticRecord } from '../src/semantic-cache'
import type { Checkpoint } from '../src/types'
import { buildHybridRanking, processPendingSemanticWork } from '../src/semantic'
import type { ScoredCheckpoint } from '../src/semantic'

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
      planId: 'semantic-recall-phase-1',
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

describe('processPendingSemanticWork', () => {
  it('stops after maxItems', async () => {
    const saved: string[] = []

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' },
        { checkpointId: 'two', digest: 'second digest' },
        { checkpointId: 'three', digest: 'third digest' }
      ],
      maxItems: 2,
      maxMs: 1_000,
      embed: async (texts: string[]) => texts.map(() => [1]),
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toEqual(['one', 'two'])
    expect(result).toEqual({ processed: 2, remaining: 1, stopped: 'max-items' })
  })

  it('stops when maxMs is exceeded according to the injected clock', async () => {
    const saved: string[] = []
    // Clock sequence: startedAt=0, loop check=4, remainingMs check=5, (embed batch 1),
    // post-batch check=12 (>=10 -> stop before batch 2)
    const nowValues = [0, 4, 5, 12, 20]

    // 10 items: batch 1 = items 0..7 (8 items), batch 2 = items 8..9 (2 items)
    const pending = Array.from({ length: 10 }, (_, i) => ({
      checkpointId: `item-${i}`,
      digest: `digest ${i}`
    }))

    const result = await processPendingSemanticWork({
      pending,
      maxItems: 20,
      maxMs: 10,
      now: () => nowValues.shift() ?? 20,
      embed: async (texts: string[]) => texts.map(() => [42]),
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    // First batch of 8 items processes, then time check triggers before second batch
    expect(saved).toHaveLength(8)
    expect(result).toEqual({ processed: 8, remaining: 2, stopped: 'max-ms' })
  })

  it('returns max-ms without saving when a single item overruns the budget', async () => {
    const saved: string[] = []
    const nowValues = [0, 0, 15]

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' }
      ],
      maxItems: 10,
      maxMs: 10,
      now: () => nowValues.shift() ?? 15,
      embed: async () => [[42]],
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toEqual([])
    expect(result).toEqual({ processed: 0, remaining: 1, stopped: 'max-ms' })
  })

  it('times out a slow embed call instead of waiting past the remaining budget', async () => {
    const saved: string[] = []

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' }
      ],
      maxItems: 10,
      maxMs: 20,
      embed: async () => {
        await new Promise(resolve => setTimeout(resolve, 60))
        return [[42]]
      },
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toEqual([])
    expect(result).toEqual({ processed: 0, remaining: 1, stopped: 'max-ms' })
  })

  it('aborts the in-flight embed when the remaining budget expires', async () => {
    let aborted = false

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' }
      ],
      maxItems: 10,
      maxMs: 20,
      embed: async (_texts: string[], signal?: AbortSignal) => {
        signal?.addEventListener('abort', () => {
          aborted = true
        })

        await new Promise(resolve => setTimeout(resolve, 60))
        return [[42]]
      },
      save: async () => {
        throw new Error('save should not run after abort')
      }
    })

    expect(aborted).toBe(true)
    expect(result).toEqual({ processed: 0, remaining: 1, stopped: 'max-ms' })
  })

  it('batches multiple items into fewer embed calls', async () => {
    const saved: string[] = []
    const embedCalls: string[][] = []

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first' },
        { checkpointId: 'two', digest: 'second' },
        { checkpointId: 'three', digest: 'third' },
        { checkpointId: 'four', digest: 'fourth' },
        { checkpointId: 'five', digest: 'fifth' },
        { checkpointId: 'six', digest: 'sixth' },
        { checkpointId: 'seven', digest: 'seventh' }
      ],
      maxItems: 10,
      embed: async (texts: string[]) => {
        embedCalls.push([...texts])
        return texts.map(() => [1])
      },
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toHaveLength(7)
    expect(result.processed).toBe(7)
    // Should use fewer embed calls than items (batching)
    expect(embedCalls.length).toBeLessThan(7)
    // Each call should have multiple texts (except possibly the last)
    expect(embedCalls[0]!.length).toBeGreaterThan(1)
  })

  it('processes all items without timeout when maxMs is undefined', async () => {
    const saved: string[] = []

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' },
        { checkpointId: 'two', digest: 'second digest' },
        { checkpointId: 'three', digest: 'third digest' }
      ],
      maxItems: 10,
      embed: async (texts: string[]) => texts.map(() => [1]),
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toEqual(['one', 'two', 'three'])
    expect(result).toEqual({ processed: 3, remaining: 0, stopped: 'exhausted' })
  })
})

describe('semantic cache invalidation', () => {
  it('clears indexed model metadata when a ready record is invalidated for a new model version', async () => {
    const workspacePath = join(tmpdir(), `semantic-cache-invalidate-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await mkdir(workspacePath, { recursive: true })

    try {
      await upsertPendingSemanticRecord(workspacePath, {
        checkpointId: 'checkpoint_model_version',
        checkpointTimestamp: '2026-03-12T10:00:00.000Z',
        digest: 'Digest',
        digestHash: 'digest-hash',
        digestVersion: 1
      })

      await markSemanticRecordReady(workspacePath, 'checkpoint_model_version', [1, 2, 3], {
        id: 'nomic-embed-text',
        version: '1.0.0'
      })

      await invalidateSemanticRecordsForModelVersion(workspacePath, {
        id: 'nomic-embed-text',
        version: '2.0.0'
      })

      const state = await loadSemanticState(workspacePath)

      expect(state.manifest.checkpoints.checkpoint_model_version).toEqual({
        checkpointTimestamp: '2026-03-12T10:00:00.000Z',
        digestHash: 'digest-hash',
        digestVersion: 1
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
