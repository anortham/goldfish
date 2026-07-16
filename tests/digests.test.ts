import { describe, expect, it } from 'bun:test'
import {
  DIGEST_VERSION,
  buildCompactSearchDescription,
  buildRetrievalDigest
} from '../src/digests'
import type { Checkpoint } from '../src/types'

describe('digests', () => {
  it('exports a positive integer digest version', () => {
    expect(Number.isInteger(DIGEST_VERSION)).toBe(true)
    expect(DIGEST_VERSION).toBeGreaterThan(0)
  })

  it('prioritizes structured fields over raw markdown fallback lines', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_structured',
      timestamp: '2026-03-12T12:00:00.000Z',
      description: [
        '# Semantic retrieval rollout',
        '',
        'Decision: use embeddings for everything.',
        'Extra body detail that should not be pulled into the digest when structured fields exist.',
        'Extra body detail that should not be pulled into the digest when structured fields exist.'
      ].join('\n'),
      context: 'Recall quality dropped for short checkpoint descriptions',
      decision: 'Generate compact retrieval digests from structured memory fields',
      impact: 'Improves keyword recall without inflating checkpoint bodies',
      tags: ['semantic-recall', 'retrieval', 'retrieval'],
      symbols: ['buildRetrievalDigest', 'buildCompactSearchDescription'],
      briefId: 'semantic-recall-phase-1',
      git: {
        branch: 'feature/semantic-recall'
      }
    }

    const digest = buildRetrievalDigest(checkpoint)

    expect(digest).toContain('Semantic retrieval rollout')
    expect(digest).toContain('Recall quality dropped for short checkpoint descriptions')
    expect(digest).toContain('Generate compact retrieval digests from structured memory fields')
    expect(digest).toContain('Improves keyword recall without inflating checkpoint bodies')
    expect(digest).toContain('semantic-recall, retrieval')
    expect(digest).toContain('buildRetrievalDigest, buildCompactSearchDescription')
    expect(digest).toContain('semantic-recall-phase-1')
    expect(digest).toContain('feature/semantic-recall')
    expect(digest).not.toContain('Extra body detail that should not be pulled into the digest')
    expect(digest).not.toContain('retrieval, retrieval')
    expect(digest.length).toBeLessThanOrEqual(600)
  })

  it('falls back to normalized description lines when structured fields are absent', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_fallback',
      timestamp: '2026-03-12T12:05:00.000Z',
      description: [
        '## Digest fallback heading',
        '',
        '  Investigated   recall ranking drift across short checkpoints.  ',
        '',
        'Investigated recall ranking drift across short checkpoints.',
        'Added a compact digest string for search indexing.'
      ].join('\n')
    }

    const digest = buildRetrievalDigest(checkpoint)

    expect(digest).toContain('Digest fallback heading')
    expect(digest).toContain('Investigated recall ranking drift across short checkpoints.')
    expect(digest).toContain('Added a compact digest string for search indexing.')
    expect(digest).not.toContain('  ')
    expect(digest.match(/Investigated recall ranking drift across short checkpoints\./g)?.length).toBe(1)
    expect(digest.length).toBeLessThanOrEqual(600)
  })

  it('keeps description lines when only sparse structured metadata exists', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_sparse',
      timestamp: '2026-03-12T12:07:00.000Z',
      description: [
        '# Sparse metadata heading',
        '',
        'Implemented digest storage for checkpoint retrieval indexing.',
        'Ensured descriptive text still appears when metadata is limited to tags and branch info.'
      ].join('\n'),
      tags: ['semantic-recall'],
      briefId: 'semantic-recall-phase-1',
      git: {
        branch: 'feature/semantic-recall'
      }
    }

    const digest = buildRetrievalDigest(checkpoint)

    expect(digest).toContain('Sparse metadata heading')
    expect(digest).toContain('Implemented digest storage for checkpoint retrieval indexing.')
    expect(digest).toContain('Ensured descriptive text still appears when metadata is limited to tags and branch info.')
    expect(digest).toContain('semantic-recall')
    expect(digest).toContain('semantic-recall-phase-1')
    expect(digest).toContain('feature/semantic-recall')
  })

  it('builds a compact search description with key content under 220 chars', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_compact',
      timestamp: '2026-03-12T12:10:00.000Z',
      description: [
        '# Compact recall digest',
        '',
        'Created a retrieval digest that surfaces structured metadata before raw markdown paragraphs.',
        'This helps fuzzy search latch onto the useful words first.'
      ].join('\n'),
      decision: 'Use decision and impact text as the primary compact search snippet',
      impact: 'Search results now expose semantic recall intent in far fewer characters'
    }

    const compact = buildCompactSearchDescription(checkpoint)

    expect(compact).toContain('Use decision and impact text as the primary compact search snippet')
    expect(compact).toContain('Search results now expose semantic recall intent in far fewer characters')
    expect(compact.length).toBeLessThanOrEqual(220)
  })

  it('drops parts contained in other parts instead of repeating them', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_dedup',
      timestamp: '2026-04-01T09:00:00.000Z',
      description: [
        '## Hide stale active briefs from recall',
        '',
        'Briefs went stale and kept surfacing'
      ].join('\n'),
      context: 'Briefs went stale and kept surfacing',
      decision: 'Hide stale active briefs from recall with a non-destructive nudge; never auto-archive',
      impact: 'Stale brief suppression in recall'
    }

    const compact = buildCompactSearchDescription(checkpoint)
    const segments = compact.split(' | ')

    expect(segments.filter(s => s.startsWith('Hide stale active briefs'))).toHaveLength(1)
    expect(compact).toContain('Briefs went stale and kept surfacing')
  })

  it('keeps short parts that only match inside other words', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_boundary',
      timestamp: '2026-04-02T09:00:00.000Z',
      description: '## Capitalize output labels\n\nLabel casing was inconsistent',
      tags: ['api']
    }

    const compact = buildCompactSearchDescription(checkpoint)
    const segments = compact.split(' | ')

    expect(segments).toContain('api')
  })
})
