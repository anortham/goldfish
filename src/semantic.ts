import type { Checkpoint, SemanticRuntime } from './types'

interface ReadySemanticRecord {
  checkpointId: string
  embedding: number[]
}

interface BuildHybridRankingInput {
  query: string
  checkpoints: Checkpoint[]
  lexicalOrder: string[]
  digests: Record<string, string>
  readyRecords: ReadySemanticRecord[]
  runtime: SemanticRuntime
  queryEmbedding?: number[]
}

export interface ScoredCheckpoint {
  checkpoint: Checkpoint
  score: number
}

export const MINIMUM_SEARCH_RELEVANCE = 0.15

interface PendingSemanticWorkItem {
  checkpointId: string
  digest: string
}

interface ProcessPendingSemanticWorkInput {
  pending: PendingSemanticWorkItem[]
  maxItems: number
  maxMs?: number
  now?: () => number
  embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>
  save: (checkpointId: string, embedding: number[]) => Promise<void>
}

interface ProcessPendingSemanticWorkResult {
  processed: number
  remaining: number
  stopped: 'exhausted' | 'max-items' | 'max-ms'
}

type TimedEmbeddingResult =
  | { status: 'ok'; embeddings: number[][] }
  | { status: 'error'; error: unknown }
  | { status: 'timeout' }

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean)
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right[index] ?? 0
    dot += leftValue * rightValue
    leftMagnitude += leftValue * leftValue
    rightMagnitude += rightValue * rightValue
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function lexicalScore(index: number, total: number): number {
  if (index < 0 || total <= 0) {
    return 0
  }

  return Math.max(0, 1 - (index / (total * 2)))
}

function recencyScore(timestamp: string, oldest: number, newest: number): number {
  const current = new Date(timestamp).getTime()
  if (!Number.isFinite(current) || newest <= oldest) {
    return 0
  }

  return (current - oldest) / (newest - oldest)
}

function lexicalMatchBoost(query: string, checkpoint: Checkpoint, digest?: string): number {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) {
    return 0
  }

  const candidates = [digest, checkpoint.description]
    .map(value => value ? normalize(value) : '')
    .filter(Boolean)

  if (candidates.some(value => value.includes(normalizedQuery))) {
    return 0.15
  }

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) {
    return 0
  }

  const bestOverlap = candidates.reduce((best, value) => {
    const valueTokens = new Set(tokenize(value))
    const overlapCount = queryTokens.filter(token => valueTokens.has(token)).length
    return Math.max(best, overlapCount / queryTokens.length)
  }, 0)

  return bestOverlap >= 0.8 ? 0.08 : 0
}

function metadataBoost(query: string, checkpoint: Checkpoint): number {
  const queryTokens = new Set(tokenize(query))
  if (queryTokens.size === 0) {
    return 0
  }

  const metadataFields: Array<string | undefined> = [
    checkpoint.planId,
    checkpoint.tags?.join(' '),
    checkpoint.symbols?.join(' '),
    checkpoint.git?.branch
  ]

  let boost = 0

  for (const field of metadataFields) {
    if (!field) {
      continue
    }

    const fieldTokens = new Set(tokenize(field))
    const shared = [...queryTokens].some(token => fieldTokens.has(token))

    if (shared) {
      boost += 0.05
    }
  }

  return Math.min(boost, 0.2)
}

export async function buildHybridRanking(input: BuildHybridRankingInput): Promise<ScoredCheckpoint[]> {
  const lexicalRanks = new Map(input.lexicalOrder.map((checkpointId, index) => [checkpointId, index]))
  const originalIndexes = new Map(input.checkpoints.map((checkpoint, index) => [checkpoint.id, index]))
  const readyRecordsById = new Map(input.readyRecords.map(record => [record.checkpointId, record]))
  let oldest = Infinity
  let newest = -Infinity
  for (const checkpoint of input.checkpoints) {
    const ts = new Date(checkpoint.timestamp).getTime()
    if (ts < oldest) oldest = ts
    if (ts > newest) newest = ts
  }

  let queryEmbedding = input.queryEmbedding
  if (!queryEmbedding && input.readyRecords.length > 0) {
    const embeddings = await input.runtime.embedTexts([input.query])
    queryEmbedding = embeddings[0]
  }

  function computeScore(checkpoint: Checkpoint): number {
    const lexicalIndex = lexicalRanks.get(checkpoint.id) ?? input.lexicalOrder.length
    const lexical = (input.lexicalOrder.length === 0 && !lexicalRanks.has(checkpoint.id))
      ? 0
      : lexicalScore(lexicalIndex, Math.max(input.lexicalOrder.length, 1))

    const semantic = queryEmbedding
      ? cosineSimilarity(queryEmbedding, readyRecordsById.get(checkpoint.id)?.embedding ?? [])
      : 0

    return (
      (lexical * 0.65) +
      (semantic * 0.35) +
      lexicalMatchBoost(input.query, checkpoint, input.digests[checkpoint.id]) +
      metadataBoost(input.query, checkpoint) +
      (recencyScore(checkpoint.timestamp, oldest, newest) * 0.03)
    )
  }

  const scored: ScoredCheckpoint[] = input.checkpoints.map(checkpoint => ({
    checkpoint,
    score: computeScore(checkpoint)
  }))

  return scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const leftLexicalIndex = lexicalRanks.get(left.checkpoint.id) ?? input.lexicalOrder.length
    const rightLexicalIndex = lexicalRanks.get(right.checkpoint.id) ?? input.lexicalOrder.length
    if (leftLexicalIndex !== rightLexicalIndex) {
      return leftLexicalIndex - rightLexicalIndex
    }

    const leftTime = new Date(left.checkpoint.timestamp).getTime()
    const rightTime = new Date(right.checkpoint.timestamp).getTime()
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    const leftOriginalIndex = originalIndexes.get(left.checkpoint.id) ?? 0
    const rightOriginalIndex = originalIndexes.get(right.checkpoint.id) ?? 0
    if (leftOriginalIndex !== rightOriginalIndex) {
      return leftOriginalIndex - rightOriginalIndex
    }

    return left.checkpoint.id.localeCompare(right.checkpoint.id)
  })
}

const EMBED_BATCH_SIZE = 8

export async function processPendingSemanticWork(
  input: ProcessPendingSemanticWorkInput
): Promise<ProcessPendingSemanticWorkResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const hasTimeBudget = input.maxMs !== undefined
  let processed = 0

  while (processed < input.pending.length) {
    if (processed >= input.maxItems) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-items'
      }
    }

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    // Build batch: up to EMBED_BATCH_SIZE items, capped by maxItems
    const batchEnd = Math.min(
      processed + EMBED_BATCH_SIZE,
      input.pending.length,
      input.maxItems
    )
    const batch = input.pending.slice(processed, batchEnd)
    const texts = batch.map(item => item.digest)

    let embeddingsResult: TimedEmbeddingResult

    if (hasTimeBudget) {
      const remainingMs = input.maxMs! - (now() - startedAt)
      if (remainingMs <= 0) {
        return {
          processed,
          remaining: input.pending.length - processed,
          stopped: 'max-ms'
        }
      }

      embeddingsResult = await new Promise<TimedEmbeddingResult>((resolve) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort()
          resolve({ status: 'timeout' })
        }, remainingMs)

        void input.embed(texts, controller.signal)
          .then(embeddings => {
            clearTimeout(timeout)
            resolve({ status: 'ok', embeddings })
          })
          .catch(error => {
            clearTimeout(timeout)
            resolve({ status: 'error', error })
          })
      })
    } else {
      try {
        const embeddings = await input.embed(texts)
        embeddingsResult = { status: 'ok', embeddings }
      } catch (error) {
        embeddingsResult = { status: 'error', error }
      }
    }

    if (embeddingsResult.status === 'timeout') {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    if (embeddingsResult.status === 'error') {
      throw embeddingsResult.error
    }

    const embeddings = embeddingsResult.embeddings

    for (let i = 0; i < batch.length; i += 1) {
      const embedding = embeddings[i]
      if (!embedding) {
        throw new Error(`Missing embedding for '${batch[i]!.checkpointId}'`)
      }

      await input.save(batch[i]!.checkpointId, embedding)
      processed += 1
    }

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }
  }

  return {
    processed,
    remaining: input.pending.length - processed,
    stopped: 'exhausted'
  }
}
