# Semantic Hardening Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make semantic search opportunistic and bounded so recall always returns lexical results, corrupted derived cache state self-recovers, and embedder aborts do not break serialization.

**Architecture:** Keep the current semantic pipeline and derived cache format, but harden the seams. `recall.ts` gets timeout-aware query embedding plus bounded maintenance, `semantic-cache.ts` normalizes and resets broken derived state, `lock.ts` grows a cheap lock-acquisition helper for prune, and `transformers-embedder.ts` stops using eager queue release on abort.

**Tech Stack:** Bun, TypeScript, fuse.js, `@huggingface/transformers`, project-local markdown storage, derived semantic cache under `~/.goldfish/cache/semantic`

**Spec:** `docs/superpowers/specs/2026-03-31-semantic-hardening-design.md`

---

## File Map

- Modify: `src/recall.ts`
  Responsibility: search orchestration, query embedding timeout, bounded semantic maintenance, lexical fallback on semantic failure.
- Modify: `src/semantic-cache.ts`
  Responsibility: semantic cache reads/writes, state normalization, corruption reset, prune behavior.
- Modify: `src/transformers-embedder.ts`
  Responsibility: lazy model load, serialized embedding queue, abort behavior.
- Modify: `src/lock.ts`
  Responsibility: shared lock primitive for cheap prune-time lock acquisition.
- Modify: `docs/IMPLEMENTATION.md`
  Responsibility: document the corrected semantic recall behavior.
- Test: `tests/recall.test.ts`
  Responsibility: recall orchestration, lexical fallback, bounded maintenance.
- Test: `tests/semantic-cache.test.ts`
  Responsibility: semantic cache normalization, corruption reset, prune safety.
- Test: `tests/transformers-embedder.test.ts`
  Responsibility: cold-start abort and serialized queue behavior.
- Test: `tests/lock.test.ts`
  Responsibility: new cheap/timeout lock acquisition helper if added to `src/lock.ts`.

## Chunk 1: Opportunistic Query Embedding

### Task 1: Add timeout-backed lexical fallback for query embedding

**Files:**
- Modify: `src/recall.ts:24-31`, `src/recall.ts:359-408`, `src/recall.ts:529-620`
- Test: `tests/recall.test.ts:523-635`, `tests/recall.test.ts:723-858`

- [ ] **Step 1: Write failing tests for hung query embedding in single-workspace and cross-workspace search**

Add two tests to `tests/recall.test.ts`:

```typescript
it('falls back to lexical results when query embedding hangs in single-workspace search', async () => {
  await saveCheckpoint({
    description: 'Authentication timeout lexical fallback',
    tags: ['auth'],
    workspace: TEST_DIR_A
  })

  const runtime = {
    isReady: () => true,
    embedTexts: async (texts: string[], signal?: AbortSignal) => {
      if (texts[0] === 'authentication') {
        await new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
      return texts.map(() => [1, 0])
    }
  }

  const result = await Promise.race([
    recall({ workspace: TEST_DIR_A, search: 'authentication', limit: 5, _semanticRuntime: runtime }),
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 250))
  ])

  expect(result).not.toBe('timeout')
  if (result === 'timeout') throw new Error('recall hung on query embedding')
  expect(result.checkpoints[0]!.description.toLowerCase()).toContain('auth')
})

it('falls back to lexical results when query embedding hangs in cross-workspace search', async () => {
  const result = await Promise.race([
    recall({
      workspace: 'all',
      days: 1,
      search: 'project-a',
      limit: 5,
      _registryDir: registryDir,
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async (texts: string[], signal?: AbortSignal) => {
          if (texts[0] === 'project-a') {
            await new Promise((_, reject) => {
              signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
            })
          }
          return texts.map(() => [1, 0])
        }
      }
    }),
    new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 250))
  ])

  expect(result).not.toBe('timeout')
  if (result === 'timeout') throw new Error('cross-workspace recall hung on query embedding')
  expect(result.checkpoints.some(cp => cp.description.includes('project A'))).toBe(true)
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/recall.test.ts -t "query embedding hangs"`

Expected: FAIL because recall waits forever on the semantic query promise instead of returning lexical results.

- [ ] **Step 3: Add a timeout-backed helper for query embedding in `src/recall.ts`**

Add a query timeout constant and helper near the top of `src/recall.ts`:

```typescript
type QueryEmbeddingResult =
  | { ok: true; embedding?: number[] }
  | { ok: false; error: unknown }
  | { ok: false; timedOut: true }

const SEARCH_QUERY_EMBEDDING_TIMEOUT_MS = 150

async function embedQueryWithTimeout(
  query: string,
  runtime: RecallOptions['_semanticRuntime'],
  timeoutMs = SEARCH_QUERY_EMBEDDING_TIMEOUT_MS
): Promise<QueryEmbeddingResult> {
  if (!runtime) {
    return { ok: false, error: new Error('semantic runtime unavailable') }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const embeddings = await runtime.embedTexts([query], controller.signal)
    return { ok: true, embedding: embeddings[0] }
  } catch (error) {
    if (controller.signal.aborted) {
      return { ok: false, timedOut: true }
    }
    return { ok: false, error }
  } finally {
    clearTimeout(timeout)
  }
}
```

- [ ] **Step 4: Use the helper in both recall search paths**

Replace both inline `semanticRuntime.embedTexts([options.search])` blocks in `src/recall.ts` with:

```typescript
const queryEmbeddingPromise = embedQueryWithTimeout(options.search, semanticRuntime)
```

Do this in both:
- `recallFromWorkspace()` search path
- `recall()` cross-workspace search path

- [ ] **Step 5: Run the recall tests to verify lexical fallback works**

Run: `bun test tests/recall.test.ts -t "query embedding hangs|semantic embedding fails during ranking"`

Expected: PASS. The new timeout tests pass, and the existing ranking-failure fallback test still passes.

- [ ] **Step 6: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "fix: bound query embedding for recall search

Abort timed-out query embedding requests so recall falls back to
lexical results instead of hanging on semantic ranking." 
```

## Chunk 2: Bounded Search Maintenance

### Task 2: Replace full-backlog maintenance with bounded per-search maintenance

**Files:**
- Modify: `src/recall.ts:194-235`, `src/recall.ts:392-408`, `src/recall.ts:537-620`
- Test: `tests/recall.test.ts:319-374`, `tests/recall.test.ts:424-490`

- [ ] **Step 1: Rewrite the backlog tests to assert bounded maintenance instead of full draining**

Replace the current full-backlog expectation with two tests:

```typescript
it('bounds warm search maintenance to a single configured pass', async () => {
  for (let i = 0; i < 10; i++) {
    await saveCheckpoint({
      description: `Checkpoint ${i} for bounded maintenance`,
      tags: ['bounded-maintenance'],
      workspace: TEST_DIR_A
    })
  }

  await recall({
    workspace: TEST_DIR_A,
    search: 'bounded maintenance',
    _semanticRuntime: {
      isReady: () => true,
      getModelInfo: () => ({ id: 'test-model', version: '1' }),
      embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
    }
  })

  const state = await loadSemanticState(TEST_DIR_A)
  expect(state.records.filter(record => record.status === 'ready')).toHaveLength(8)
  expect((await listPendingSemanticRecords(TEST_DIR_A)).length).toBe(5)
})

it('bounds cold-runtime post-ranking maintenance to the same single pass', async () => {
  let warm = false
  const runtime = {
    isReady: () => warm,
    getModelInfo: () => ({ id: 'test-model', version: '1' }),
    embedTexts: async (texts: string[]) => {
      warm = true
      return texts.map(() => [1, 0])
    }
  }

  for (let i = 0; i < 10; i++) {
    await saveCheckpoint({
      description: `Cold checkpoint ${i} for bounded maintenance`,
      tags: ['cold-bounded-maintenance'],
      workspace: TEST_DIR_B
    })
  }

  await recall({ workspace: TEST_DIR_B, search: 'cold bounded maintenance', _semanticRuntime: runtime })

  const state = await loadSemanticState(TEST_DIR_B)
  expect(state.records.filter(record => record.status === 'ready')).toHaveLength(8)
})
```

- [ ] **Step 2: Run the bounded-maintenance tests to verify they fail**

Run: `bun test tests/recall.test.ts -t "bounds .* maintenance"`

Expected: FAIL because current recall drains the entire pending backlog in one search.

- [ ] **Step 3: Add explicit maintenance budgets to `src/recall.ts`**

Add constants near the top of `src/recall.ts`:

```typescript
const SEARCH_SEMANTIC_MAINTENANCE_MAX_ITEMS = 8
const SEARCH_SEMANTIC_MAINTENANCE_MAX_MS = 150
```

Change `runSearchSemanticMaintenance()` to pass both limits into `processPendingSemanticWork`:

```typescript
await processPendingSemanticWork({
  pending,
  maxItems: Math.min(pending.length, SEARCH_SEMANTIC_MAINTENANCE_MAX_ITEMS),
  maxMs: SEARCH_SEMANTIC_MAINTENANCE_MAX_MS,
  embed: async (texts: string[], signal?: AbortSignal) => await runtime.embedTexts(texts, signal),
  save: async (checkpointId: string, embedding: number[]) => {
    await markSemanticRecordReady(
      workspace,
      checkpointId,
      embedding,
      runtime.getModelInfo?.() ?? SEARCH_SEMANTIC_MODEL
    )
  }
})
```

- [ ] **Step 4: Keep warm and cold search paths using the same bounded helper**

Do not add special-case paths. Keep the existing:
- pre-ranking maintenance when `wasWarm`
- post-ranking maintenance when `!wasWarm`

The change is the helper budget, not the orchestration shape.

- [ ] **Step 5: Run the maintenance-focused recall tests**

Run: `bun test tests/recall.test.ts -t "pending semantic records|bounded maintenance|warms a cold runtime"`

Expected: PASS. Warm searches no longer drain everything, and the cold-runtime warm-up test still behaves correctly for small backlogs.

- [ ] **Step 6: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "fix: bound semantic maintenance on search path

Limit search-triggered semantic maintenance to a small time and item
 budget so recall latency no longer scales with indexing backlog." 
```

## Chunk 3: Derived Cache Normalization And Recovery

### Task 3: Normalize inconsistent semantic state and reset corrupted cache files

**Files:**
- Modify: `src/semantic-cache.ts:71-105`, `src/semantic-cache.ts:135-200`, `src/semantic-cache.ts:203-239`
- Modify: `src/recall.ts:165-191`, `src/recall.ts:237-265`
- Test: `tests/semantic-cache.test.ts:41-407`
- Test: `tests/recall.test.ts:523-688`

- [ ] **Step 1: Add failing normalization and corruption tests**

Add these tests to `tests/semantic-cache.test.ts`:

```typescript
it('drops manifest-only entries during normalization', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({
    workspacePath,
    checkpoints: {
      checkpoint_broken: {
        checkpointTimestamp: '2026-03-12T10:00:00.000Z',
        digestHash: 'hash-broken',
        digestVersion: 1
      }
    }
  }))
  await writeFile(join(cacheDir, 'records.jsonl'), '')

  const state = await loadSemanticState(workspacePath)
  expect(state.manifest.checkpoints).toEqual({})
  expect(state.records).toEqual([])
})

it('drops orphan records without matching manifest entries during normalization', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({ workspacePath, checkpoints: {} }))
  await writeFile(join(cacheDir, 'records.jsonl'), `${JSON.stringify({
    checkpointId: 'checkpoint_orphan',
    digest: 'orphan digest',
    digestHash: 'hash-orphan',
    status: 'pending',
    updatedAt: '2026-03-12T10:00:00.000Z'
  })}\n`)

  const state = await loadSemanticState(workspacePath)
  expect(state.manifest.checkpoints).toEqual({})
  expect(state.records).toEqual([])
})

it('resets malformed manifest files to empty derived state', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'manifest.json'), '{not-json')

  const state = await loadSemanticState(workspacePath)
  expect(state.manifest.checkpoints).toEqual({})
  expect(state.records).toEqual([])
})

it('resets malformed records files to empty derived state', async () => {
  const cacheDir = getSemanticCacheDir(workspacePath)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(cacheDir, 'manifest.json'), JSON.stringify({ workspacePath, checkpoints: {} }))
  await writeFile(join(cacheDir, 'records.jsonl'), '{not-json}\n')

  const state = await loadSemanticState(workspacePath)
  expect(state.manifest.checkpoints).toEqual({})
  expect(state.records).toEqual([])
})
```

Add this test to `tests/recall.test.ts`:

```typescript
it('recreates pending semantic state when a broken manifest-only entry would otherwise suppress backfill', async () => {
  const checkpoint = await saveCheckpoint({
    description: 'Authentication backfill repair case',
    tags: ['auth'],
    workspace: TEST_DIR_A
  })

  const cacheDir = getSemanticCacheDir(TEST_DIR_A)
  await writeFile(join(cacheDir, 'records.jsonl'), '')

  await recall({
    workspace: TEST_DIR_A,
    search: 'authentication',
    _semanticRuntime: { isReady: () => false, embedTexts: async (texts: string[]) => texts.map(() => [1, 0]) }
  })

  const pending = await listPendingSemanticRecords(TEST_DIR_A)
  expect(pending.map(record => record.checkpointId)).toContain(checkpoint.id)
})

it('returns lexical results when semantic cache files are malformed', async () => {
  await saveCheckpoint({
    description: 'Authentication lexical corruption fallback',
    tags: ['auth'],
    workspace: TEST_DIR_A
  })

  const cacheDir = getSemanticCacheDir(TEST_DIR_A)
  await writeFile(join(cacheDir, 'manifest.json'), '{not-json')

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'authentication',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
    }
  })

  expect(result.checkpoints.length).toBeGreaterThan(0)
  expect(result.checkpoints[0]!.description.toLowerCase()).toContain('auth')
})

it('warns when malformed semantic cache files are reset during recall', async () => {
  await saveCheckpoint({
    description: 'Authentication warning on cache reset',
    tags: ['auth'],
    workspace: TEST_DIR_A
  })

  const cacheDir = getSemanticCacheDir(TEST_DIR_A)
  await writeFile(join(cacheDir, 'manifest.json'), '{not-json')

  const originalWarn = console.warn
  const warnings: string[] = []
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(arg => String(arg)).join(' '))
  }

  try {
    await recall({
      workspace: TEST_DIR_A,
      search: 'authentication',
      _semanticRuntime: {
        isReady: () => true,
        embedTexts: async (texts: string[]) => texts.map(() => [1, 0])
      }
    })
  } finally {
    console.warn = originalWarn
  }

  expect(warnings.some(warning => warning.includes('semantic cache'))).toBe(true)
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `bun test tests/semantic-cache.test.ts tests/recall.test.ts -t "manifest-only|orphan records|malformed|suppress backfill|lexical corruption fallback|warning on cache reset"`

Expected: FAIL because current cache reads preserve broken manifest-only state, keep orphan records, do not warn on corruption, and propagate parse failures into recall.

- [ ] **Step 3: Add normalization and reset helpers in `src/semantic-cache.ts`**

Add helpers that normalize parsed state and reset corrupted files under the existing lock:

```typescript
function normalizeSemanticState(state: SemanticState): SemanticState {
  const recordIds = new Set(state.records.map(record => record.checkpointId))
  const checkpoints = Object.fromEntries(
    Object.entries(state.manifest.checkpoints).filter(([checkpointId]) => recordIds.has(checkpointId))
  )
  const records = state.records.filter(record => checkpoints[record.checkpointId] !== undefined)

  return {
    manifest: {
      ...(state.manifest.workspacePath ? { workspacePath: state.manifest.workspacePath } : {}),
      checkpoints
    },
    records
  }
}

async function resetSemanticState(paths: ReturnType<typeof getPaths>, workspace?: string): Promise<SemanticState> {
  const empty: SemanticState = {
    manifest: {
      ...(workspace ? { workspacePath: workspace } : {}),
      checkpoints: {}
    },
    records: []
  }
  await writeSemanticState(paths, empty)
  return empty
}
```

- [ ] **Step 4: Use normalization in the locked read path and make parse failures self-heal**

Inside `withSemanticStateLock()`, keep recovery scoped to read/parse/normalization work only:

```typescript
return await withLock(lockPath, async () => {
  let state: SemanticState

  try {
    const rawState: SemanticState = {
      manifest: await readManifest(manifestPath),
      records: await readRecords(recordsPath)
    }
    state = normalizeSemanticState(rawState)
    if (JSON.stringify(state) !== JSON.stringify(rawState)) {
      await writeSemanticState(paths, state)
    }
  } catch {
    const resetState = await resetSemanticState(paths, workspace)
    state = resetState
  }

  return await fn(state, paths)
})
```

Do not swallow `fn()` failures. Do not retry `fn()` against a reset state. If reset itself fails, let that real filesystem error surface.

- [ ] **Step 5: Emit a warning when corrupted derived cache files are reset**

Add a local warning helper in `src/semantic-cache.ts` or reuse an existing logger pattern, but make the behavior observable in tests:

```typescript
function warnSemanticCacheFailure(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.warn(`[goldfish] ${context}: ${message}`)
}
```

Call it in the read/parse recovery path before resetting corrupted cache state. The warning should mention semantic cache corruption or reset, not just the raw JSON parse error.

- [ ] **Step 6: Keep backfill based on normalized state, not manifest keys before normalization**

In `src/recall.ts`, leave `backfillMissingSemanticRecords()` using `loadSemanticState()`, but make sure the comment and behavior assume normalized state only. The broken manifest-only case should now fall through to backfill naturally.

- [ ] **Step 7: Run the cache and recall regression tests**

Run: `bun test tests/semantic-cache.test.ts tests/recall.test.ts -t "manifest-only|orphan records|malformed|backfill|lexical corruption fallback|warning on cache reset|maintenance throws|semantic embedding fails during ranking"`

Expected: PASS. Broken cache files reset to empty derived state, orphan records are dropped, recall still returns lexical results, corruption emits a warning, and manifest-only entries no longer suppress re-queueing.

- [ ] **Step 8: Commit**

```bash
git add src/semantic-cache.ts src/recall.ts tests/semantic-cache.test.ts tests/recall.test.ts
git commit -m "fix: normalize and reset broken semantic cache state

Drop inconsistent derived entries and rebuild malformed semantic cache
 files from source markdown instead of letting recall break or strand backfill." 
```

## Chunk 4: Lock-Safe Pruning

### Task 4: Make prune acquire the semantic cache lock before deleting directories

**Files:**
- Modify: `src/lock.ts:12-105`
- Modify: `src/semantic-cache.ts:329-399`
- Test: `tests/lock.test.ts`
- Test: `tests/semantic-cache.test.ts:410-495`

- [ ] **Step 1: Add failing tests for cheap lock acquisition and locked prune skip behavior**

Add a lock helper test to `tests/lock.test.ts`:

```typescript
it('returns null when lock cannot be acquired within timeout', async () => {
  const release = await acquireLock(lockPath)
  try {
    const second = await tryAcquireLock(lockPath, 25)
    expect(second).toBeNull()
  } finally {
    await release()
  }
})
```

Add a prune test to `tests/semantic-cache.test.ts`:

```typescript
it('skips prune when the semantic cache lock is already held', async () => {
  await upsertPendingSemanticRecord(workspacePath, {
    checkpointId: 'checkpoint_locked_prune',
    checkpointTimestamp: '2026-03-13T10:00:00.000Z',
    digest: 'Keep while locked',
    digestHash: 'hash-locked-prune',
    digestVersion: 1
  })

  const cacheDir = getSemanticCacheDir(workspacePath)
  const release = await acquireLock(join(cacheDir, 'semantic-cache'))

  try {
    await pruneOrphanedSemanticCaches()
    const state = await loadSemanticState(workspacePath)
    expect(state.records).toHaveLength(1)
  } finally {
    await release()
  }
})
```

- [ ] **Step 2: Run the new prune tests to verify they fail**

Run: `bun test tests/lock.test.ts tests/semantic-cache.test.ts -t "cannot be acquired within timeout|skips prune"`

Expected: FAIL because there is no cheap lock helper yet and prune ignores active locks.

- [ ] **Step 3: Add a cheap lock acquisition helper to `src/lock.ts`**

Add a structured lock helper with a short timeout budget. Do not key logic off an error-message string.

```typescript
export async function acquireLock(
  filePath: string,
  options: { maxAttempts?: number; onTimeout?: 'throw' | 'return-null' } = {}
): Promise<(() => Promise<void>) | null>

export async function tryAcquireLock(filePath: string, timeoutMs: number): Promise<(() => Promise<void>) | null> {
  const maxAttempts = Math.max(1, Math.floor(timeoutMs / 10))
  return await acquireLock(filePath, { maxAttempts, onTimeout: 'return-null' })
}
```

Implement both `maxAttempts` and `onTimeout` in `acquireLock()` itself so `tryAcquireLock()` becomes a thin wrapper instead of a polling loop layered on top of another polling loop. Only real filesystem errors should throw from `tryAcquireLock()`.

- [ ] **Step 4: Use the helper in `pruneOrphanedSemanticCaches()` and hold the lock through deletion**

In `src/semantic-cache.ts`, before deleting a candidate directory:

```typescript
const release = await tryAcquireLock(join(dirPath, LOCK_FILE), 25)
if (!release) {
  continue
}

try {
  // re-read manifest and workspace existence here
  // if still orphaned, delete while lock is held
} finally {
  await release()
}
```

Do not perform a separate “check then later delete” outside the lock. Acquire first, re-check eligibility inside the lock, then delete.

- [ ] **Step 5: Run lock and prune tests**

Run: `bun test tests/lock.test.ts tests/semantic-cache.test.ts -t "lock|prune"`

Expected: PASS. Prune skips active caches and still deletes inactive orphan caches.

- [ ] **Step 6: Commit**

```bash
git add src/lock.ts src/semantic-cache.ts tests/lock.test.ts tests/semantic-cache.test.ts
git commit -m "fix: make semantic cache pruning respect active locks

Acquire the semantic cache lock before deleting orphan caches so prune
 cannot race live semantic cache reads or writes." 
```

## Chunk 5: Embedder Abort And Queue Hardening

### Task 5: Reject cold-start aborts promptly and remove eager queue release on abort

**Files:**
- Modify: `src/transformers-embedder.ts:51-76`, `src/transformers-embedder.ts:147-239`
- Test: `tests/transformers-embedder.test.ts:82-153`

- [ ] **Step 1: Replace the current abort tests with stricter regression tests**

Add these tests to `tests/transformers-embedder.test.ts`:

```typescript
it('rejects promptly when aborted during cold start', async () => {
  let resolveLoader: ((embedder: (texts: string[]) => Promise<number[][]>) => void) | undefined
  const runtime = createTransformersEmbedder({
    loadPipeline: async () => await new Promise(resolve => {
      resolveLoader = resolve
    })
  })

  const controller = new AbortController()
  const embeddingPromise = runtime.embedTexts(['alpha'], controller.signal)
  controller.abort()

  await expect(embeddingPromise).rejects.toMatchObject({ name: 'AbortError' })

  resolveLoader?.(async (texts: string[]) => texts.map(() => [1, 0]))
})

it('does not fan out concurrent inference after multiple queued aborts', async () => {
  const started: string[] = []
  const resolvers: Array<(value: number[][]) => void> = []

  const runtime = createTransformersEmbedder({
    loadPipeline: async () => async (texts: string[]) => {
      started.push(texts[0]!)
      return await new Promise<number[][]>(resolve => resolvers.push(resolve))
    }
  })

  const firstController = new AbortController()
  const secondController = new AbortController()
  const thirdController = new AbortController()

  const first = runtime.embedTexts(['first'], firstController.signal)
  const second = runtime.embedTexts(['second'], secondController.signal)
  const third = runtime.embedTexts(['third'], thirdController.signal)

  firstController.abort()
  secondController.abort()
  thirdController.abort()

  await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  await expect(second).rejects.toMatchObject({ name: 'AbortError' })
  await expect(third).rejects.toMatchObject({ name: 'AbortError' })

  expect(started).toEqual(['first'])
  resolvers[0]!([[1, 0]])
})
```

- [ ] **Step 2: Run the embedder tests to verify they fail**

Run: `bun test tests/transformers-embedder.test.ts -t "cold start|fan out"`

Expected: FAIL. Cold-start abort currently waits on `ensureEmbedder()`, and active abort still releases the queue early.

- [ ] **Step 3: Make cold-start loading abort-observable**

In `src/transformers-embedder.ts`, change:

```typescript
const embedder = await ensureEmbedder()
```

to:

```typescript
const embedder = await withAbortSignal(ensureEmbedder(), signal)
```

This does not cancel the underlying lazy load, but it does let the caller stop waiting.

- [ ] **Step 4: Remove eager queue release on active abort**

Simplify `enqueueEmbedding()` and `embedTexts()` so queue release only happens in `finally`, not inside an abort handler. The shape should look like this:

```typescript
async function enqueueEmbedding<T>(task: () => Promise<T>): Promise<T> {
  const previousTask = embeddingQueue.catch(() => undefined)
  let releaseQueue: (() => void) | undefined
  embeddingQueue = new Promise<void>(resolve => {
    releaseQueue = resolve
  })

  const runTask = previousTask.then(async () => {
    try {
      return await task()
    } finally {
      releaseQueue?.()
      releaseQueue = undefined
    }
  })

  return await runTask
}

async embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
  if (texts.length === 0) return []
  throwIfAborted(signal)

  const embedder = await withAbortSignal(ensureEmbedder(), signal)
  const queuedEmbedding = enqueueEmbedding(async () => {
    throwIfAborted(signal)
    return await embedder(texts, signal)
  })

  return await withAbortSignal(queuedEmbedding, signal)
}
```

This is the intentional behavior change: aborted callers may reject immediately, but successors do not bypass an in-flight embed until the underlying embedder call actually returns.

- [ ] **Step 5: Run the full embedder test file**

Run: `bun test tests/transformers-embedder.test.ts`

Expected: PASS. Cold-start abort is prompt, and repeated aborts no longer create overlapping inference starts.

- [ ] **Step 6: Commit**

```bash
git add src/transformers-embedder.ts tests/transformers-embedder.test.ts
git commit -m "fix: tighten semantic embedder abort semantics

Let callers abort during cold start without waiting on model load and
 keep the embedding queue serialized by removing eager abort release." 
```

## Chunk 6: Docs And Verification

### Task 6: Update docs and run the semantic regression suite

**Files:**
- Modify: `docs/IMPLEMENTATION.md:199-210`
- Verify: `tests/semantic.test.ts`
- Verify: `tests/semantic-cache.test.ts`
- Verify: `tests/transformers-embedder.test.ts`
- Verify: `tests/ranking.test.ts`
- Verify: `tests/recall.test.ts`

- [ ] **Step 1: Update the semantic recall flow in `docs/IMPLEMENTATION.md`**

Replace the current recall-flow bullets so they describe the new behavior honestly:

```markdown
1. Load markdown checkpoints from `.memories/` and build compact retrieval digests.
2. Run Fuse lexical search over those digests so search always has a fast fallback path.
3. Start query embedding opportunistically with a short timeout. If it resolves in budget, blend lexical and semantic signals into a hybrid ranking.
4. If semantic work times out, fails, or the derived cache is broken, return lexical results and recover semantic state lazily.
5. After search, process a bounded amount of pending semantic work so indexing debt amortizes across searches instead of blocking one request.
```

- [ ] **Step 2: Run the focused semantic suite**

Run: `bun test tests/semantic.test.ts tests/semantic-cache.test.ts tests/transformers-embedder.test.ts tests/ranking.test.ts tests/recall.test.ts`

Expected: PASS. This is the required verification gate for the semantic pipeline changes.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`

Expected: PASS. No regressions outside the semantic pipeline.

- [ ] **Step 4: Commit**

```bash
git add docs/IMPLEMENTATION.md
git commit -m "docs: update semantic recall behavior

Document opportunistic semantic ranking, bounded maintenance, and
 graceful fallback when derived semantic state is damaged." 
```

## Final Verification Checklist

- [ ] Query embedding timeout returns lexical results in both single-workspace and cross-workspace search.
- [ ] Search-triggered maintenance is bounded by explicit per-search item/time budgets.
- [ ] Manifest-only derived state is dropped and recreated by backfill.
- [ ] Malformed semantic cache files are reset to empty derived state.
- [ ] Prune acquires the semantic cache lock before deletion and skips locked caches.
- [ ] Cold-start abort rejects promptly.
- [ ] Repeated aborts do not create overlapping embedder calls.
- [ ] `docs/IMPLEMENTATION.md` no longer claims search drains the full pending backlog.
