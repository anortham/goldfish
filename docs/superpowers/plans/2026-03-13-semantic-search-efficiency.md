# Semantic Search Efficiency Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix semantic search cold start (process entire backlog in one pass), add relevance floor (filter junk results), and prune orphaned cache directories on startup.

**Architecture:** Three independent changes to the semantic search pipeline. Change 1 uncaps maintenance limits in `processPendingSemanticWork` and `runSearchSemanticMaintenance`. Change 2 adds score-based filtering in `buildHybridRanking` → `rankSearchCheckpoints`. Change 3 adds `workspacePath` tracking to manifests and a startup pruning function.

**Tech Stack:** Bun, TypeScript, fuse.js, @huggingface/transformers (all-MiniLM-L6-v2)

**Spec:** `docs/superpowers/specs/2026-03-13-semantic-search-efficiency-design.md`

---

## Chunk 1: Uncapped Semantic Maintenance

### Task 1: Make `maxMs` optional in `processPendingSemanticWork`

**Files:**
- Modify: `src/semantic.ts:23-30` (interface) and `src/semantic.ts:219-306` (function body)
- Test: `tests/semantic.test.ts`

- [ ] **Step 1: Write failing test — processes all items when maxMs is undefined**

Add to the `processPendingSemanticWork` describe block in `tests/semantic.test.ts`:

```typescript
it('processes all items without timeout when maxMs is undefined', async () => {
  const saved: string[] = []

  const result = await processPendingSemanticWork({
    pending: [
      { checkpointId: 'one', digest: 'first digest' },
      { checkpointId: 'two', digest: 'second digest' },
      { checkpointId: 'three', digest: 'third digest' }
    ],
    maxItems: 10,
    embed: async (texts: string[]) => texts.map(() => [1]),
    save: async (checkpointId: string) => {
      saved.push(checkpointId)
    }
  })

  expect(saved).toEqual(['one', 'two', 'three'])
  expect(result).toEqual({ processed: 3, remaining: 0, stopped: 'exhausted' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/semantic.test.ts -t "processes all items without timeout" 2>&1 | tail -10`

Expected: FAIL — `maxMs` is required, TypeScript compilation error or runtime type error.

- [ ] **Step 3: Make `maxMs` optional in the interface**

In `src/semantic.ts`, change the `ProcessPendingSemanticWorkInput` interface:

```typescript
interface ProcessPendingSemanticWorkInput {
  pending: PendingSemanticWorkItem[]
  maxItems: number
  maxMs?: number
  now?: () => number
  embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]>
  save: (checkpointId: string, embedding: number[]) => Promise<void>
}
```

- [ ] **Step 4: Update `processPendingSemanticWork` to skip timeout when `maxMs` is undefined**

In `src/semantic.ts`, replace the function body of `processPendingSemanticWork` (lines 219-306):

```typescript
export async function processPendingSemanticWork(
  input: ProcessPendingSemanticWorkInput
): Promise<ProcessPendingSemanticWorkResult> {
  const now = input.now ?? Date.now
  const startedAt = now()
  const hasTimeBudget = input.maxMs !== undefined
  let processed = 0

  for (const item of input.pending) {
    if (processed >= input.maxItems) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-items'
      }
    }

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    let embeddingsResult: TimedEmbeddingResult

    if (hasTimeBudget) {
      const remainingMs = input.maxMs! - (now() - startedAt)
      if (remainingMs <= 0) {
        return {
          processed,
          remaining: input.pending.length - processed,
          stopped: 'max-ms'
        }
      }

      embeddingsResult = await new Promise<TimedEmbeddingResult>((resolve) => {
        const controller = new AbortController()
        const timeout = setTimeout(() => {
          controller.abort()
          resolve({ status: 'timeout' })
        }, remainingMs)

        void input.embed([item.digest], controller.signal)
          .then(embeddings => {
            clearTimeout(timeout)
            resolve({ status: 'ok', embeddings })
          })
          .catch(error => {
            clearTimeout(timeout)
            resolve({ status: 'error', error })
          })
      })
    } else {
      try {
        const embeddings = await input.embed([item.digest])
        embeddingsResult = { status: 'ok', embeddings }
      } catch (error) {
        embeddingsResult = { status: 'error', error }
      }
    }

    if (embeddingsResult.status === 'timeout') {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }

    if (embeddingsResult.status === 'error') {
      throw embeddingsResult.error
    }

    const embeddings = embeddingsResult.embeddings
    const embedding = embeddings[0]

    if (!embedding) {
      throw new Error(`Missing embedding for '${item.checkpointId}'`)
    }

    await input.save(item.checkpointId, embedding)
    processed += 1

    if (hasTimeBudget && (now() - startedAt) >= input.maxMs!) {
      return {
        processed,
        remaining: input.pending.length - processed,
        stopped: 'max-ms'
      }
    }
  }

  return {
    processed,
    remaining: input.pending.length - processed,
    stopped: 'exhausted'
  }
}
```

- [ ] **Step 5: Run all semantic tests to verify nothing broke**

Run: `bun test tests/semantic.test.ts 2>&1 | tail -10`

Expected: All tests pass (existing `maxMs` tests still work, new test passes).

- [ ] **Step 6: Commit**

```bash
git add src/semantic.ts tests/semantic.test.ts
git commit -m "feat: make maxMs optional in processPendingSemanticWork

Skip setTimeout abort-controller when no time budget is set.
Avoids setTimeout(fn, Infinity) overflow hazard (32-bit int clamp)."
```

### Task 2: Uncap `runSearchSemanticMaintenance`

**Files:**
- Modify: `src/recall.ts:29-30` (constants) and `src/recall.ts:239-295` (function)
- Test: `tests/recall.test.ts`

- [ ] **Step 1: Write failing test — maintenance processes all pending records**

Find the semantic maintenance tests in `tests/recall.test.ts`. Add a new test:

```typescript
it('processes entire pending backlog in a single maintenance pass', async () => {
  const runtime = {
    isReady: () => true,
    getModelInfo: () => ({ id: 'test-model', version: '1' }),
    embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
  }

  // Create 10 checkpoints to produce 10 pending records
  for (let i = 0; i < 10; i++) {
    await saveCheckpoint({
      description: `Checkpoint ${i} for bulk maintenance`,
      tags: ['bulk-test'],
      workspace: TEST_DIR_A
    })
  }

  // First recall with search triggers backfill + maintenance
  await recall({
    search: 'bulk maintenance',
    workspace: TEST_DIR_A,
    _semanticRuntime: runtime
  })

  // All records should now be ready (not capped at 3)
  const state = await loadSemanticState(TEST_DIR_A)
  const readyCount = state.records.filter(r => r.status === 'ready').length
  expect(readyCount).toBe(10)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/recall.test.ts -t "processes entire pending backlog" 2>&1 | tail -15`

Expected: FAIL — only 3 records are ready (current limit).

- [ ] **Step 3: Update existing tests that assert old 3-item limit**

In `tests/recall.test.ts`:

**Line 313** — "processes at most 3 pending semantic records per warm search call": Rewrite this test to expect all records processed. Change the description to "processes all pending semantic records in a warm search call" and update assertions:
- Change `expect(pending).toHaveLength(4)` → `expect(pending).toHaveLength(0)` (no more pending)
- Change `expect(state.records.filter(record => record.status === 'ready')).toHaveLength(3)` → `expect(state.records.filter(record => record.status === 'ready')).toHaveLength(7)` (all checkpoints: 3 from beforeEach + 4 created in test)

**Line 606** — "does not let slow maintenance block a warm search past the budget": Delete this entire test. Maintenance no longer has a time budget, so the test premise is invalid. The 250ms sleep + 220ms race condition is testing behavior that no longer exists.

- [ ] **Step 4: Remove constants and simplify `runSearchSemanticMaintenance`**

In `src/recall.ts`:

1. Delete the two constants (lines 29-30):
```typescript
// DELETE these:
const SEARCH_SEMANTIC_MAINTENANCE_LIMIT = 3;
const SEARCH_SEMANTIC_MAINTENANCE_MS = 150;
```

2. Replace `runSearchSemanticMaintenance` (lines 239-295) with:

```typescript
async function runSearchSemanticMaintenance(
  workspaces: string[],
  runtime: RecallOptions['_semanticRuntime']
): Promise<void> {
  if (!runtime || !runtime.isReady()) {
    return;
  }

  const seenWorkspaces = new Set<string>();

  try {
    for (const workspace of workspaces) {
      if (seenWorkspaces.has(workspace)) {
        continue;
      }

      seenWorkspaces.add(workspace);

      const pending = await listPendingSemanticRecords(workspace);
      if (pending.length === 0) {
        continue;
      }

      await processPendingSemanticWork({
        pending,
        maxItems: pending.length,
        embed: async (texts: string[], signal?: AbortSignal) => await runtime.embedTexts(texts, signal),
        save: async (checkpointId: string, embedding: number[]) => {
          await markSemanticRecordReady(
            workspace,
            checkpointId,
            embedding,
            runtime.getModelInfo?.() ?? SEARCH_SEMANTIC_MODEL
          );
        }
      });
    }
  } catch (error) {
    warnSemanticFailure('semantic maintenance failed', error);
    return;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/recall.test.ts 2>&1 | tail -10`

Expected: All tests pass.

- [ ] **Step 6: Run full test suite**

Run: `bun test 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "feat: uncap semantic maintenance to process entire backlog

Remove SEARCH_SEMANTIC_MAINTENANCE_LIMIT (3) and SEARCH_SEMANTIC_MAINTENANCE_MS (150).
First search fully indexes all pending checkpoints in one pass."
```

---

## Chunk 2: Relevance Floor

### Task 3: Refactor `buildHybridRanking` to return scored results

**Files:**
- Modify: `src/semantic.ts:154-217`
- Test: `tests/semantic.test.ts`

- [ ] **Step 1: Add `ScoredCheckpoint` type and `MINIMUM_SEARCH_RELEVANCE` constant**

At the top of `src/semantic.ts`, after the existing interfaces, add:

```typescript
export interface ScoredCheckpoint {
  checkpoint: Checkpoint
  score: number
}

export const MINIMUM_SEARCH_RELEVANCE = 0.15
```

- [ ] **Step 2: Write failing test — `buildHybridRanking` returns scores**

Update the first test in the `buildHybridRanking` describe block to expect `ScoredCheckpoint[]`:

```typescript
it('keeps strong lexical matches first while semantic similarity rescues wording mismatches', async () => {
  const exactLexical: Checkpoint = {
    id: 'exact-lexical',
    timestamp: '2026-03-12T10:00:00.000Z',
    description: 'Fixed JWT authentication timeout bug',
    tags: ['auth']
  }

  const semanticRescue: Checkpoint = {
    id: 'semantic-rescue',
    timestamp: '2026-03-11T10:00:00.000Z',
    description: 'Resolved login session expiry issue',
    tags: ['session']
  }

  const irrelevant: Checkpoint = {
    id: 'irrelevant',
    timestamp: '2026-03-12T09:00:00.000Z',
    description: 'Refactored database migration scripts',
    tags: ['database']
  }

  const ranked = await buildHybridRanking({
    query: 'login timeout problem',
    checkpoints: [exactLexical, irrelevant, semanticRescue],
    lexicalOrder: ['exact-lexical', 'irrelevant', 'semantic-rescue'],
    digests: {
      'exact-lexical': 'jwt authentication timeout bug',
      'semantic-rescue': 'login session expiry issue',
      irrelevant: 'database migration scripts'
    },
    readyRecords: [
      { checkpointId: 'exact-lexical', embedding: [0.7, 0.3] },
      { checkpointId: 'semantic-rescue', embedding: [1, 0] },
      { checkpointId: 'irrelevant', embedding: [0, 1] }
    ],
    runtime: {
      isReady: () => true,
      embedTexts: async (texts: string[]) => {
        expect(texts).toEqual(['login timeout problem'])
        return [[1, 0]]
      }
    }
  })

  expect(ranked.map(r => r.checkpoint.id)).toEqual([
    'exact-lexical',
    'semantic-rescue',
    'irrelevant'
  ])
  expect(ranked[0]!.score).toBeGreaterThan(0.15)
  expect(ranked.every(r => typeof r.score === 'number')).toBe(true)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/semantic.test.ts -t "keeps strong lexical" 2>&1 | tail -10`

Expected: FAIL — `ranked.map(r => r.checkpoint.id)` fails because `ranked` currently contains `Checkpoint` objects, not `ScoredCheckpoint`.

- [ ] **Step 4: Refactor `buildHybridRanking` to return `ScoredCheckpoint[]`**

In `src/semantic.ts`, replace the `buildHybridRanking` function (lines 154-217):

```typescript
export async function buildHybridRanking(input: BuildHybridRankingInput): Promise<ScoredCheckpoint[]> {
  const lexicalRanks = new Map(input.lexicalOrder.map((checkpointId, index) => [checkpointId, index]))
  const originalIndexes = new Map(input.checkpoints.map((checkpoint, index) => [checkpoint.id, index]))
  const readyRecordsById = new Map(input.readyRecords.map(record => [record.checkpointId, record]))
  const timestamps = input.checkpoints.map(checkpoint => new Date(checkpoint.timestamp).getTime())
  const oldest = Math.min(...timestamps)
  const newest = Math.max(...timestamps)

  let queryEmbedding = input.queryEmbedding
  if (!queryEmbedding && input.readyRecords.length > 0) {
    const embeddings = await input.runtime.embedTexts([input.query])
    queryEmbedding = embeddings[0]
  }

  function computeScore(checkpoint: Checkpoint): number {
    const lexicalIndex = lexicalRanks.get(checkpoint.id) ?? input.lexicalOrder.length
    const lexical = lexicalScore(lexicalIndex, Math.max(input.lexicalOrder.length, 1))

    const semantic = queryEmbedding
      ? cosineSimilarity(queryEmbedding, readyRecordsById.get(checkpoint.id)?.embedding ?? [])
      : 0

    return (
      (lexical * 0.65) +
      (semantic * 0.35) +
      lexicalMatchBoost(input.query, checkpoint, input.digests[checkpoint.id]) +
      metadataBoost(input.query, checkpoint) +
      (recencyScore(checkpoint.timestamp, oldest, newest) * 0.03)
    )
  }

  const scored: ScoredCheckpoint[] = input.checkpoints.map(checkpoint => ({
    checkpoint,
    score: computeScore(checkpoint)
  }))

  return scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    const leftLexicalIndex = lexicalRanks.get(left.checkpoint.id) ?? input.lexicalOrder.length
    const rightLexicalIndex = lexicalRanks.get(right.checkpoint.id) ?? input.lexicalOrder.length
    if (leftLexicalIndex !== rightLexicalIndex) {
      return leftLexicalIndex - rightLexicalIndex
    }

    const leftTime = new Date(left.checkpoint.timestamp).getTime()
    const rightTime = new Date(right.checkpoint.timestamp).getTime()
    if (leftTime !== rightTime) {
      return rightTime - leftTime
    }

    const leftOriginalIndex = originalIndexes.get(left.checkpoint.id) ?? 0
    const rightOriginalIndex = originalIndexes.get(right.checkpoint.id) ?? 0
    if (leftOriginalIndex !== rightOriginalIndex) {
      return leftOriginalIndex - rightOriginalIndex
    }

    return left.checkpoint.id.localeCompare(right.checkpoint.id)
  })
}
```

- [ ] **Step 5: Update the other two `buildHybridRanking` tests for new return type**

Update the metadata boost test:
```typescript
expect(ranked.map(r => r.checkpoint.id)).toEqual(['boosted', 'plain'])
```

Update the hidden thread test:
```typescript
expect(ranked.map(r => r.checkpoint.id)).toEqual(['plain', 'hidden-thread'])
```

- [ ] **Step 6: Update `rankSearchCheckpoints` in `src/recall.ts` to handle `ScoredCheckpoint[]`**

Import `MINIMUM_SEARCH_RELEVANCE` and `ScoredCheckpoint` from `./semantic` in `src/recall.ts`.

Replace the `buildHybridRanking` call site inside `rankSearchCheckpoints` (around line 366):

```typescript
    const scored = await buildHybridRanking({
      query,
      checkpoints: candidateCheckpoints,
      lexicalOrder,
      digests,
      readyRecords,
      runtime,
      ...(queryEmbedding ? { queryEmbedding } : {})
    });

    return scored
      .filter(item => item.score >= MINIMUM_SEARCH_RELEVANCE)
      .map(item => {
        const original = checkpointsById.get(item.checkpoint.id);
        return original ?? item.checkpoint;
      });
```

- [ ] **Step 7: Run tests**

Run: `bun test tests/semantic.test.ts tests/recall.test.ts 2>&1 | tail -10`

Expected: All tests pass.

- [ ] **Step 8: Write test for relevance floor filtering**

Add to `tests/recall.test.ts` in the search-related describe block:

```typescript
it('returns empty results when no checkpoints match the search query', async () => {
  const runtime = {
    isReady: () => true,
    getModelInfo: () => ({ id: 'test-model', version: '1' }),
    embedTexts: async (texts: string[]) => texts.map(() => [0, 0, 1])
  }

  await saveCheckpoint({
    description: 'Fixed authentication bug in login flow',
    tags: ['auth'],
    workspace: TEST_DIR_A
  })

  // Embed the checkpoint so semantic scoring works
  const state = await loadSemanticState(TEST_DIR_A)
  for (const record of state.records) {
    if (record.status === 'pending') {
      await markSemanticRecordReady(TEST_DIR_A, record.checkpointId, [1, 0, 0], {
        id: 'test-model',
        version: '1'
      })
    }
  }

  const result = await recall({
    search: 'kubernetes deployment configuration',
    workspace: TEST_DIR_A,
    _semanticRuntime: runtime,
    limit: 5
  })

  // Should return 0 results — nothing relevant
  expect(result.checkpoints).toHaveLength(0)
})
```

- [ ] **Step 9: Run the relevance floor test**

Run: `bun test tests/recall.test.ts -t "returns empty results when no checkpoints" 2>&1 | tail -10`

Expected: PASS (the filtering is already wired up from step 6).

- [ ] **Step 10: Run full test suite**

Run: `bun test 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 11: Commit**

```bash
git add src/semantic.ts src/recall.ts tests/semantic.test.ts tests/recall.test.ts
git commit -m "feat: add relevance floor to hybrid search ranking

buildHybridRanking now returns scored results. Results below
MINIMUM_SEARCH_RELEVANCE (0.15) are filtered out. Off-topic
queries return empty results instead of low-quality filler."
```

---

## Chunk 3: Cache Cleanup

### Task 4: Add `workspacePath` to semantic manifests

**Files:**
- Modify: `src/semantic-cache.ts:27-29` (interface) and `src/semantic-cache.ts:189-225` (upsert function)
- Test: `tests/semantic-cache.test.ts`

- [ ] **Step 1: Write failing test — upsert writes `workspacePath` into manifest**

Add to the `semantic cache` describe block in `tests/semantic-cache.test.ts`:

```typescript
it('writes workspacePath into the manifest on upsert', async () => {
  await upsertPendingSemanticRecord(workspacePath, {
    checkpointId: 'checkpoint_wp_test',
    checkpointTimestamp: '2026-03-13T10:00:00.000Z',
    digest: 'Test digest',
    digestHash: 'hash-wp',
    digestVersion: 1
  })

  const state = await loadSemanticState(workspacePath)
  expect(state.manifest.workspacePath).toBe(workspacePath)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/semantic-cache.test.ts -t "writes workspacePath" 2>&1 | tail -10`

Expected: FAIL — `state.manifest.workspacePath` is `undefined`.

- [ ] **Step 3: Add `workspacePath` to `SemanticManifest` interface**

In `src/semantic-cache.ts`, update the interface:

```typescript
export interface SemanticManifest {
  workspacePath?: string
  checkpoints: Record<string, SemanticManifestCheckpoint>
}
```

- [ ] **Step 4: Fix `readManifest` to preserve `workspacePath`**

**Critical:** `readManifest` (line 70) currently reconstructs the object with only `checkpoints`, stripping any other fields. Update it to preserve `workspacePath`:

```typescript
async function readManifest(manifestPath: string): Promise<SemanticManifest> {
  try {
    const content = await readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(content) as SemanticManifest

    return {
      ...(parsed.workspacePath ? { workspacePath: parsed.workspacePath } : {}),
      checkpoints: parsed.checkpoints ?? {}
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { checkpoints: {} }
    }

    throw error
  }
}
```

- [ ] **Step 5: Update existing manifest equality test**

In `tests/semantic-cache.test.ts` line 59, the "creates a pending record with digest metadata" test does:
```typescript
expect(state.manifest).toEqual({
  checkpoints: { ... }
})
```

Update to include `workspacePath`:
```typescript
expect(state.manifest).toEqual({
  workspacePath: workspacePath,
  checkpoints: { ... }
})
```

- [ ] **Step 6: Write `workspacePath` in `upsertPendingSemanticRecord`**

In `src/semantic-cache.ts`, inside `upsertPendingSemanticRecord`, add before the `writeSemanticState` call:

```typescript
state.manifest.workspacePath = workspace
```

- [ ] **Step 7: Write `workspacePath` in `markSemanticRecordReady`**

In `src/semantic-cache.ts`, inside `markSemanticRecordReady`, add before the `writeSemanticState` call (inside the `withSemanticStateLock` callback). The `workspace` parameter is the first argument to the function:

```typescript
state.manifest.workspacePath = workspace
```

- [ ] **Step 8: Run tests**

Run: `bun test tests/semantic-cache.test.ts 2>&1 | tail -10`

Expected: All tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/semantic-cache.ts tests/semantic-cache.test.ts
git commit -m "feat: write workspacePath into semantic cache manifests

Enables reverse mapping from hash-named cache dirs to project paths.
Required for orphaned cache pruning."
```

### Task 5: Add `pruneOrphanedSemanticCaches` function

**Files:**
- Modify: `src/semantic-cache.ts` (add new exported function)
- Test: `tests/semantic-cache.test.ts`

- [ ] **Step 1: Write failing test — prunes dirs with no manifest**

Add a new describe block in `tests/semantic-cache.test.ts`:

```typescript
describe('pruneOrphanedSemanticCaches', () => {
  it('deletes cache directories with no manifest', async () => {
    const cacheDir = getSemanticCacheDir(workspacePath)
    const parentDir = join(cacheDir, '..')
    const orphanDir = join(parentDir, 'orphan-no-manifest')

    await mkdir(orphanDir, { recursive: true })

    await pruneOrphanedSemanticCaches()

    const { existsSync } = await import('fs')
    expect(existsSync(orphanDir)).toBe(false)
  })
})
```

Import `pruneOrphanedSemanticCaches` at the top of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/semantic-cache.test.ts -t "deletes cache directories with no manifest" 2>&1 | tail -10`

Expected: FAIL — function doesn't exist yet.

- [ ] **Step 3: Implement `pruneOrphanedSemanticCaches`**

Add to `src/semantic-cache.ts`:

```typescript
import { readdir, stat, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { getGoldfishHomeDir } from './workspace'

const PRUNE_MAX_DIRS = 500

export async function pruneOrphanedSemanticCaches(): Promise<void> {
  const cacheRoot = join(getGoldfishHomeDir(), 'cache', 'semantic')

  let entries: string[]
  try {
    entries = await readdir(cacheRoot)
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return
    }
    throw error
  }

  // Sort by mtime (oldest first) and cap at PRUNE_MAX_DIRS
  const withStats = await Promise.all(
    entries.map(async (entry) => {
      const dirPath = join(cacheRoot, entry)
      try {
        const stats = await stat(dirPath)
        return stats.isDirectory() ? { entry, dirPath, mtime: stats.mtimeMs } : null
      } catch {
        return null
      }
    })
  )

  const dirs = withStats
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => a.mtime - b.mtime)
    .slice(0, PRUNE_MAX_DIRS)

  for (const { dirPath } of dirs) {
    try {
      const manifestPath = join(dirPath, MANIFEST_FILE)
      let manifest: SemanticManifest | undefined

      try {
        const content = await readFile(manifestPath, 'utf-8')
        manifest = JSON.parse(content)
      } catch {
        // No manifest or invalid JSON — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      if (!manifest?.workspacePath) {
        // Pre-migration manifest without workspacePath — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      if (!existsSync(manifest.workspacePath)) {
        // Workspace path no longer exists — delete
        await rm(dirPath, { recursive: true, force: true })
        continue
      }

      // workspacePath exists on disk — keep
    } catch {
      // Skip dirs that fail — best-effort
    }
  }
}
```

Note: `readdir`, `stat`, and `rm` need to be added to the existing `fs/promises` import. `existsSync` needs to be imported from `fs`.

- [ ] **Step 4: Run the test**

Run: `bun test tests/semantic-cache.test.ts -t "deletes cache directories with no manifest" 2>&1 | tail -10`

Expected: PASS.

- [ ] **Step 5: Write test — prunes dirs with manifest but no workspacePath**

```typescript
it('deletes cache directories with manifest but no workspacePath', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  const parentDir = join(cacheDir, '..')
  const orphanDir = join(parentDir, 'orphan-no-wspath')

  await mkdir(orphanDir, { recursive: true })
  await writeFile(join(orphanDir, 'manifest.json'), JSON.stringify({
    checkpoints: { 'checkpoint_old': { digestHash: 'x', digestVersion: 1 } }
  }))

  await pruneOrphanedSemanticCaches()

  const { existsSync } = await import('fs')
  expect(existsSync(orphanDir)).toBe(false)
})
```

- [ ] **Step 6: Run test**

Run: `bun test tests/semantic-cache.test.ts -t "deletes cache directories with manifest but no workspacePath" 2>&1 | tail -10`

Expected: PASS.

- [ ] **Step 7: Write test — keeps dirs with valid workspacePath**

```typescript
it('keeps cache directories with a valid workspacePath', async () => {
  // Create a real semantic record so the manifest has workspacePath
  await upsertPendingSemanticRecord(workspacePath, {
    checkpointId: 'checkpoint_keep_test',
    checkpointTimestamp: '2026-03-13T10:00:00.000Z',
    digest: 'Keep this',
    digestHash: 'hash-keep',
    digestVersion: 1
  })

  await pruneOrphanedSemanticCaches()

  const state = await loadSemanticState(workspacePath)
  expect(state.records).toHaveLength(1)
})
```

- [ ] **Step 8: Run test**

Run: `bun test tests/semantic-cache.test.ts -t "keeps cache directories" 2>&1 | tail -10`

Expected: PASS.

- [ ] **Step 9: Write test — prunes dirs where workspacePath doesn't exist on disk**

```typescript
it('deletes cache directories where workspacePath no longer exists', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  const parentDir = join(cacheDir, '..')
  const orphanDir = join(parentDir, 'orphan-gone-path')

  await mkdir(orphanDir, { recursive: true })
  await writeFile(join(orphanDir, 'manifest.json'), JSON.stringify({
    workspacePath: '/nonexistent/path/that/does/not/exist',
    checkpoints: {}
  }))

  await pruneOrphanedSemanticCaches()

  const { existsSync } = await import('fs')
  expect(existsSync(orphanDir)).toBe(false)
})
```

- [ ] **Step 10: Run test**

Run: `bun test tests/semantic-cache.test.ts -t "deletes cache directories where workspacePath" 2>&1 | tail -10`

Expected: PASS.

- [ ] **Step 11: Run all semantic-cache tests**

Run: `bun test tests/semantic-cache.test.ts 2>&1 | tail -10`

Expected: All tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/semantic-cache.ts tests/semantic-cache.test.ts
git commit -m "feat: add pruneOrphanedSemanticCaches function

Scans ~/.goldfish/cache/semantic/ and deletes orphaned dirs:
no manifest, no workspacePath, or nonexistent workspace path.
Caps at 500 dirs per call, oldest first."
```

### Task 6: Call pruning on server startup

**Files:**
- Modify: `src/server.ts`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write test — startup calls pruning without blocking**

Add to `tests/server.test.ts`:

```typescript
describe('Server startup', () => {
  it('calls pruneOrphanedSemanticCaches on startup without blocking', async () => {
    const { pruneOrphanedSemanticCaches } = await import('../src/semantic-cache')

    // The function should not throw even on a clean environment
    await expect(pruneOrphanedSemanticCaches()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test**

Run: `bun test tests/server.test.ts -t "calls pruneOrphanedSemanticCaches" 2>&1 | tail -10`

Expected: PASS (the function already exists from Task 5).

- [ ] **Step 3: Wire up pruning in `startServer`**

In `src/server.ts`, add import:

```typescript
import { pruneOrphanedSemanticCaches } from './semantic-cache.js';
```

In the `startServer` function, add fire-and-forget pruning before `server.connect`:

```typescript
// Prune orphaned semantic caches (fire-and-forget)
pruneOrphanedSemanticCaches().catch(() => {
  // Silently ignore — pruning is best-effort
});
```

- [ ] **Step 4: Run full test suite**

Run: `bun test 2>&1 | tail -5`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: prune orphaned semantic caches on server startup

Fire-and-forget cleanup of stale cache directories.
Processes up to 500 dirs per startup, oldest first."
```

---

## Final Verification

- [ ] **Run full test suite one more time**

Run: `bun test 2>&1 | tail -5`

Expected: All tests pass with zero failures.

- [ ] **Type check**

Run: `bunx tsc --noEmit 2>&1 | tail -5`

Expected: No type errors.
