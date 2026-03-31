import Fuse from 'fuse.js'
import type { Checkpoint, ScoredCheckpoint, SemanticRuntime } from './types'

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

export const MINIMUM_SEARCH_RELEVANCE = 0.15

export type { ReadySemanticRecord }

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

/**
 * Search checkpoints using fuzzy matching (fuse.js)
 */
export function searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[] {
  if (!query || checkpoints.length === 0) {
    return checkpoints;
  }

  const fuse = new Fuse(checkpoints, {
    keys: [
      { name: 'description', weight: 2 },  // Description is most important
      { name: 'decision', weight: 1.5 },
      { name: 'impact', weight: 1.3 },
      { name: 'context', weight: 1.1 },
      { name: 'alternatives', weight: 0.8 },
      { name: 'evidence', weight: 0.7 },
      { name: 'symbols', weight: 0.7 },
      { name: 'unknowns', weight: 0.6 },
      { name: 'next', weight: 0.5 },
      { name: 'tags', weight: 1 },
      { name: 'git.branch', weight: 0.5 },
      { name: 'git.files', weight: 0.3 }
    ],
    threshold: 0.4,  // 0 = perfect match, 1 = match anything
    includeScore: true,
    ignoreLocation: true,  // Search anywhere in the text
    minMatchCharLength: 2
  });

  const results = fuse.search(query);

  // Return just the items (sorted by relevance via fuse.js score)
  return results.map(result => result.item);
}

function buildLexicalSearchCandidates(
  checkpoints: Checkpoint[],
  digests: Record<string, string>
): Checkpoint[] {
  return checkpoints.map(checkpoint => ({
    ...checkpoint,
    description: digests[checkpoint.id] ?? checkpoint.description
  }));
}

type QueryEmbeddingResult =
  | { ok: true; embedding?: number[] }
  | { ok: false; error: unknown };

export async function rankSearchCheckpoints(
  query: string,
  checkpoints: Checkpoint[],
  digests: Record<string, string>,
  readyRecords: ReadySemanticRecord[],
  runtime?: SemanticRuntime,
  queryEmbeddingPromiseFn?: () => Promise<QueryEmbeddingResult>
): Promise<Checkpoint[]> {
  const checkpointsById = new Map(checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
  const lexicalRanked = searchCheckpoints(
    query,
    buildLexicalSearchCandidates(checkpoints, digests)
  );
  const lexicalOrder = lexicalRanked.map(checkpoint => checkpoint.id);

  if (!runtime) {
    return lexicalRanked
      .map(checkpoint => checkpointsById.get(checkpoint.id))
      .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
  }

  const candidateIds = new Set<string>([
    ...lexicalOrder,
    ...readyRecords.map(record => record.checkpointId)
  ]);
  const candidateCheckpoints = checkpoints.filter(checkpoint => candidateIds.has(checkpoint.id));

  if (candidateCheckpoints.length === 0) {
    return [];
  }

  try {
    // Memoize the query embedding promise to prevent duplicate requests
    // if rankSearchCheckpoints is called multiple times
    let memoizedPromise: Promise<QueryEmbeddingResult> | undefined;
    const memoizedQueryEmbeddingFn = queryEmbeddingPromiseFn
      ? () => {
          if (!memoizedPromise) {
            memoizedPromise = queryEmbeddingPromiseFn();
          }
          return memoizedPromise;
        }
      : undefined;

    // Call the memoized lazy function to create/get the promise when we actually need it
    const queryEmbeddingResult = memoizedQueryEmbeddingFn ? await memoizedQueryEmbeddingFn() : undefined;
    if (queryEmbeddingResult && !queryEmbeddingResult.ok) {
      throw queryEmbeddingResult.error;
    }

    const queryEmbedding = queryEmbeddingResult?.embedding;
    if (queryEmbeddingResult && !queryEmbedding) {
      return lexicalRanked
        .map(checkpoint => checkpointsById.get(checkpoint.id))
        .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
    }

    const scored = await buildHybridRanking({
      query,
      checkpoints: candidateCheckpoints,
      lexicalOrder,
      digests,
      readyRecords,
      runtime,
      ...(queryEmbedding ? { queryEmbedding } : {})
    });

    return scored
      .filter(item => item.score >= MINIMUM_SEARCH_RELEVANCE)
      .map(item => {
        const original = checkpointsById.get(item.checkpoint.id);
        return original ?? item.checkpoint;
      });
  } catch {
    return lexicalRanked
      .map(checkpoint => checkpointsById.get(checkpoint.id))
      .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
  }
}
