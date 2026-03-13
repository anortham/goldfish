import { describe, expect, it } from 'bun:test'
import { mkdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { invalidateSemanticRecordsForModelVersion, loadSemanticState, markSemanticRecordReady, upsertPendingSemanticRecord } from '../src/semantic-cache'
import type { Checkpoint } from '../src/types'
import { buildHybridRanking, processPendingSemanticWork } from '../src/semantic'

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

    expect(ranked.map((checkpoint: Checkpoint) => checkpoint.id)).toEqual([
      'exact-lexical',
      'semantic-rescue',
      'irrelevant'
    ])
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

    expect(ranked.map((checkpoint: Checkpoint) => checkpoint.id)).toEqual(['boosted', 'plain'])
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

    expect(ranked.map((checkpoint: Checkpoint) => checkpoint.id)).toEqual(['plain', 'hidden-thread'])
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
    const nowValues = [0, 4, 9, 12, 20]

    const result = await processPendingSemanticWork({
      pending: [
        { checkpointId: 'one', digest: 'first digest' },
        { checkpointId: 'two', digest: 'second digest' },
        { checkpointId: 'three', digest: 'third digest' }
      ],
      maxItems: 10,
      maxMs: 10,
      now: () => nowValues.shift() ?? 20,
      embed: async (texts: string[]) => texts.map(() => [42]),
      save: async (checkpointId: string) => {
        saved.push(checkpointId)
      }
    })

    expect(saved).toEqual(['one'])
    expect(result).toEqual({ processed: 1, remaining: 2, stopped: 'max-ms' })
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
