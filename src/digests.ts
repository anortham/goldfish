import type { Checkpoint } from './types'

export const DIGEST_VERSION = 1

const MAX_DIGEST_LENGTH = 600
const MAX_COMPACT_LENGTH = 220

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  if (maxLength <= 3) {
    return value.slice(0, maxLength)
  }

  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function extractDescriptionParts(description: string): { heading?: string; lines: string[] } {
  const lines = description
    .split('\n')
    .map(line => normalizeWhitespace(line.replace(/^#{1,6}\s+/, '')))
    .filter(Boolean)

  const headingMatch = description.match(/^#{1,6}\s+(.+)$/m)
  const heading = headingMatch?.[1] ? normalizeWhitespace(headingMatch[1]) : undefined

  if (!heading) {
    return { lines }
  }

  return { heading, lines }
}

function uniqueParts(parts: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const part of parts) {
    if (!part) {
      continue
    }

    const normalized = normalizeWhitespace(part)

    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function uniqueList(values?: string[]): string[] | undefined {
  if (!values?.length) {
    return undefined
  }

  return uniqueParts(values)
}

function joinParts(parts: string[], maxLength: number): string {
  const result: string[] = []

  for (const part of parts) {
    const candidate = result.length === 0 ? part : `${result.join(' | ')} | ${part}`

    if (candidate.length <= maxLength) {
      result.push(part)
      continue
    }

    const prefix = result.length === 0 ? '' : `${result.join(' | ')} | `
    const remaining = maxLength - prefix.length

    if (remaining > 0) {
      result.push(truncate(part, remaining))
    }

    break
  }

  return truncate(result.join(' | '), maxLength)
}

export function buildRetrievalDigest(checkpoint: Checkpoint): string {
  const { heading, lines } = extractDescriptionParts(checkpoint.description)
  const hasNarrativeStructuredContent = Boolean(
    checkpoint.context || checkpoint.decision || checkpoint.impact
  )
  const briefId = checkpoint.briefId ?? checkpoint.planId
  const structuredParts = uniqueParts([
    checkpoint.context,
    checkpoint.decision,
    checkpoint.impact,
    uniqueList(checkpoint.tags)?.join(', '),
    uniqueList(checkpoint.symbols)?.join(', '),
    briefId,
    checkpoint.git?.branch
  ])

  const parts = uniqueParts([
    heading,
    ...structuredParts,
    ...(!hasNarrativeStructuredContent ? lines : [])
  ])

  return joinParts(parts, MAX_DIGEST_LENGTH)
}

/**
 * True when `needle` appears inside `haystack` at word boundaries
 * (case-insensitive). Boundary-aware so a short tag like "api" is not
 * swallowed by an unrelated word like "Capitalize".
 */
function containsAtWordBoundary(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[a-z0-9]/i.test(ch)

  let idx = h.indexOf(n)
  while (idx !== -1) {
    if (!isWordChar(h[idx - 1]) && !isWordChar(h[idx + n.length])) {
      return true
    }
    idx = h.indexOf(n, idx + 1)
  }
  return false
}

/**
 * Drop parts fully contained in another part at word boundaries. Headings are
 * routinely a prefix of the decision text; exact-match dedup lets that
 * near-duplicate burn compact-budget chars that the distinct signal needs.
 */
function dropContainedParts(parts: string[]): string[] {
  const kept: string[] = []

  for (const part of parts) {
    if (kept.some(k => containsAtWordBoundary(k, part))) {
      continue
    }

    for (let i = kept.length - 1; i >= 0; i--) {
      if (containsAtWordBoundary(part, kept[i]!)) {
        kept.splice(i, 1)
      }
    }

    kept.push(part)
  }

  return kept
}

export function buildCompactSearchDescription(checkpoint: Checkpoint): string {
  const { heading, lines } = extractDescriptionParts(checkpoint.description)
  const hasNarrativeStructuredContent = Boolean(
    checkpoint.context || checkpoint.decision || checkpoint.impact
  )
  const briefId = checkpoint.briefId ?? checkpoint.planId

  // Composed from atomic parts rather than the pre-joined digest so
  // containment dedup can see across them.
  const parts = dropContainedParts(uniqueParts([
    checkpoint.decision,
    checkpoint.impact,
    heading,
    checkpoint.context,
    uniqueList(checkpoint.tags)?.join(', '),
    uniqueList(checkpoint.symbols)?.join(', '),
    briefId,
    checkpoint.git?.branch,
    ...(!hasNarrativeStructuredContent ? lines : [])
  ]))

  return joinParts(parts, MAX_COMPACT_LENGTH)
}
