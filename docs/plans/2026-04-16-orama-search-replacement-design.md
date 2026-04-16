# Orama search replacement design

## Goal

Replace fuse.js plus the local-embedding semantic stack with Orama BM25 as the single search primitive for goldfish recall.

## Why

The empirical comparison on 94 real checkpoints showed fuse.js silently returning zero results on natural-language queries that should match (e.g. "hook loop token burn", "embedding model download", "memory.yaml stale"). Orama's BM25 with stemming returned relevant hits on every query. Most of the perceived "embeddings improved quality" effect was actually the BM25 layer that comes free with the embedding rerank, not the embeddings themselves.

Replacing both with Orama gives:

- Better lexical relevance than fuse.js (stemming, TF-IDF, multi-term scoring)
- One search library instead of four modules (`ranking.ts`, `semantic.ts`, `semantic-cache.ts`, `transformers-embedder.ts`)
- No 90MB MiniLM model download, no first-search cold-start penalty, no background semantic maintenance
- Drops the `@huggingface/transformers` dependency
- Cuts ~1,700 lines of source plus ~4,000 lines of tests
- Keeps the door open: Orama supports vector indices, so opt-in API-based embeddings can come back later without a second migration

This is one piece of the broader v7.0.0 subtract sprint discussed in conversation. Hooks removal, consolidation removal, plan tool retirement, and documentation cleanup are separate efforts.

## Scope

### In

- Add `@orama/orama` runtime dependency
- Replace `searchCheckpoints` in `src/ranking.ts` with an Orama-backed implementation
- Delete `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`
- Simplify `src/recall.ts`: remove all hybrid ranking, semantic maintenance, query embedding plumbing
- Simplify `src/ranking.ts`: drop `rankSearchCheckpoints`, `buildHybridRanking`, `ReadySemanticRecord`, lexical-candidate-rebuilding logic
- Drop `_semanticRuntime` from `RecallOptions` and the `SemanticRuntime`/`SemanticModelInfo` types
- Remove `@huggingface/transformers` from `package.json`
- Remove semantic cache directory plumbing from `src/workspace.ts`: `getSemanticCacheDir` and `getModelCacheDir`
- Rename `getSemanticWorkspaceKey` to `getWorkspaceHashKey` (it's a generic SHA-256 path hasher, also used by `getConsolidationStatePath`; the "semantic" naming is incidental and confuses the deletion boundary)
- Remove `pruneOrphanedSemanticCaches` call from `src/server.ts`
- Delete `tests/semantic.test.ts`, `tests/semantic-cache.test.ts`, `tests/transformers-embedder.test.ts`
- Rewrite the search portions of `tests/ranking.test.ts` and `tests/recall.test.ts` to cover BM25 behavior
- Drop semantic-related env vars from documentation: `IMPLEMENTATION.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`
- One-shot cleanup: on first run after upgrade, delete any leftover `~/.goldfish/cache/semantic/` and `~/.goldfish/models/transformers/` directories

### Out

- Hook removal (separate effort)
- Consolidation removal (separate effort)
- Plan tool retirement (separate effort)
- Old docs cleanup (separate effort)
- Handoff layer build (separate effort)
- Adding API-based embeddings (deferred until evidence shows BM25 alone is insufficient)
- Changing the recall response shape, brief flow, checkpoint shape, or any tool surface

## Design

### Indexing

Build the Orama index per recall call, once per workspace. The index is rebuilt every time recall runs because:

- Goldfish loads checkpoints fresh per call already (no in-memory cache today)
- 94 checkpoints index in single-digit milliseconds with Orama
- A persistent index would require cache invalidation logic that's worse than rebuilding
- This matches the current fuse pattern (built per call inside `searchCheckpoints`)

If indexing latency becomes a problem at >1,000 checkpoints in a single workspace, revisit by caching the Orama instance keyed on the checkpoint id list.

### Schema

```ts
{
  id: 'string',
  description: 'string',
  decision: 'string',
  impact: 'string',
  context: 'string',
  alternatives: 'string',  // joined from string[]
  evidence: 'string',
  symbols: 'string',
  unknowns: 'string',
  next: 'string',
  tags: 'string',
  branch: 'string',
  files: 'string'
}
```

Use the english tokenizer with stemming. Boosts mirror the current fuse weights so ranking behavior changes are isolated to BM25-vs-fuzzy-distance, not field weighting:

| Field | Boost |
|-------|-------|
| description | 2.0 |
| decision | 1.5 |
| impact | 1.3 |
| context | 1.1 |
| tags | 1.0 |
| alternatives | 0.8 |
| evidence | 0.7 |
| symbols | 0.7 |
| unknowns | 0.6 |
| next | 0.5 |
| branch | 0.5 |
| files | 0.3 |

### Indexed body

Use `buildRetrievalDigest(checkpoint)` for the description field, matching what the current hybrid path does (`buildLexicalSearchCandidates`). This preserves the existing "compact, search-optimized" body that includes heading + structured fields + tags + symbols + brief id + branch.

### Recall flow after change

```
recall({ search }) →
  loadCheckpoints(workspace, dateWindow)
  →  buildOramaIndex(checkpoints)
  →  search(orama, query, boosts)
  →  filter to result limit
  →  format response
```

No hybrid step, no embedding step, no maintenance step, no fallback step.

### Migration of existing semantic cache

On server startup (in `createServer`), best-effort delete:

- `~/.goldfish/cache/semantic/` (entire directory)
- `~/.goldfish/models/transformers/` (entire directory)

Wrapped in try/catch so any failure is silent. After the first start on a clean machine, the cleanup is a no-op. The cleanup code stays in v7.0.0 only and is removed in v7.1.0.

### Version bump

`package.json`, `.claude-plugin/plugin.json`, `src/server.ts` all to `7.0.0`. This is a major bump because the embedder runtime is removed and the dependency footprint changes substantively. Existing checkpoint files, brief files, and `memory.yaml` are unaffected.

## Test strategy

TDD per project rules. Write the test first, watch it fail, implement, watch it pass.

### New tests

`tests/search.test.ts` (or fold into `tests/ranking.test.ts`) covering:

- Single-term lexical match returns the expected checkpoint
- Stemming: query "tuning" matches a checkpoint containing "tuned"
- Multi-term query: "brief migration" prefers checkpoints containing both terms
- Field boosts: a match in `description` outranks the same term in `files`
- Tags are searchable
- Empty query returns input unchanged
- Empty corpus returns empty
- Special characters in query are tolerated (no crash)
- BM25 returns at least one result on each of the 5 queries that fuse returned zero on (the regression contract)

### Tests deleted

- `tests/semantic.test.ts`
- `tests/semantic-cache.test.ts`
- `tests/transformers-embedder.test.ts`
- All `_semanticRuntime`-aware paths in `tests/recall.test.ts`
- All hybrid-ranking tests in `tests/ranking.test.ts`

### Tests rewritten

- `tests/ranking.test.ts`: keep `groupByDate`, `aggregateRecallResults`-style helpers if they exist; replace search tests with Orama equivalents
- `tests/recall.test.ts`: remove semantic plumbing tests, keep date-window/limit/workspace-scope/registry/cross-workspace tests, update search tests to assert on Orama-driven results

### Quality bar

Test coverage stays at the project standard. Banned patterns (tautological tests, smoke-only tests, mocked-everything tests) still apply. Hits to verify:

- Both happy and edge cases for the new search implementation
- Field boosts asserted with concrete expected ordering
- Migration cleanup tested with a fixture directory

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Orama major version churn (3.x is current) | Pin minor version; plan API-shape audit at every upgrade |
| BM25 ranks differently than fuse on queries we'd previously tuned | The comparison harness showed convergence on unambiguous queries; differences appear on queries fuse failed entirely. Risk is one-sided positive. |
| Stemming surprises (e.g. "consolidation" stems differently than expected) | Test concrete stemming behavior; if Orama's English stemmer is wrong for our domain, evaluate `'simple'` tokenizer or custom |
| Indexing cost at scale | Benchmark at 1k and 10k checkpoints; cache the Orama instance keyed on checkpoint id list if needed |
| Removing semantic breaks downstream consumers | None known; semantic surface was internal only |

## Acceptance criteria

- [ ] `bun test` passes with the rewritten suite
- [ ] `bun run typecheck` passes (this is currently broken on main; fix the existing test typecheck errors as part of this work since we're touching the same files)
- [ ] `package.json` no longer depends on `@huggingface/transformers`; `@orama/orama` added
- [ ] `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts` deleted
- [ ] `src/recall.ts` has no remaining references to semantic, embedding, hybrid, runtime, or maintenance
- [ ] `src/ranking.ts` exports a single `searchCheckpoints(query, checkpoints)` function backed by Orama
- [ ] `RecallOptions._semanticRuntime` removed from `src/types.ts`
- [ ] Server startup deletes `~/.goldfish/cache/semantic/` and `~/.goldfish/models/transformers/` if present
- [ ] `getSemanticWorkspaceKey` renamed to `getWorkspaceHashKey`; `getConsolidationStatePath` updated to call the renamed function
- [ ] Version bumped to `7.0.0` in all three places
- [ ] `README.md` no longer mentions semantic recall, MiniLM, or `@huggingface/transformers`
- [ ] `CLAUDE.md` and `AGENTS.md` updated to remove semantic module references
- [ ] `docs/IMPLEMENTATION.md` updated to reflect the new search architecture
- [ ] On the 12-query comparison set, the new implementation returns at least one result for every query (regression test)
- [ ] No breaking change to checkpoint markdown files, brief files, or `memory.yaml` shape

## Files touched (estimate)

Modified: `package.json`, `.claude-plugin/plugin.json`, `src/server.ts`, `src/recall.ts`, `src/ranking.ts`, `src/workspace.ts`, `src/types.ts`, `tests/ranking.test.ts`, `tests/recall.test.ts`, `tests/server.test.ts`, `tests/workspace.test.ts`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`

Deleted: `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`, `tests/semantic.test.ts`, `tests/semantic-cache.test.ts`, `tests/transformers-embedder.test.ts`

Net change: roughly minus 1,700 source lines, minus 4,000 test lines, plus 100-200 source lines for the Orama wrapper, plus 300-500 test lines for new BM25 coverage.
