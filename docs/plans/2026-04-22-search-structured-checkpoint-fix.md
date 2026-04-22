# Fix: Structured Checkpoint Search Blind Spot and Async Fragility

## Context

In `v7.0.2` I reviewed the Orama BM25 search layer and found three issues:

1. **Search blind spot on structured checkpoints:** `buildRetrievalDigest` drops narrative description lines when a checkpoint has `context`, `decision`, or `impact`. Since `toSearchDocument` feeds the digest into the `description` search field, words that only appear in the description body become invisible to search. Confirmed via a reproduction: a checkpoint with `description: '...websocket handler...'` and `decision: '...'` returned 0 results for 'websocket'.
2. **Orama operations treated as sync:** `create`, `insert`, and `search` are typed as returning `T | Promise<T>`. The code in `src/ranking.ts` treats them as strictly synchronous, with a comment claiming "no async hooks" as justification. This is a fragility time bomb; a future Orama change or plugin addition could silently break search.
3. **No tie-breaker on equal scores:** `searchCheckpoints` returns results in raw Orama order. For small corpora and short queries, many documents share near-identical BM25 scores, producing non-deterministic ordering.

## Design

### 1. Keep description text searchable

In `src/digests.ts`, `buildRetrievalDigest` currently gates `lines` (the normalized description body) behind `!hasNarrativeStructuredContent`. Change this so lines are always included:

```typescript
const parts = uniqueParts([
  heading,
  ...structuredParts,
  ...lines  // always include narrative body
])
```

This is the minimal fix. It preserves the deduplication logic (`uniqueParts`) so there is no penalty for overlapping heading text, and the max length cap (`MAX_DIGEST_LENGTH`) still applies.

### 2. Treat Orama as async-capable

In `src/ranking.ts`, make `searchCheckpoints` `async` and await all Orama calls:

```typescript
const db = await create({ ... })
await insert(db, doc)
const results = await search(db, { ... })
```

This matches Orama's public types and eliminates the runtime cast (`as { hits: ... }`).

Call sites in `src/recall.ts` must also await the now-async `searchCheckpoints`.

### 3. Add deterministic tie-breaker

After Orama returns hits, sort the final results by:
1. Score descending (Orama's primary sort)
2. Timestamp descending (newest first)
3. ID ascending (stable deterministic fallback)

This ordering is applied before the `limit` slice in callers, so it is consistent across single-workspace and cross-workspace recall.

## Files to modify

- `src/digests.ts` — remove the `hasNarrativeStructuredContent` gate in `buildRetrievalDigest`
- `src/ranking.ts` — make `searchCheckpoints` async, await Orama, add score/timestamp/id sort
- `src/recall.ts` — await `searchCheckpoints` at its two call sites

## Tests to add

- `tests/ranking.test.ts`:
  - Structured checkpoint with narrative description matches on description-only words
  - Tie-breaking: equal-score documents ordered newest-first
- `tests/recall.test.ts`:
  - Cross-workspace search still works after async change (existing test with slight update)

## Acceptance criteria

- [ ] A checkpoint with both description text and structured fields matches searches for words that only appear in the description
- [ ] Existing decision/impact search still works
- [ ] Search is deterministic when relevance scores tie
- [ ] `searchCheckpoints` is async and awaited by all callers
- [ ] All existing tests pass
- [ ] New tests fail before fix, pass after fix
