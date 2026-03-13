# Semantic Recall and Token-Budgeted Output

**Date:** 2026-03-12
**Status:** Approved

## Problem

Goldfish recall is still primarily lexical. `Fuse.js` works when the query shares words with the checkpoint, but it misses relevant memories when the same work is described with different terminology. That shows up most often in two ways:

1. The user asks for a concept using different words than the original checkpoint
2. The answer is spread across multiple checkpoints, but recall returns them as separate entries instead of one coherent thread

Goldfish also spends too many tokens during recall. Search results often include full descriptions so the agent can understand why they matched, but that transparency comes with a lot of payload. Better retrieval alone will not fix this; it can actually make token usage worse by finding more relevant long-form text.

## Goals

- Improve recall when query wording does not match checkpoint wording
- Support lightweight synthesis across related checkpoints
- Reduce default token usage for `recall()` and `recall({ search: ... })`
- Keep semantic retrieval built in by default with no extra user setup
- Preserve the current `RecallResult` shape during the first rollout
- Preserve markdown checkpoints as the source of truth
- Degrade gracefully when semantic indexing is unavailable or incomplete

## Non-Goals

- Requiring an external search service or another MCP server
- Requiring WebGPU for correct behavior
- Adding native vector database dependencies in v1
- Chunk-level indexing in v1
- Replacing checkpoint markdown with a database-backed source of truth
- Breaking the MCP `recall()` result contract in the first rollout
- Returning full checkpoint bodies by default

## Recommended Approach

Use a hybrid recall pipeline:

1. Keep `Fuse.js` for lexical precision and exact wording matches
2. Add built-in local embeddings for semantic recall using a small `Transformers.js` feature-extraction model
3. Search compact derived digests instead of full checkpoint bodies for the common path
4. Merge related hits into a compact answer with terse evidence instead of returning large raw blocks
5. Use WebGPU only as an opportunistic acceleration path; CPU/WASM remains the baseline

This keeps Goldfish easy to distribute as a Claude Code plugin while addressing the two core failures: wording mismatch and cross-checkpoint synthesis.

## Compatibility and Rollout

The first rollout must preserve the current `RecallResult` contract:

```typescript
interface RecallResult {
  checkpoints: Checkpoint[]
  activePlan?: Plan | null
  workspaces?: WorkspaceSummary[]
}
```

That means semantic ranking lands behind the existing tool result shape first. The initial implementation can change which checkpoints are returned and how compactly they are formatted, but it should not replace `checkpoints` with a brand-new answer/evidence payload.

Rollout phases:

1. **Phase 1 - Compatible retrieval upgrade**: add digest generation, semantic ranking, and more compact checkpoint formatting while keeping the existing result shape and handler sections
2. **Phase 2 - Additive compact mode**: add an explicit compact output mode or budgeted formatter path without removing the classic checkpoint view
3. **Phase 3 - Default flip if warranted**: only consider making compact output the default after tests, hooks, skills, and user workflows are updated

## Architecture

### 1. Canonical Memory vs Retrieval Digest

Each checkpoint gets two representations:

- **Canonical memory**: the full markdown checkpoint already stored under `.memories/`
- **Retrieval digest**: a compact derived text built from the most retrieval-worthy fields

The digest should be assembled from:

- the first heading in `description`, when present
- up to two high-signal description lines or bullets
- `decision`
- `impact`
- `context`
- `tags`
- `symbols`
- `planId`
- selected git context such as branch name

Digest rules:

- maximum target length: 400-600 characters
- prefer structured fields over raw markdown
- only fall back to longer `description` text when structured fields are missing
- version the digest builder so stale digests can be regenerated deterministically

The digest is the default input for both lexical and semantic ranking. This reduces index size, embedding cost, and returned tokens without relying on the current first-sentence `summary`, which is too weak to trust on its own.

### 2. Semantic Runtime

Goldfish should use a small local embedding model through `Transformers.js`.

- Default execution path: CPU/WASM
- Optional acceleration path: WebGPU when available and stable
- WebGPU is never required for correctness

This makes `webgpu + transformers.js` a useful optimization, not a dependency that can break the baseline plugin experience.

Distribution constraints:

- do not bundle model weights inside the plugin repo
- lazily fetch one pinned embedding model on first semantic search or first explicit index build
- cache the model outside the project workspace
- if the model is unavailable or the machine is offline, fall back to lexical recall without erroring the tool
- keep only one active model version by default and clean older cached versions opportunistically

The implementation plan can still choose the exact model, but it must stay within a small-model budget that preserves plugin ergonomics.

### 3. Derived Semantic Cache

Semantic data should remain rebuildable. Markdown files stay authoritative, and derived cache files should remain human-readable to preserve Goldfish's simplicity story.

Store derived search artifacts separately from the canonical checkpoint files:

```text
~/.goldfish/cache/semantic/{workspace-hash}/
  manifest.json
  records.jsonl
```

Suggested manifest contents:

- checkpoint id
- checkpoint timestamp
- digest hash
- model id / model version
- embedding dimensions
- last indexed timestamp

Each `records.jsonl` entry contains:

- checkpoint id
- digest text
- digest hash
- embedding vector as a numeric array

If a checkpoint changes, the digest format changes, or the model version changes, Goldfish marks the entry stale and re-embeds it.

This cache is an implementation detail, not part of the user-facing memory contract. It lives outside `.memories/`, remains rebuildable, and avoids introducing opaque binary index files in v1.

### 4. Query Modes

Goldfish should treat recall as two related but different jobs:

#### Session-start recall

For plain `recall()` with no search query, default to a small recency-oriented summary. This path should stay cheap and should not spend semantic compute unless needed.

#### Targeted search recall

For `recall({ search: ... })`, use hybrid retrieval:

1. Apply workspace/date/plan filters first
2. Run lexical search on digests with `Fuse.js`
3. Run semantic similarity on candidate digests
4. Merge and rerank results
5. Group related hits into work threads
6. Return a token-budgeted answer plus terse evidence

### 5. Indexing Lifecycle

Goldfish is a short-lived stdio MCP server, so v1 should not assume a background worker or daemon.

Instead, indexing is opportunistic and lock-protected:

1. On `checkpoint`, write the canonical checkpoint first
2. Record that the checkpoint's digest and embedding are pending or stale
3. On subsequent `checkpoint` or `recall` calls, process a small bounded amount of pending index work before or after serving the request
4. Use the existing file-locking helper to serialize cache writes across concurrent server invocations

This keeps the system simple:

- no always-on process
- no job queue service
- no requirement that all checkpoints are embedded before recall can function

When a queried checkpoint has no embedding yet, Goldfish still includes it in lexical ranking and schedules semantic indexing for the next maintenance window.

## Ranking Strategy

Each candidate result should combine:

- lexical score
- semantic similarity score
- recency boost
- plan affinity
- tag overlap
- symbol overlap
- branch/thread affinity when present

The goal is not pure semantic ranking. It is stable ranking that still respects exact wording, current work, and known project structure.

## Cross-Checkpoint Synthesis

Goldfish should not solve synthesis by dumping several long checkpoints into the model context and hoping for the best. Instead, it should perform lightweight deterministic synthesis over the top-ranked digests.

Related hits can be grouped using available metadata such as:

- shared `planId`
- overlapping tags
- overlapping symbols
- same or similar git branch
- close timestamps

The formatter then produces one compact thread summary per group instead of one large block per checkpoint.

Example shape:

- answer bullets that directly address the query
- evidence bullets with one-line justification per thread or checkpoint
- omitted count for additional relevant results not expanded

This solves cross-memory recall while staying token-efficient.

## Token Budget Contract

Recall should become budget-aware by default, but the rollout must stay compatible.

Decision:

- **Phase 1:** use internal budget presets inside `handleRecall()` and keep the public `RecallOptions` schema unchanged
- **Phase 2:** expose `budget?: 'tight' | 'normal' | 'wide'` publicly once the formatter behavior is stable and tests/hooks have been updated

This keeps the first semantic rollout additive instead of forcing an immediate tool-schema change.

Behavior:

- `tight`: minimal answer, 2-3 evidence bullets, aggressive truncation
- `normal`: default interactive mode, 3-5 evidence bullets
- `wide`: broader context when the user wants more detail

Default output shape for search should be:

1. Direct answer or synthesized takeaways
2. Compact evidence list with terse snippets or reasons
3. Count of omitted relevant checkpoints

Existing `full: true` remains the escape hatch for expanded detail. Raw checkpoint bodies should never be the default search payload.

In the compatible first rollout, the handler can approximate this shape by:

- keeping `## Checkpoints`
- using digest-backed compact descriptions for non-`full` search results
- capping item count and snippet length more aggressively
- reserving full bodies for `full: true`

## Formatter Rules

The budgeted formatter should enforce hard caps before returning content:

- maximum answer bullet count
- maximum evidence item count
- maximum snippet length per evidence item
- maximum total formatted output length

If output exceeds the chosen budget, trim lower-ranked evidence first and keep the direct answer intact.

## Indexing Flow

### Checkpoint save

1. Save markdown checkpoint as today
2. Build or refresh retrieval digest
3. Mark the embedding record pending or stale
4. Update semantic cache manifest

Lexical search should work immediately. Semantic recall becomes available as soon as opportunistic indexing finishes on a later maintenance pass.

### Recall search

1. Resolve filters
2. Load candidate digests
3. Run lexical ranking
4. Run semantic ranking when available for already-embedded candidates
5. Merge scores
6. Group related results
7. Format response within the selected token budget

### Maintenance bounds

To protect stdio request latency, opportunistic indexing must be explicitly bounded:

- `checkpoint`: never performs embedding work; it only writes the digest and marks pending state
- `recall()` with no `search`: performs no semantic maintenance work
- `recall({ search })`: may process pending embeddings only when the model is already initialized locally
- per `recall({ search })` call, process at most 3 pending checkpoints or 150 ms of maintenance work, whichever comes first
- if embeddings are missing for some candidates, rank them lexically for the current request and leave them pending instead of blocking the response

This keeps latency predictable and prevents repeated thrashing across short-lived server invocations.

## Failure Handling

- If the embedding model is missing, still downloading, or fails to initialize, Goldfish falls back to lexical-only recall
- If semantic cache files are missing or stale, Goldfish rebuilds incrementally without blocking the basic recall path
- If WebGPU is unavailable or unstable, Goldfish automatically uses CPU/WASM
- If semantic ranking yields low confidence, Goldfish should rely more heavily on lexical ranking and return fewer speculative hits

Semantic support must be an enhancement, not a new source of failure.

## Testing Strategy

Add tests for:

### Retrieval quality

- wording-mismatch cases where lexical search fails but semantic search succeeds
- mixed cases where exact lexical matches still outrank vague semantic matches

### Cross-checkpoint synthesis

- related checkpoints grouped into one thread summary
- unrelated checkpoints kept separate

### Token efficiency

- default search output is materially smaller than current full-description results
- budget modes change result size predictably
- `full: true` still exposes expanded detail when explicitly requested
- digest-backed search does not regress existing lexical fixtures beyond an agreed threshold

### Failure and fallback behavior

- no model available
- semantic cache missing or stale
- indexing partially complete
- WebGPU unavailable
- concurrent cache maintenance across multiple server invocations

## Implementation Notes

- Start with checkpoint-level embeddings, not chunking
- Start with brute-force cosine similarity over Goldfish-scale candidate sets; avoid HNSW or SQLite vector extensions unless measurement proves they are needed
- Treat session-start recall and targeted search as separate optimization problems
- Prefer deterministic compression and formatting before considering any heavier distillation layer

## Open Questions For Planning

- Which small embedding model gives the best quality-to-install-size tradeoff under Bun and `Transformers.js`
- How much thread grouping should rely on metadata versus purely score-based clustering
