# Phase 1: Strip & Stabilize

**Goal:** Remove all embedding/distill/store code, drop heavyweight deps, get to green.

**Risk:** Low — purely deleting code and deps. The remaining tests should all pass since they don't depend on any of the removed code.

## Files to Delete

### Source files
- `src/embeddings.ts` (624 lines) — vector search engine
- `src/distill.ts` (283 lines) — LLM subprocess spawning
- `src/cli-utils.ts` (61 lines) — CLI detection for distill
- `src/database/embeddings.ts` — SQLite embedding DB
- `src/database/index.ts` — database module exports
- `src/sync/engine.ts` (249 lines) — embedding sync engine
- `src/sync/index.ts` — sync module exports
- `src/storage/hash.ts` (95 lines) — BLAKE3 hashing for dedup
- `src/storage/jsonl.ts` (284 lines) — JSONL I/O for store tool
- `src/storage/workspace.ts` (213 lines) — WorkspaceMemoryStorage class
- `src/storage/types.ts` (105 lines) — Memory types for store tool
- `src/storage/index.ts` — storage module exports
- `src/handlers/store.ts` (127 lines) — store tool handler
- `scripts/migrate-embeddings.ts` — migration script
- `bin/` directory — julie-semantic platform binaries

### Test files
- `tests/embeddings.test.ts`
- `tests/semantic-recall.test.ts`
- `tests/distill.test.ts`
- `tests/distill-recall.test.ts`
- `tests/hash.test.ts`
- `tests/migrate-embeddings.test.ts`
- `tests/migrate-to-memories.test.ts`
- `tests/integration-phase2.test.ts`
- `tests/store-handler.test.ts`
- `tests/cli-utils.test.ts`

### Other
- `.claude/commands/` — will be replaced by plugin skills in Phase 4

## Dependencies to Remove from package.json

- `hnswlib-node`
- `@xenova/transformers`
- `onnxruntime-node`
- `sqlite-vec`
- `@napi-rs/blake-hash`

## Dependencies to Update

- `@modelcontextprotocol/sdk` — 1.20.0 → ^1.26.0
- `yaml` — 2.8.1 → ^2.8.2
- `@types/bun` (dev) — 1.3.0 → latest

## Code Changes (Remove References)

### `src/server.ts`
- Remove background embedding sync on startup
- Remove store handler import and registration
- Remove sync/database imports

### `src/tools.ts`
- Remove `store` tool definition entirely
- Remove semantic/distill params from `recall` tool definition
- Remove `semantic`, `minSimilarity`, `distill`, `distillProvider`, `distillMaxTokens` from recall params

### `src/types.ts`
- Remove `SearchResult` type
- Remove `DistillResult` type
- Remove semantic/distill fields from `RecallOptions`
- Remove `distilled` field from `RecallResult`
- Remove `searchMethod` and `searchResults` from `RecallResult` (or keep searchMethod if useful)

### `src/recall.ts`
- Remove semantic search branch (embedding-based search)
- Remove distillation call
- Remove imports for embeddings/distill modules
- Keep fuse.js fuzzy search path
- Keep time range filtering

### `src/handlers/recall.ts`
- Remove semantic/distill response fields from output building
- Keep checkpoint summary building

### `src/handlers/index.ts`
- Remove store handler export

### `src/checkpoints.ts`
- Remove `triggerBackgroundEmbedding()` calls (or whatever the embedding hook is)
- Remove embedding-related imports

## Verification

1. Delete all listed files
2. Remove deps from package.json
3. `bun install` — verify clean install
4. Fix all import/reference errors in remaining code
5. `bun test 2>&1 | tail -5` — all remaining tests pass
6. Manual smoke test: start server, call checkpoint and recall

## Exit Criteria

- Zero test failures
- Zero native binary dependencies
- `bun install` completes without downloading platform-specific binaries
- Server starts and responds to checkpoint/recall/plan tool calls
- package.json has exactly 3 runtime deps: `@modelcontextprotocol/sdk`, `fuse.js`, `yaml`
