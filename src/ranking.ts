import { create, insert, search } from '@orama/orama'
import { tokenizer as oramaTokenizer } from '@orama/orama/components'
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
 * recall queries. Dotted versions ("2.41.1", "v2.0.0") index as whole tokens,
 * because the default splitter reduces them to bare digits that match
 * unrelated releases; Orama's prefix matching lets "2.0" still find "2.0.0".
 * Words joined by "-" or "_" (brief IDs, snake_case symbols, checkpoint IDs)
 * index whole and as parts, so "delegation" finds "agent-tier-delegation".
 * The checkpoint ID field has the highest boost: an ID in a query names one
 * checkpoint, so it outranks repeated plain words.
 * Boost weights mirror the previous fuse field weights so
 * the migration only changes the matching algorithm, not the field priorities.
 */
const SEARCH_SCHEMA = {
  id: 'string',
  checkpoint: 'string',
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
  checkpoint: 5.0,
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
  checkpoint: string
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

function checkpointSearchIdentity(checkpoint: Checkpoint): string {
  return Bun.hash(JSON.stringify([
    checkpoint.id,
    checkpoint.timestamp,
    checkpoint.description,
    checkpoint.workspace,
    checkpoint.type,
    checkpoint.context,
    checkpoint.decision,
    checkpoint.alternatives,
    checkpoint.impact,
    checkpoint.evidence,
    checkpoint.symbols,
    checkpoint.next,
    checkpoint.confidence,
    checkpoint.unknowns,
    checkpoint.tags,
    checkpoint.git?.branch,
    checkpoint.git?.commit,
    checkpoint.git?.files,
    checkpoint.git?.worktree,
    checkpoint.actor?.harness,
    checkpoint.actor?.model,
    checkpoint.actor?.session,
    checkpoint.actor?.user,
    checkpoint.actor?.git_user,
    checkpoint.actor?.git_email,
    checkpoint.summary,
    checkpoint.briefId,
    checkpoint.planId,
    checkpoint.filePath
  ])).toString(36)
}

function getSearchDocumentIds(checkpoints: Checkpoint[]): string[] {
  const occurrences = new Map<string, number>()
  return checkpoints.map(checkpoint => {
    const identity = checkpointSearchIdentity(checkpoint)
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return `${identity}:${occurrence}`
  })
}

function toSearchDocument(checkpoint: Checkpoint, documentId: string): SearchDocument {
  return {
    id: documentId,
    checkpoint: checkpoint.id,
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

const VERSION_PATTERN = /-?\bv?(\d+(?:\.\d+)+)\b/gi

function splitVersions(text: string): { versions: string[]; rest: string } {
  return {
    versions: [...text.matchAll(VERSION_PATTERN)].map(match => match[1]!),
    rest: text.replace(VERSION_PATTERN, ' ')
  }
}

const COMPOUND_SEPARATOR = /[-_]+/g
const COMPOUND_WORD = /\S*[-_]\S*/g

function compoundParts(text: string): string {
  return (text.match(COMPOUND_WORD) ?? []).join(' ').replace(COMPOUND_SEPARATOR, ' ')
}

function createSearchTokenizer() {
  const tokenizer = oramaTokenizer.createTokenizer({ language: 'english', stemming: true })
  const tokenizeWords = tokenizer.tokenize.bind(tokenizer)
  tokenizer.tokenize = (raw, language, prop, withCache) => {
    const { versions, rest } = splitVersions(raw)
    return [...new Set([
      ...tokenizeWords(rest, language, prop, withCache),
      ...tokenizeWords(compoundParts(rest), language, prop, withCache),
      ...versions
    ])]
  }
  return tokenizer
}

function queryTerms(query: string): string[] {
  const { versions, rest } = splitVersions(query)
  const words = rest.replace(COMPOUND_SEPARATOR, ' ').split(/\s+/).filter(word => /\w/.test(word))
  return [...new Set([...words, ...versions])]
}

async function buildIndex(checkpoints: Checkpoint[]) {
  const db = await create({
    schema: SEARCH_SCHEMA,
    components: {
      tokenizer: createSearchTokenizer()
    }
  })

  const documentIds = getSearchDocumentIds(checkpoints)
  for (let index = 0; index < checkpoints.length; index++) {
    await insert(db, toSearchDocument(checkpoints[index]!, documentIds[index]!))
  }

  return db
}

type OramaInstance = Awaited<ReturnType<typeof buildIndex>>

interface SearchIndex {
  db: OramaInstance
  documentCount: number
}

interface IndexCacheEntry extends SearchIndex {
  fingerprint: string
}

const indexCache = new Map<string, IndexCacheEntry>()
const INDEX_CACHE_MAX_SCOPES = 8

let indexCacheHits = 0
let indexCacheMisses = 0

/** Test hook: observe index reuse without depending on timing. */
export function __getSearchIndexCacheStatsForTests(): { hits: number; misses: number } {
  return { hits: indexCacheHits, misses: indexCacheMisses }
}

async function getIndex(checkpoints: Checkpoint[], cacheKey?: SearchCacheKey): Promise<SearchIndex> {
  if (!cacheKey) {
    return {
      db: await buildIndex(checkpoints),
      documentCount: checkpoints.length
    }
  }

  const cached = indexCache.get(cacheKey.scope)
  if (cached && cached.fingerprint === cacheKey.fingerprint) {
    indexCacheHits += 1
    return cached
  }

  indexCacheMisses += 1
  const index = {
    db: await buildIndex(checkpoints),
    documentCount: checkpoints.length
  }

  if (!indexCache.has(cacheKey.scope) && indexCache.size >= INDEX_CACHE_MAX_SCOPES) {
    const oldestScope = indexCache.keys().next().value
    if (oldestScope !== undefined) {
      indexCache.delete(oldestScope)
    }
  }
  indexCache.set(cacheKey.scope, { fingerprint: cacheKey.fingerprint, ...index })

  return index
}

export async function searchCheckpoints(
  query: string,
  checkpoints: Checkpoint[],
  cacheKey?: SearchCacheKey
): Promise<Checkpoint[]> {
  if (!query || checkpoints.length === 0) {
    return checkpoints
  }

  const { db, documentCount } = await getIndex(checkpoints, cacheKey)

  const checkpointsById = new Map<string, Checkpoint>()
  const documentIds = getSearchDocumentIds(checkpoints)
  for (let index = 0; index < checkpoints.length; index++) {
    checkpointsById.set(documentIds[index]!, checkpoints[index]!)
  }

  // Two-pass strategy: prefer documents that contain every query term, and
  // fall back to any-term matches when no document contains them all.
  //
  // Why: Orama stores TF as `frequency / fieldLength`, so its BM25 already
  // applies length normalization once before the formula's own b-parameter
  // length normalization runs. Net effect: in small corpora, a single rare
  // term in a short doc routinely outscores two terms split across longer
  // docs. The two-pass fallback keeps multi-term matches sharp without
  // losing partial-match recall on conversational queries where signal is
  // spread across description / decision / impact / tags.
  //
  // When no document has every term, the fallback ranks documents that match
  // more terms first, so one rare term repeated in a short document cannot
  // outrank a document that matches most of the query.
  //
  // The all-terms pass runs one search per term instead of Orama's
  // threshold=0: that mode counts matched index words, not query terms, so a
  // term that prefix-matches two words in one field ("auth" in "auth" and
  // "authentication") drops the document it matches best.
  const runSearch = async (term: string) => {
    const results = await search(db, {
      term,
      properties: '*',
      boost: SEARCH_BOOSTS,
      threshold: 1,
      limit: documentCount
    })
    return (results.hits as Array<{ id: string; score: number; document: SearchDocument }>)
      .filter(hit => checkpointsById.has(hit.document.id))
  }

  let hits = await runSearch(query)
  const terms = queryTerms(query)
  const matchedTermCounts = new Map<string, number>()
  if (terms.length > 1) {
    const termMatches = await Promise.all(
      terms.map(async term => new Set((await runSearch(term)).map(hit => hit.document.id)))
    )
    for (const hit of hits) {
      matchedTermCounts.set(
        hit.document.id,
        termMatches.filter(matches => matches.has(hit.document.id)).length
      )
    }
    const allTermHits = hits.filter(hit => matchedTermCounts.get(hit.document.id) === terms.length)
    if (allTermHits.length > 0) {
      hits = allTermHits
    }
  }

  const ranked: Checkpoint[] = []
  const seen = new Set<string>()
  const hitScores = new Map<Checkpoint, number>()
  const hitTermCounts = new Map<Checkpoint, number>()

  for (const hit of hits) {
    const checkpoint = checkpointsById.get(hit.document.id)
    if (!checkpoint || seen.has(hit.document.id)) {
      continue
    }

    seen.add(hit.document.id)
    hitScores.set(checkpoint, hit.score)
    hitTermCounts.set(checkpoint, matchedTermCounts.get(hit.document.id) ?? 0)
    ranked.push(checkpoint)
  }

  ranked.sort((a, b) => {
    const termCountDifference = (hitTermCounts.get(b) ?? 0) - (hitTermCounts.get(a) ?? 0)
    if (termCountDifference !== 0) {
      return termCountDifference
    }
    const scoreA = hitScores.get(a) ?? 0
    const scoreB = hitScores.get(b) ?? 0
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
