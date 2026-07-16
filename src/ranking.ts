import { create, insert, search } from '@orama/orama'
import type { Checkpoint } from './types'


/**
 * Search checkpoints using BM25 ranking (Orama).
 *
 * Index construction dominates search cost (measured ~134ms build vs ~0.8ms
 * query at 1,000 checkpoints), so callers searching a whole workspace corpus
 * pass a cache key and the built index is reused until the corpus fingerprint
 * changes. Filtered subsets pass no key and get a fresh per-call index.
 * The cache is in-memory only — markdown on disk stays the source of truth.
 *
 * The English tokenizer with stemming handles morphological variants
 * (e.g., "tuning" -> "tuned") that fuse.js silently missed on conversational
 * recall queries. Boost weights mirror the previous fuse field weights so
 * the migration only changes the matching algorithm, not the field priorities.
 */
const SEARCH_SCHEMA = {
  id: 'string',
  description: 'string',
  type: 'string',
  brief: 'string',
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
  type: 1.0,
  brief: 1.0,
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
  type: string
  brief: string
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
    description: checkpoint.description,
    type: checkpoint.type ?? '',
    brief: checkpoint.briefId ?? checkpoint.planId ?? '',
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

/**
 * Identifies a corpus revision so a built index can be reused across calls.
 * Contract: pass a key only when `checkpoints` is the complete corpus the
 * fingerprint describes — never for filtered subsets, whose hits could be
 * crowded out by index documents outside the subset.
 */
export interface SearchCacheKey {
  scope: string
  fingerprint: string
}

async function buildIndex(checkpoints: Checkpoint[]) {
  const db = await create({
    schema: SEARCH_SCHEMA,
    components: {
      tokenizer: { language: 'english', stemming: true }
    }
  })

  for (const checkpoint of checkpoints) {
    await insert(db, toSearchDocument(checkpoint))
  }

  return db
}

type OramaInstance = Awaited<ReturnType<typeof buildIndex>>

interface IndexCacheEntry {
  fingerprint: string
  db: OramaInstance
}

const indexCache = new Map<string, IndexCacheEntry>()
const INDEX_CACHE_MAX_SCOPES = 8

let indexCacheHits = 0
let indexCacheMisses = 0

/** Test hook: observe index reuse without depending on timing. */
export function __getSearchIndexCacheStatsForTests(): { hits: number; misses: number } {
  return { hits: indexCacheHits, misses: indexCacheMisses }
}

async function getIndex(checkpoints: Checkpoint[], cacheKey?: SearchCacheKey): Promise<OramaInstance> {
  if (!cacheKey) {
    return buildIndex(checkpoints)
  }

  const cached = indexCache.get(cacheKey.scope)
  if (cached && cached.fingerprint === cacheKey.fingerprint) {
    indexCacheHits += 1
    return cached.db
  }

  indexCacheMisses += 1
  const db = await buildIndex(checkpoints)

  if (!indexCache.has(cacheKey.scope) && indexCache.size >= INDEX_CACHE_MAX_SCOPES) {
    const oldestScope = indexCache.keys().next().value
    if (oldestScope !== undefined) {
      indexCache.delete(oldestScope)
    }
  }
  indexCache.set(cacheKey.scope, { fingerprint: cacheKey.fingerprint, db })

  return db
}

export async function searchCheckpoints(
  query: string,
  checkpoints: Checkpoint[],
  cacheKey?: SearchCacheKey
): Promise<Checkpoint[]> {
  if (!query || checkpoints.length === 0) {
    return checkpoints
  }

  const db = await getIndex(checkpoints, cacheKey)

  // Hits are mapped back through this set, so even a cached index holding
  // documents outside the passed checkpoints can never leak them out.
  const checkpointsById = new Map<string, Checkpoint>()
  for (const checkpoint of checkpoints) {
    checkpointsById.set(checkpoint.id, checkpoint)
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
  const runSearch = async (threshold: 0 | 1) => {
    const results = await search(db, {
      term: query,
      properties: '*',
      boost: SEARCH_BOOSTS,
      threshold,
      limit: checkpoints.length
    })
    return results.hits as Array<{ id: string; score: number; document: SearchDocument }>
  }

  let hits = await runSearch(0)
  if (hits.length === 0) {
    hits = await runSearch(1)
  }

  const ranked: Checkpoint[] = []
  const seen = new Set<string>()
  const hitScores = new Map<string, number>()

  for (const hit of hits) {
    const checkpoint = checkpointsById.get(hit.document.id)
    if (!checkpoint || seen.has(checkpoint.id)) {
      continue
    }

    seen.add(checkpoint.id)
    hitScores.set(checkpoint.id, hit.score)
    ranked.push(checkpoint)
  }

  ranked.sort((a, b) => {
    const scoreA = hitScores.get(a.id) ?? 0
    const scoreB = hitScores.get(b.id) ?? 0
    if (scoreB !== scoreA) {
      return scoreB - scoreA
    }
    const timeA = new Date(a.timestamp).getTime()
    const timeB = new Date(b.timestamp).getTime()
    if (timeB !== timeA) {
      return timeB - timeA
    }
    return a.id.localeCompare(b.id)
  })

  return ranked
}
