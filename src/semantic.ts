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

export async function buildHybridRanking(input: BuildHybridRankingInput): Promise<Checkpoint[]> {
  const lexicalRanks = new Map(input.lexicalOrder.map((checkpointId, index) => [checkpointId, index]))
  const originalIndexes = new Map(input.checkpoints.map((checkpoint, index) => [checkpoint.id, index]))
  const readyRecordsById = new Map(input.readyRecords.map(record => [record.checkpointId, record]))
  const timestamps = input.checkpoints.map(checkpoint => new Date(checkpoint.timestamp).getTime())
  const oldest = Math.min(...timestamps)
  const newest = Math.max(...timestamps)

  let queryEmbedding = input.queryEmbedding
  if (!queryEmbedding && input.readyRecords.length > 0) {
    const embeddings = await input.runtime.embedTexts([input.query])
    queryEmbedding = embeddings[0]
  }

  return [...input.checkpoints].sort((left, right) => {
    const leftLexicalIndex = lexicalRanks.get(left.id) ?? input.lexicalOrder.length
    const rightLexicalIndex = lexicalRanks.get(right.id) ?? input.lexicalOrder.length
    const leftLexical = lexicalScore(leftLexicalIndex, Math.max(input.lexicalOrder.length, 1))
    const rightLexical = lexicalScore(rightLexicalIndex, Math.max(input.lexicalOrder.length, 1))

    const leftSemantic = queryEmbedding
      ? cosineSimilarity(queryEmbedding, readyRecordsById.get(left.id)?.embedding ?? [])
      : 0
    const rightSemantic = queryEmbedding
      ? cosineSimilarity(queryEmbedding, readyRecordsById.get(right.id)?.embedding ?? [])
      : 0

    const leftScore =
      (leftLexical * 0.65) +
      (leftSemantic * 0.35) +
      lexicalMatchBoost(input.query, left, input.digests[left.id]) +
      metadataBoost(input.query, left) +
      (recencyScore(left.timestamp, oldest, newest) * 0.03)

    const rightScore =
      (rightLexical * 0.65) +
      (rightSemantic * 0.35) +
      lexicalMatchBoost(input.query, right, input.digests[right.id]) +
      metadataBoost(input.query, right) +
      (recencyScore(right.timestamp, oldest, newest) * 0.03)

    if (rightScore !== leftScore) {
      return rightScore - leftScore
    }

    if (leftLexicalIndex !== rightLexicalIndex) {
      return leftLexicalIndex - rightLexicalIndex
    }

    const leftTime = new Date(left.timestamp).getTime()
    const rightTime = new Date(right.timestamp).getTime()
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    const leftOriginalIndex = originalIndexes.get(left.id) ?? 0
    const rightOriginalIndex = originalIndexes.get(right.id) ?? 0
    if (leftOriginalIndex !== rightOriginalIndex) {
      return leftOriginalIndex - rightOriginalIndex
    }

    return left.id.localeCompare(right.id)
  })
}

export async function processPendingSemanticWork(
  input: ProcessPendingSemanticWorkInput
): Promise<ProcessPendingSemanticWorkResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const hasTimeBudget = input.maxMs !== undefined
  let processed = 0

  for (const item of input.pending) {
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

        void input.embed([item.digest], controller.signal)
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
        const embeddings = await input.embed([item.digest])
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
    const embedding = embeddings[0]

    if (!embedding) {
      throw new Error(`Missing embedding for '${item.checkpointId}'`)
    }

    await input.save(item.checkpointId, embedding)
    processed += 1

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
