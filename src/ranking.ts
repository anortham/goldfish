import { create, insert, search } from '@orama/orama'
import type { Checkpoint } from './types'


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

export async function searchCheckpoints(query: string, checkpoints: Checkpoint[]): Promise<Checkpoint[]> {
  if (!query || checkpoints.length === 0) {
    return checkpoints
  }

  const db = await create({
    schema: SEARCH_SCHEMA,
    components: {
      tokenizer: { language: 'english', stemming: true }
    }
  })

  const checkpointsById = new Map<string, Checkpoint>()
  for (const checkpoint of checkpoints) {
    checkpointsById.set(checkpoint.id, checkpoint)
    await insert(db, toSearchDocument(checkpoint))
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
