# Semantic Search Efficiency Improvements

**Date:** 2026-03-13
**Status:** Draft
**Scope:** Three targeted fixes to semantic search bootstrapping, result quality, and cache hygiene

## Problem Statement

Dogfood testing revealed three issues with the semantic search system:

1. **Cold start bootstrapping is too slow.** The maintenance budget (`maxItems: 3`, `maxMs: 150`) means it takes 20+ `recall({ search })` calls to fully index a project with 60 checkpoints. Across 10 projects, each with its own MCP server instance cold-starting independently, the semantic cache takes days to warm up through normal use.

2. **No relevance floor.** Off-topic queries (e.g., "kubernetes deployment configuration" in a memory system project) return the full `limit` of results, all low-quality. Agents receive misleading context that wastes tokens and can derail reasoning.

3. **Cache directory sprawl.** 2,987 orphaned hash-named directories under `~/.goldfish/cache/semantic/` from test runs and ephemeral workspaces. No cleanup mechanism exists, and no reverse mapping from hash to workspace path.

## Context

- Semantic search only activates when `recall({ search })` is called. The default `recall()` (no search) is chronological-only and touches zero semantic infrastructure.
- Vectors are persisted in `records.jsonl` and survive server restarts. The cold start cost is about loading the embedding model (~1-2s), not recomputing embeddings.
- The existing `pending` → `ready` lifecycle in `semantic-cache.ts` already tracks which checkpoints need embedding. The tracking infrastructure is solid; only the processing throughput is wrong.

## Design

### 1. Uncapped Semantic Maintenance

**Goal:** Process the entire pending backlog in one pass when `search` is used.

**Changes:**
- Remove `SEARCH_SEMANTIC_MAINTENANCE_LIMIT` (3) and `SEARCH_SEMANTIC_MAINTENANCE_MS` (150) constants from `src/recall.ts`
- Simplify `runSearchSemanticMaintenance` to strip the per-workspace budget-tracking loop (`processed >= limit`, `elapsedMs`/`remainingMs` checks). Instead, call `processPendingSemanticWork` once per workspace with `maxItems: pending.length` and no time budget
- Modify `processPendingSemanticWork` to skip the `setTimeout` abort-controller pattern when `maxMs` is not finite. Currently, `setTimeout(fn, Infinity)` overflows to 0 in JS engines (32-bit int clamp), which would immediately abort every embedding. When `maxMs` is `Infinity`, embed directly without the timeout wrapper
- The `maxItems` check and post-embed time checks in `processPendingSemanticWork` still work correctly with large finite values, so only the `setTimeout` path needs the guard

**Rationale:** The `recall({ search })` path already pays the model load cost (~1-2s). Users invoking search expect to wait for results. A few extra seconds of one-time indexing (50 checkpoints x ~50ms each = ~2.5s) is acceptable. Subsequent searches are instant cache hits since vectors are persisted.

**Performance characteristics:**
- First search on a fresh project with N checkpoints: model load (~1-2s) + embed all pending (~50ms each) + ranking
- Subsequent searches: ranking only (model stays warm within session, vectors persist across sessions)
- New checkpoints between searches (typically 1-5): <500ms incremental processing
- Cross-workspace search (`workspace: "all"`): the uncapping applies per-workspace. Worst case: 10 projects x 60 checkpoints = ~30s on a completely cold cache. This only happens once — subsequent cross-workspace searches hit persisted vectors

### 2. Relevance Floor in Hybrid Ranking

**Goal:** Return fewer (or zero) results when nothing meaningfully matches the query.

**Changes:**
- Add constant `MINIMUM_SEARCH_RELEVANCE = 0.15` to `src/semantic.ts`
- Refactor `buildHybridRanking` to return `Array<{ checkpoint: Checkpoint, score: number }>` instead of `Checkpoint[]`
- `rankSearchCheckpoints` in `src/recall.ts` filters results below the threshold before returning `Checkpoint[]`
- No change to callers of `rankSearchCheckpoints` — they still receive `Checkpoint[]`

**Scoring formula (unchanged):**
```
score = (lexical * 0.65) + (semantic * 0.35) + lexicalMatchBoost + metadataBoost + (recency * 0.03)
```

**Threshold rationale:**
- Zero lexical + zero semantic = ~0.03 (recency only) → filtered out
- Weak keyword match only = ~0.3-0.4 → kept
- Strong semantic match only = ~0.2-0.35 → kept
- Both signals = 0.5+ → kept
- 0.15 catches the gap between "noise" and "weak but real signal"

**Edge case:** All results below threshold → empty result set returned. This is correct behavior — the agent sees no matches and knows the query didn't find anything.

**Fallback path:** When hybrid ranking fails (catch block in `rankSearchCheckpoints`), the function falls back to lexical-only results from fuse.js. The 0.15 threshold does NOT apply to this fallback — fuse.js has its own threshold (0.4) which operates on a different score scale. The relevance floor only applies to the hybrid path where both signals are available.

**Calibration note:** The 0.15 value is calibrated against the current scoring formula (65/35 split + boosts). If the weights change, this threshold should be re-evaluated.

### 3. Cache Cleanup on Server Startup

**Goal:** Prune orphaned semantic cache directories and prevent future orphans.

**3a. Store `workspacePath` in manifests**

Add a `workspacePath` field to the `SemanticManifest` interface and write it during `upsertPendingSemanticRecord` and `markSemanticRecordReady`. This provides a reverse mapping from hash-named cache dir to the project it belongs to.

```json
{
  "workspacePath": "C:\\source\\goldfish",
  "checkpoints": { ... }
}
```

Written via `withSemanticStateLock` so it's covered by the existing lock mechanism. The `SemanticManifest` interface has `workspacePath?: string` for backwards compatibility on reads, but write paths (`upsertPendingSemanticRecord`, `markSemanticRecordReady`) always populate it.

**3b. Prune on server startup**

Add a `pruneOrphanedSemanticCaches()` function called from `src/server.ts` on startup. For each directory under `~/.goldfish/cache/semantic/`:

| Condition | Action |
|-----------|--------|
| No `manifest.json` | Delete directory |
| `manifest.json` without `workspacePath` | Delete directory (pre-migration; real projects re-index in ~3-5s on next search thanks to change #1) |
| `workspacePath` path doesn't exist on disk | Delete directory |
| `workspacePath` path exists on disk | Keep |

Fire-and-forget — failures don't prevent server startup.

**3c. Cap the scan**

Process at most 500 directories per startup (oldest by mtime first). With 3,000 orphaned dirs, cleanup completes over ~6 server starts rather than blocking the first one. This prevents a long startup delay when the cache is heavily polluted.

## Files Modified

| File | Change |
|------|--------|
| `src/recall.ts` | Remove `SEARCH_SEMANTIC_MAINTENANCE_LIMIT` and `SEARCH_SEMANTIC_MAINTENANCE_MS`, simplify `runSearchSemanticMaintenance` budget tracking |
| `src/semantic.ts` | Add `MINIMUM_SEARCH_RELEVANCE`, refactor `buildHybridRanking` return type to include scores, guard `setTimeout` in `processPendingSemanticWork` against non-finite `maxMs` |
| `src/semantic-cache.ts` | Write `workspacePath` into manifests during upsert/mark-ready, add `pruneOrphanedSemanticCaches` function |
| `src/types.ts` | Update `SemanticManifest` interface to include optional `workspacePath` |
| `src/server.ts` | Call `pruneOrphanedSemanticCaches` on startup |
| `tests/semantic.test.ts` | Update `buildHybridRanking` tests for new return type, add threshold tests |
| `tests/semantic-cache.test.ts` | Add tests for `workspacePath` in manifests and pruning |
| `tests/recall.test.ts` | Update expectations for uncapped maintenance, add relevance floor tests |
| `tests/server.test.ts` | Add startup pruning test |

## What's NOT Changing

- The embedding model (all-MiniLM-L6-v2, 384 dimensions)
- The scoring formula weights (65/35 lexical/semantic split)
- The `pending` → `ready` lifecycle and record format
- The hash-based cache directory naming scheme
- The default `recall()` path (no search) — completely unaffected
- The checkpoint save path — already queues pending records eagerly
