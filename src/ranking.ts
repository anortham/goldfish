import { create, insert, search } from '@orama/orama'
import type { Checkpoint, ScoredCheckpoint, SemanticRuntime } from './types'
import { buildRetrievalDigest } from './digests'

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

  const briefId = checkpoint.briefId ?? checkpoint.planId
  const metadataFields: Array<string | undefined> = [
    briefId,
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
 * Search checkpoints using BM25 ranking (Orama).
 *
 * Builds a fresh in-memory Orama index per call. The corpora we search are
 * small (recall windows cap out in the low hundreds), and indexing is fast
 * enough that the per-call overhead is well below the user-visible threshold,
 * so we trade caching complexity for guaranteed freshness.
 *
 * The English tokenizer with stemming handles morphological variants
 * (e.g., "tuning" -> "tuned") that fuse.js silently missed on conversational
 * recall queries. Boost weights mirror the previous fuse field weights so
 * the migration only changes the matching algorithm, not the field priorities.
 */
const SEARCH_SCHEMA = {
  id: 'string',
  description: 'string',
  decision: 'string',
  impact: 'string',
  context: 'string',
  alternatives: 'string',
  evidence: 'string',
  symbols: 'string',
  unknowns: 'string',
  next: 'string',
  tags: 'string',
  branch: 'string',
  files: 'string'
} as const

const SEARCH_BOOSTS = {
  description: 2.0,
  decision: 1.5,
  impact: 1.3,
  context: 1.1,
  tags: 1.0,
  alternatives: 0.8,
  evidence: 0.7,
  symbols: 0.7,
  unknowns: 0.6,
  next: 0.5,
  branch: 0.5,
  files: 0.3
} as const

function joinList(values?: string[]): string {
  if (!values?.length) {
    return ''
  }

  return values.join(' ')
}

interface SearchDocument {
  id: string
  description: string
  decision: string
  impact: string
  context: string
  alternatives: string
  evidence: string
  symbols: string
  unknowns: string
  next: string
  tags: string
  branch: string
  files: string
}

function toSearchDocument(checkpoint: Checkpoint): SearchDocument {
  return {
    id: checkpoint.id,
    description: buildRetrievalDigest(checkpoint),
    decision: checkpoint.decision ?? '',
    impact: checkpoint.impact ?? '',
    context: checkpoint.context ?? '',
    alternatives: joinList(checkpoint.alternatives),
    evidence: joinList(checkpoint.evidence),
    symbols: joinList(checkpoint.symbols),
    unknowns: joinList(checkpoint.unknowns),
    next: checkpoint.next ?? '',
    tags: joinList(checkpoint.tags),
    branch: checkpoint.git?.branch ?? '',
    files: joinList(checkpoint.git?.files)
  }
}

export function searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[] {
  if (!query || checkpoints.length === 0) {
    return checkpoints
  }

  const db = create({
    schema: SEARCH_SCHEMA,
    components: {
      tokenizer: { language: 'english', stemming: true }
    }
  })

  const checkpointsById = new Map<string, Checkpoint>()
  for (const checkpoint of checkpoints) {
    checkpointsById.set(checkpoint.id, checkpoint)
    // No async hooks are configured, so insert returns a string synchronously.
    insert(db, toSearchDocument(checkpoint))
  }

  // Two-pass strategy: prefer documents that contain all query terms within
  // a single property (threshold=0, AND semantics), and fall back to OR
  // semantics (threshold=1) when no document hits all terms together.
  //
  // Why: Orama stores TF as `frequency / fieldLength`, so its BM25 already
  // applies length normalization once before the formula's own b-parameter
  // length normalization runs. Net effect: in small corpora, a single rare
  // term in a short doc routinely outscores two terms split across longer
  // docs. The two-pass fallback keeps multi-term matches sharp without
  // losing partial-match recall on conversational queries where signal is
  // spread across description / decision / impact / tags.
  const runSearch = (threshold: 0 | 1) =>
    search(db, {
      term: query,
      properties: '*',
      boost: SEARCH_BOOSTS,
      threshold,
      limit: checkpoints.length
    }) as { hits: Array<{ document: SearchDocument }> }

  let results = runSearch(0)
  if (results.hits.length === 0) {
    results = runSearch(1)
  }

  const ranked: Checkpoint[] = []
  const seen = new Set<string>()

  for (const hit of results.hits) {
    const checkpoint = checkpointsById.get(hit.document.id)
    if (!checkpoint || seen.has(checkpoint.id)) {
      continue
    }

    seen.add(checkpoint.id)
    ranked.push(checkpoint)
  }

  return ranked
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
