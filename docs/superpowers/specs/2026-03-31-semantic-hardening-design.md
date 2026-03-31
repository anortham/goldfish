# Semantic Hardening Design

Date: 2026-03-31
Status: Draft approved for spec review

## Summary

This pass hardens Goldfish's semantic embeddings pipeline without redesigning it into a background indexing system.

The work fixes four operational problems:

1. Search can hang if query embedding never resolves.
2. Search can spend unbounded time draining the semantic backlog.
3. Derived semantic cache files can become inconsistent or malformed and poison recall.
4. Embedder cancellation is weaker than it looks, especially around cold start and queued aborts.

The chosen approach keeps the current derived-cache model and file format, but makes semantic ranking opportunistic, maintenance bounded, cache reads self-healing, and runtime cancellation stricter.

## Goals

- Ensure `recall({ search })` always returns lexical results even when semantic work hangs, times out, or fails.
- Bound semantic maintenance work performed on the search path.
- Treat the semantic cache as rebuildable derived state, not fragile source-of-truth data.
- Repair or re-queue inconsistent semantic cache state automatically.
- Tighten embedder abort behavior so queued cancellation does not create overlapping inference work.

## Non-Goals

- No background worker, daemon, or explicit indexing service.
- No checkpoint storage changes in `.memories/`.
- No large cache format migration unless recovery-in-place proves insufficient.
- No attempt to make cold model loading itself cancellable at the library level if `@huggingface/transformers` does not support it.

## Existing Problems

### 1. Query embedding can block recall forever

Recall starts lexical search and query embedding together, but ranking awaits the query embedding promise if a semantic runtime exists. If the runtime hangs instead of rejecting, lexical fallback never returns.

### 2. Search performs full semantic backlog maintenance inline

`runSearchSemanticMaintenance()` currently processes the full pending backlog. This trades one search request for potentially unbounded indexing work, which is the wrong behavior for a user-facing hot path.

### 3. Derived cache inconsistencies can strand or break results

`manifest.json` and `records.jsonl` are written separately. A crash between those writes can leave a checkpoint present in the manifest but missing from records. Current backfill logic treats manifest presence as authoritative and can skip re-queueing forever. Separately, malformed cache files can bubble parse failures into recall.

### 4. Embedder abort behavior is not strong enough

The embedder checks abort before inference and after queueing, but cold start waits on model load before abort is observed, and aborted queued requests can release the queue before the current underlying inference has truly stopped.

## Chosen Approach

### A. Semantic ranking becomes opportunistic

Recall will always produce lexical candidates first.

- Query embedding still starts in parallel.
- Query embedding is wrapped in a short timeout.
- If it resolves in budget, hybrid ranking runs.
- If it rejects, times out, or never resolves, recall returns lexical ranking.

This makes semantics an upgrade path for recall quality, not a prerequisite for returning results.

### B. Search-triggered maintenance becomes bounded work

`runSearchSemanticMaintenance()` will take explicit per-search limits.

- `maxItems` limits how many pending records can be processed in one pass.
- `maxMs` limits how long recall will spend on embedding work in one pass.
- Warm-runtime searches may do a small pre-ranking maintenance pass.
- Cold-runtime searches may do a small post-ranking warm-up pass.

This replaces the current full-backlog behavior.

The default should be conservative and user-facing, not throughput-maximizing. Semantic indexing debt should amortize across searches instead of exploding a single request.

### C. Cache recovery happens on read, not just on write

The semantic cache is derived from checkpoint markdown and memory sections, so recovery should favor correctness and availability over preservation.

Load paths will detect and repair these cases:

- malformed `manifest.json`
- malformed `records.jsonl`
- manifest entry present with no corresponding record
- record present with no manifest entry

Recovery rules:

- If parsing fails for derived files, warn, reset the corrupted derived cache under lock, and treat the cache as empty for recall purposes. The next search/backfill pass will rebuild it from source markdown.
- If a manifest entry exists without a record, drop the manifest-only entry during normalization so it cannot suppress backfill. A later backfill pass will recreate a proper pending record from checkpoint source data.
- If a record exists without a manifest entry, drop or ignore it as orphaned derived data.

The important invariant is that only a valid, consistent pending-or-ready record counts as semantic state for a checkpoint.

### D. Pruning must not race live cache operations

Prune logic should not delete a cache directory while another operation holds or is attempting to take the semantic cache lock.

Required behavior:

- prune must acquire the same semantic cache lock used by readers and writers before deciding to delete a cache directory
- if that lock cannot be acquired promptly, skip the directory
- once the lock is acquired, re-check prune eligibility and only then delete the inactive orphan cache

This keeps pruning best-effort and avoids corrupting active work.

### E. Embedder queue semantics stay serialized

The runtime should preserve one-at-a-time inference by default.

- Abort before queue entry should reject immediately.
- Abort while waiting in queue should reject without starting inference.
- Abort during cold start should reject promptly from the caller's perspective, even if underlying model load continues in the background.
- Abort during active inference should not release the queue so aggressively that multiple underlying calls can overlap.

The design goal is caller responsiveness without sacrificing serialization guarantees.

## Detailed Design

### Recall Flow

`src/recall.ts` changes:

1. Keep lexical candidate gathering exactly as the first-class path.
2. Wrap query embedding in a timeout helper backed by an `AbortController`, returning one of:
   - `{ ok: true, embedding }`
   - `{ ok: false, error }`
   - `{ ok: false, timedOut: true }`
3. On timeout, abort the underlying query-embedding request so a hung semantic call does not continue occupying the serialized embedder queue.
4. Update ranking to treat timeout exactly like any other semantic failure, meaning lexical fallback.
5. Bound search-triggered maintenance with per-search budgets.
6. If semantic cache loading fails, warn and continue with lexical-only ranking instead of failing the request.

Cross-workspace search will follow the same rules as single-workspace search.

### Semantic Cache State Rules

`src/semantic-cache.ts` changes:

1. Add a normalization/recovery step after reading manifest and records.
2. Build checkpoint state from the intersection of manifest entries and valid records, not from manifest keys alone.
3. When a manifest entry is missing its record, drop the broken manifest-only entry during normalization so backfill can re-create it from checkpoint source data.
4. When a record is missing its manifest entry, drop the orphan record.
5. When parse failures happen, treat them as derived-cache corruption, clear the broken cache state under lock, and let subsequent backfill rebuild it.

This keeps the persisted format but stops inconsistent state from becoming sticky.

### Embedder Runtime

`src/transformers-embedder.ts` changes:

1. Separate cold-start load waiting from active inference waiting.
2. Ensure callers can observe abort while waiting for initial load.
3. Keep queue release tied to actual task completion rather than eager abort release.
4. Keep queued aborted calls from starting inference at all.
5. Maintain current lazy-loading behavior and runtime model metadata.

The implementation may allow underlying model loading to finish in the background after caller abort, but the aborted call must not stay pending until that happens.

### Documentation Update

`docs/IMPLEMENTATION.md` must be updated to reflect the corrected behavior:

- semantic ranking is opportunistic
- search-triggered maintenance is bounded
- recall degrades gracefully when derived semantic state is damaged

The current text claiming a search processes the full pending backlog should be removed because it encodes the wrong trade-off.

## File-Level Changes

- `src/recall.ts`
  - timeout wrapper for query embedding
  - bounded maintenance budgets
  - lexical fallback on timeout/corruption
- `src/semantic-cache.ts`
  - state normalization and corruption handling
  - backfill eligibility based on consistent state
  - safer prune behavior around locks
- `src/transformers-embedder.ts`
  - stricter abort and queue handling
- `tests/recall.test.ts`
  - hung embedding fallback
  - bounded maintenance expectations
  - corruption tolerance
- `tests/semantic-cache.test.ts`
  - split-brain repair
  - malformed cache recovery
  - prune skips active lock
- `tests/transformers-embedder.test.ts`
  - abort during cold start
  - multiple queued aborts do not fan out
- `docs/IMPLEMENTATION.md`
  - updated semantic recall description

## Testing Strategy

This project is TDD-only. Each behavioral change starts with a failing test.

Required regression coverage:

1. Recall returns lexical results when query embedding never resolves.
2. Search maintenance obeys a bounded time/item budget.
3. Abort during embedder cold start rejects promptly.
4. Repeated queued aborts do not create concurrent underlying inference calls.
5. Malformed semantic cache files do not break recall.
6. Malformed semantic cache files are reset so later search/backfill can rebuild semantic state.
7. Manifest-only semantic state is dropped during normalization and then recreated by backfill.
8. Prune skips caches whose lock cannot be acquired.

Relevant verification commands:

- `bun test tests/transformers-embedder.test.ts`
- `bun test tests/semantic-cache.test.ts`
- `bun test tests/recall.test.ts`
- `bun test tests/semantic.test.ts tests/semantic-cache.test.ts tests/transformers-embedder.test.ts tests/ranking.test.ts tests/recall.test.ts`

## Trade-Offs

### Why not redesign the cache format now?

Because the cache is derived, rebuildable, and local. A snapshot or generation-based format would be cleaner, but it adds migration and complexity that is not needed if read-time recovery is strong.

### Why not move maintenance fully off the search path?

Because the project intentionally avoids introducing a background indexing subsystem without strong evidence. Bounded maintenance keeps the system simple while removing the worst user-facing latency problem.

### Why not require the embedder to support true cancellation of model load?

Because library support may not exist. The important user-facing behavior is that the caller is no longer blocked forever. Background completion of a lazy load is acceptable if it does not leak concurrency or hang recall.

## Acceptance Criteria

- `recall({ search })` always returns lexical results even if semantic query embedding hangs.
- Search-triggered maintenance is bounded and no longer drains the entire backlog in one request.
- Corrupted semantic cache files do not break recall.
- Corrupted semantic cache files are reset so semantic indexing can recover automatically on later backfill.
- Manifest/record inconsistencies are normalized so broken manifest-only entries cannot suppress backfill.
- Prune does not race active semantic cache writes.
- Aborted embedding requests do not cause queue fan-out.
- Tests and docs reflect the new behavior honestly.
