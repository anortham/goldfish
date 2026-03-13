# Semantic Recall Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Phase 1 compatible rollout of semantic recall: digest-backed hybrid ranking, bounded opportunistic indexing, and more token-efficient search output without breaking the current `RecallResult` contract.

**Architecture:** Add three focused modules: a digest builder for compact retrieval text, a human-readable semantic cache under `~/.goldfish/cache/semantic/`, and a semantic runtime facade that can use a fake embedder in tests and a lazy `Transformers.js` embedder in production. Keep markdown checkpoints as the source of truth, make checkpoint saves mark semantic work as pending instead of blocking, and integrate hybrid ranking plus compact formatting only for search paths.

**Tech Stack:** TypeScript, Bun test runner, `Fuse.js`, YAML frontmatter, `@huggingface/transformers` (lazy-loaded), file locks

**Design doc:** `docs/superpowers/specs/2026-03-12-semantic-recall-design.md`

**Scope note:** This plan intentionally covers Phase 1 only. Do not expose a public `budget` parameter yet, do not flip the default `recall()` contract, and do not add WebGPU-specific logic beyond keeping the embedder interface ready for it later.

---

## File Map

**Create:**
- `src/digests.ts` - Build deterministic retrieval digests and compact search snippets from checkpoints
- `src/semantic-cache.ts` - Manage human-readable semantic cache files, stale/pending state, and locked writes
- `src/semantic.ts` - Semantic runtime interfaces, cosine scoring, bounded maintenance, and hybrid ranking helpers
- `src/transformers-embedder.ts` - Lazy `Transformers.js` production embedder behind a small interface
- `tests/digests.test.ts` - Digest construction and truncation tests
- `tests/semantic-cache.test.ts` - Cache manifest/record round-trip and staleness tests
- `tests/semantic.test.ts` - Hybrid ranking and bounded maintenance tests
- `tests/transformers-embedder.test.ts` - Lazy loader and fallback tests without downloading a model

**Modify:**
- `src/workspace.ts` - Add global cache path helpers for semantic state and model cache location
- `src/checkpoints.ts` - Build digest metadata and mark cache records pending after checkpoint save
- `src/recall.ts` - Call hybrid ranking for search, preserve the current `RecallResult` shape, and keep lexical fallback paths intact
- `src/handlers/recall.ts` - Use compact search formatting for non-`full` search responses while keeping the existing markdown sections
- `src/types.ts` - Add internal-only semantic runtime hooks needed for deterministic recall tests
- `package.json` - Add the `@huggingface/transformers` dependency
- `bun.lock` - Record the lazy embedder dependency resolution
- `bun.lock` - Record the lazy embedder dependency resolution
- `tests/workspace.test.ts` - Cover semantic cache path helpers
- `tests/checkpoints.test.ts` - Cover pending semantic record updates during checkpoint save
- `tests/recall.test.ts` - Cover wording-mismatch, lexical fallback, compact search descriptions, and cross-workspace ranking
- `tests/handlers.test.ts` - Cover token-efficient search formatting and `full: true` escape hatch behavior
- `README.md` - Document semantic recall cache and compact search behavior
- `docs/IMPLEMENTATION.md` - Document new modules and search flow
- `CLAUDE.md` - Update architecture and testing notes for future agents

---

## Chunk 1: Digest and Cache Foundation

### Task 1: Add semantic cache path helpers

**Files:**
- Modify: `tests/workspace.test.ts`
- Modify: `src/workspace.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe('semantic cache paths', ...)` block to `tests/workspace.test.ts` that covers the new helpers:

```typescript
import {
  normalizeWorkspace,
  getMemoriesDir,
  getPlansDir,
  ensureMemoriesDir,
  resolveWorkspace,
  getGoldfishHomeDir,
  getModelCacheDir,
  getSemanticWorkspaceKey,
  getSemanticCacheDir
} from '../src/workspace'

describe('semantic cache paths', () => {
  const originalHome = process.env.HOME

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
  })

  it('stores semantic cache under ~/.goldfish/cache/semantic', () => {
    process.env.HOME = '/tmp/goldfish-home'
    expect(getGoldfishHomeDir()).toBe('/tmp/goldfish-home/.goldfish')
    expect(getModelCacheDir()).toBe('/tmp/goldfish-home/.goldfish/models/transformers')
    expect(getSemanticCacheDir('/repo/app')).toMatch(/\/\.goldfish\/cache\/semantic\//)
  })

  it('normalizes relative and absolute workspace paths to the same key', () => {
    expect(getSemanticWorkspaceKey('/repo/app')).toBe(getSemanticWorkspaceKey('/repo/../repo/app'))
  })

  it('uses a stable workspace key derived from the normalized absolute path', () => {
    expect(getSemanticWorkspaceKey('/repo/a')).toBe(getSemanticWorkspaceKey('/repo/a'))
    expect(getSemanticWorkspaceKey('/repo/a')).not.toBe(getSemanticWorkspaceKey('/repo/b'))
  })
})
```

- [ ] **Step 2: Run the test file to verify failure**

Run: `bun test tests/workspace.test.ts`
Expected: FAIL because the new helpers are not exported yet.

- [ ] **Step 3: Implement the helpers in `src/workspace.ts`**

Add small, focused helpers near the existing path utilities:

```typescript
import { join, resolve } from 'path'
import { tmpdir } from 'os'

export function getGoldfishHomeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || tmpdir()
  return join(home, '.goldfish')
}

export function getModelCacheDir(): string {
  return join(getGoldfishHomeDir(), 'models', 'transformers')
}

export function getSemanticWorkspaceKey(projectPath: string): string {
  const normalized = resolve(projectPath)
  return new Bun.CryptoHasher('sha256')
    .update(normalized)
    .digest('hex')
    .slice(0, 12)
}

export function getSemanticCacheDir(projectPath?: string): string {
  const resolved = resolveWorkspace(projectPath)
  return join(getGoldfishHomeDir(), 'cache', 'semantic', getSemanticWorkspaceKey(resolved))
}
```

- [ ] **Step 4: Re-run the workspace tests**

Run: `bun test tests/workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts tests/workspace.test.ts
git commit -m "feat: add semantic cache path helpers"
```

### Task 2: Create the retrieval digest builder

**Files:**
- Create: `tests/digests.test.ts`
- Create: `src/digests.ts`

- [ ] **Step 1: Write the failing digest tests**

Create `tests/digests.test.ts` with these cases:

```typescript
import { describe, it, expect } from 'bun:test'
import type { Checkpoint } from '../src/types'
import { buildRetrievalDigest, buildCompactSearchDescription, DIGEST_VERSION } from '../src/digests'

it('exports a versioned digest format', () => {
  expect(DIGEST_VERSION).toBeGreaterThan(0)
})

describe('buildRetrievalDigest', () => {
  it('prioritizes structured fields over raw markdown', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_1',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: '## Fixed auth timeout\nDetailed body that keeps going.',
      context: 'Login requests were timing out',
      decision: 'Retry token refresh once',
      impact: 'Reduced false logout reports',
      tags: ['auth', 'timeout'],
      symbols: ['refreshToken']
    }

    const digest = buildRetrievalDigest(checkpoint)
    expect(digest).toContain('Fixed auth timeout')
    expect(digest).toContain('Retry token refresh once')
    expect(digest).not.toContain('Detailed body that keeps going.')
    expect(digest.length).toBeLessThanOrEqual(600)
  })

  it('falls back to description lines when structured fields are absent', () => {
    const digest = buildRetrievalDigest({
      id: 'checkpoint_2',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'First useful line\nSecond useful line\nThird line'
    })

    expect(digest).toContain('First useful line')
    expect(digest).toContain('Second useful line')
  })
})

describe('buildCompactSearchDescription', () => {
  it('returns a short search-facing snippet', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_3',
      timestamp: '2026-03-12T10:00:00.000Z',
      description: 'Long paragraph one. Long paragraph two. Long paragraph three.',
      decision: 'Use bounded retries'
    }

    const compact = buildCompactSearchDescription(checkpoint)
    expect(compact).toContain('Use bounded retries')
    expect(compact.length).toBeLessThanOrEqual(220)
  })
})
```

- [ ] **Step 2: Run the new test file**

Run: `bun test tests/digests.test.ts`
Expected: FAIL because `src/digests.ts` does not exist yet.

- [ ] **Step 3: Implement `src/digests.ts`**

Create a focused module with deterministic helpers:

```typescript
import type { Checkpoint } from './types'

const MAX_DIGEST_LENGTH = 600
const MAX_COMPACT_DESCRIPTION = 220
export const DIGEST_VERSION = 1

export function buildRetrievalDigest(checkpoint: Checkpoint): string {
  const structured = [
    checkpoint.context,
    checkpoint.decision,
    checkpoint.impact,
    checkpoint.tags?.join(', '),
    checkpoint.symbols?.join(', '),
    checkpoint.planId,
    checkpoint.git?.branch
  ].filter(Boolean) as string[]

  const fallbackDescription = structured.length > 0
    ? [firstHeading(checkpoint.description)]
    : [firstHeading(checkpoint.description), ...firstUsefulLines(checkpoint.description, 2)]

  return clamp(joinUnique([...structured, ...fallbackDescription]), MAX_DIGEST_LENGTH)
}

export function buildCompactSearchDescription(checkpoint: Checkpoint): string {
  const compact = [checkpoint.decision, checkpoint.impact, buildRetrievalDigest(checkpoint)]
    .filter(Boolean)
    .join(' | ')

  return clamp(compact, MAX_COMPACT_DESCRIPTION)
}
```

Keep helper functions private: heading extraction, useful-line selection, whitespace normalization, dedupe, and truncation.

- [ ] **Step 4: Re-run the digest tests**

Run: `bun test tests/digests.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/digests.ts tests/digests.test.ts
git commit -m "feat: add retrieval digest builder"
```

### Task 3: Create the semantic cache module

**Files:**
- Create: `tests/semantic-cache.test.ts`
- Create: `src/semantic-cache.ts`

- [ ] **Step 1: Write the failing cache tests**

Create `tests/semantic-cache.test.ts` covering the human-readable cache format:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadSemanticState,
  upsertPendingSemanticRecord,
  markSemanticRecordReady,
  invalidateSemanticRecordsForModelVersion
} from '../src/semantic-cache'

let workspace: string

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'goldfish-semantic-cache-'))
})

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true })
})

it('creates a pending record with digest metadata', async () => {
  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 1
  })

  const state = await loadSemanticState(workspace)
  expect(state.records[0]!.status).toBe('pending')
  expect(state.records[0]!.digest).toBe('auth timeout fix')
  expect(state.manifest.checkpoints.checkpoint_1.checkpointTimestamp).toBe('2026-03-12T10:00:00.000Z')
  expect(state.manifest.checkpoints.checkpoint_1.digestVersion).toBe(1)
})

it('marks an existing record ready with an embedding', async () => {
  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 1
  })

  await markSemanticRecordReady(workspace, 'checkpoint_1', [0.1, 0.2], {
    id: 'mixedbread-ai/mxbai-embed-xsmall-v1',
    version: '1'
  })

  const state = await loadSemanticState(workspace)
  expect(state.records[0]!.status).toBe('ready')
  expect(state.records[0]!.embedding).toEqual([0.1, 0.2])
  expect(state.manifest.checkpoints.checkpoint_1.dimensions).toBe(2)
  expect(state.manifest.checkpoints.checkpoint_1.modelVersion).toBe('1')
  expect(state.manifest.checkpoints.checkpoint_1.indexedAt).toBeDefined()
})

it('records a stale reason when the digest hash changes', async () => {
  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 1
  })

  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix with more detail',
    digestHash: 'hash-2',
    digestVersion: 1
  })

  const state = await loadSemanticState(workspace)
  expect(state.records[0]!.status).toBe('pending')
  expect(state.records[0]!.staleReason).toBe('digest-hash')
})

it('records a stale reason when the digest version changes', async () => {
  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 1
  })

  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 2
  })

  const state = await loadSemanticState(workspace)
  expect(state.records[0]!.status).toBe('pending')
  expect(state.records[0]!.staleReason).toBe('digest-version')
})

it('invalidates ready records when the model version changes', async () => {
  await upsertPendingSemanticRecord(workspace, {
    checkpointId: 'checkpoint_1',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'auth timeout fix',
    digestHash: 'hash-1',
    digestVersion: 1
  })

  await markSemanticRecordReady(workspace, 'checkpoint_1', [0.1, 0.2], {
    id: 'mixedbread-ai/mxbai-embed-xsmall-v1',
    version: '1'
  })
  await invalidateSemanticRecordsForModelVersion(workspace, {
    id: 'mixedbread-ai/mxbai-embed-xsmall-v1',
    version: '2'
  })

  const state = await loadSemanticState(workspace)
  expect(state.records[0]!.status).toBe('stale')
  expect(state.records[0]!.staleReason).toBe('model-version')
})
```

- [ ] **Step 2: Run the new cache tests**

Run: `bun test tests/semantic-cache.test.ts`
Expected: FAIL because `src/semantic-cache.ts` does not exist yet.

- [ ] **Step 3: Implement `src/semantic-cache.ts`**

Create a small persistence layer with explicit types:

```typescript
export interface SemanticRecord {
  checkpointId: string
  digest: string
  digestHash: string
  status: 'pending' | 'ready' | 'stale'
  embedding?: number[]
  staleReason?: 'digest-hash' | 'digest-version' | 'model-version'
  updatedAt: string
}

export interface SemanticState {
  manifest: {
    version: 1
    digestVersion: number
    updatedAt: string
    checkpoints: Record<string, {
      checkpointTimestamp: string
      digestHash: string
      digestVersion: number
      modelId?: string
      modelVersion?: string
      dimensions?: number
      indexedAt?: string
    }>
  }
  records: SemanticRecord[]
}
```

Implement:

- `loadSemanticState(workspace: string): Promise<SemanticState>`
- `upsertPendingSemanticRecord(workspace: string, input: { checkpointId: string; checkpointTimestamp: string; digest: string; digestHash: string; digestVersion: number }): Promise<void>`
- `markSemanticRecordReady(workspace: string, checkpointId: string, embedding: number[], model: { id: string; version: string }): Promise<void>`
- `invalidateSemanticRecordsForModelVersion(workspace: string, model: { id: string; version: string }): Promise<void>`

Rules:

- keep per-checkpoint rebuild metadata in `manifest.checkpoints[checkpointId]`
- if `digestHash` changes, rewrite the record to `pending` with `staleReason: 'digest-hash'`
- if `digestVersion` changes, rewrite the record to `pending` with `staleReason: 'digest-version'`
- when a record becomes ready, store `dimensions`, `indexedAt`, `modelId`, and explicit `modelVersion` in the manifest entry
- if the pinned model version changes, `invalidateSemanticRecordsForModelVersion()` marks old ready records `stale` with `staleReason: 'model-version'`
- write `manifest.json` and `records.jsonl` with atomic write-then-rename under the cache lock

Write `manifest.json` plus `records.jsonl` under the semantic cache directory, and use `withLock()` on the cache directory before writes.

- [ ] **Step 4: Re-run the cache tests**

Run: `bun test tests/semantic-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/semantic-cache.ts tests/semantic-cache.test.ts
git commit -m "feat: add human-readable semantic cache"
```

### Task 4: Mark semantic work pending on checkpoint save

**Files:**
- Modify: `tests/checkpoints.test.ts`
- Modify: `src/checkpoints.ts`

- [ ] **Step 1: Write failing checkpoint-save tests**

Add these tests to `tests/checkpoints.test.ts`:

```typescript
import { loadSemanticState } from '../src/semantic-cache'
import { __setSemanticQueueForTests } from '../src/checkpoints'

it('creates a pending semantic record after checkpoint save', async () => {
  const checkpoint = await saveCheckpoint({
    description: 'Fixed auth timeout by retrying token refresh once',
    decision: 'Retry token refresh once',
    workspace: tempDir
  })

  const state = await loadSemanticState(tempDir)
  const record = state.records.find(entry => entry.checkpointId === checkpoint.id)

  expect(record).toBeDefined()
  expect(record!.status).toBe('pending')
  expect(record!.digest).toContain('Retry token refresh once')
})

it('does not fail checkpoint save when semantic cache update throws', async () => {
  __setSemanticQueueForTests(async () => {
    throw new Error('boom')
  })

  const checkpoint = await saveCheckpoint({ description: 'Still save the checkpoint', workspace: tempDir })
  expect(checkpoint.id).toContain('checkpoint_')

  __setSemanticQueueForTests(null)
})
```

- [ ] **Step 2: Run the checkpoint tests**

Run: `bun test tests/checkpoints.test.ts`
Expected: FAIL because checkpoint saves do not touch semantic state yet.

- [ ] **Step 3: Implement the save-path integration**

In `src/checkpoints.ts`:

```typescript
import { buildRetrievalDigest } from './digests'
import { upsertPendingSemanticRecord } from './semantic-cache'
import { DIGEST_VERSION } from './digests'

let queueSemanticIndexUpdate = upsertPendingSemanticRecord

export function __setSemanticQueueForTests(
  fn: typeof upsertPendingSemanticRecord | null
): void {
  queueSemanticIndexUpdate = fn ?? upsertPendingSemanticRecord
}

// after the checkpoint file is written successfully
const digest = buildRetrievalDigest(checkpoint)
const digestHash = new Bun.CryptoHasher('sha256').update(digest).digest('hex')

await queueSemanticIndexUpdate(projectPath, {
  checkpointId: checkpoint.id,
  checkpointTimestamp: checkpoint.timestamp,
  digest,
  digestHash,
  digestVersion: DIGEST_VERSION
}).catch(() => {
  // semantic indexing is best-effort; do not fail checkpoint saves
})
```

Only mark work pending after the canonical checkpoint write succeeds. Await the pending-record write so the save path remains deterministic for tests; the heavy work is still deferred because no embeddings are computed here.

- [ ] **Step 4: Re-run the checkpoint tests**

Run: `bun test tests/checkpoints.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/checkpoints.ts tests/checkpoints.test.ts
git commit -m "feat: mark semantic work pending on checkpoint save"
```

---

## Chunk 2: Hybrid Ranking and Bounded Maintenance

### Task 5: Build the semantic runtime with fake-embedder tests

**Files:**
- Modify: `src/types.ts`
- Create: `tests/semantic.test.ts`
- Create: `src/semantic.ts`

- [ ] **Step 1: Write failing semantic runtime tests**

Create `tests/semantic.test.ts` with deterministic fake vectors:

```typescript
import { describe, it, expect } from 'bun:test'
import type { Checkpoint } from '../src/types'
import { buildHybridRanking, processPendingSemanticWork } from '../src/semantic'

const checkpoints: Checkpoint[] = [
  {
    id: 'checkpoint_a',
    timestamp: '2026-03-12T10:00:00.000Z',
    description: 'Fixed login timeout by retrying token refresh once',
    tags: ['auth']
  },
  {
    id: 'checkpoint_b',
    timestamp: '2026-03-12T09:00:00.000Z',
    description: 'Refactored database pool sizing',
    tags: ['database']
  }
]

it('lets semantic similarity rescue wording mismatches', async () => {
  const runtime = {
    async embedTexts(texts: string[]) {
      return texts.map(text => text.includes('session expiry') ? [1, 0] : text.includes('token refresh') ? [1, 0] : [0, 1])
    },
    isReady() { return true }
  }

  const ranked = await buildHybridRanking({
    query: 'session expiry failure',
    checkpoints,
    lexicalOrder: checkpoints,
    digests: new Map([
      ['checkpoint_a', 'retry token refresh once'],
      ['checkpoint_b', 'database pool sizing']
    ]),
    runtime
  })

  expect(ranked[0]!.id).toBe('checkpoint_a')
})

it('processes at most the bounded amount of pending work', async () => {
  const processed: string[] = []
  let now = 0

  await processPendingSemanticWork({
    pending: [
      { checkpointId: 'a', digest: 'one', digestHash: '1', status: 'pending', updatedAt: '2026-03-12T00:00:00.000Z' },
      { checkpointId: 'b', digest: 'two', digestHash: '2', status: 'pending', updatedAt: '2026-03-12T00:00:00.000Z' },
      { checkpointId: 'c', digest: 'three', digestHash: '3', status: 'pending', updatedAt: '2026-03-12T00:00:00.000Z' },
      { checkpointId: 'd', digest: 'four', digestHash: '4', status: 'pending', updatedAt: '2026-03-12T00:00:00.000Z' }
    ],
    maxItems: 3,
    maxMs: 150,
    now: () => now,
    embed: async record => {
      processed.push(record.checkpointId)
      now += 80
      return [0.5, 0.5]
    },
    save: async () => {}
  })

  expect(processed).toEqual(['a', 'b'])
})
```

- [ ] **Step 2: Run the semantic runtime tests**

Run: `bun test tests/semantic.test.ts`
Expected: FAIL because `src/semantic.ts` does not exist yet.

- [ ] **Step 3: Implement `src/types.ts` and `src/semantic.ts`**

Add internal-only semantic types to `src/types.ts` so the base type module stays dependency-free:

```typescript
// src/types.ts
export interface SemanticRuntime {
  isReady(): boolean
  embedTexts(texts: string[]): Promise<number[][]>
}

export interface RecallOptions {
  // existing public fields...
  _semanticRuntime?: SemanticRuntime
}
```

Implement `src/semantic.ts` with explicit seams:

```typescript
export async function buildHybridRanking(args: {
  query: string
  checkpoints: Checkpoint[]
  lexicalOrder: Checkpoint[]
  digests: Map<string, string>
  readyRecords: Map<string, SemanticRecord>
  runtime?: SemanticRuntime
}): Promise<Checkpoint[]> { /* merge lexical rank + semantic similarity + recency */ }

export async function processPendingSemanticWork(args: {
  pending: SemanticRecord[]
  maxItems: number
  maxMs: number
  now?: () => number
  embed: (record: SemanticRecord) => Promise<number[]>
  save: (checkpointId: string, embedding: number[]) => Promise<void>
}): Promise<void> { /* bounded maintenance loop */ }
```

Keep the merge policy simple and testable:

- exact lexical winners stay strong
- semantic similarity can lift wording-mismatch matches
- recency is only a mild tiebreaker
- add lightweight metadata boosts for matching `planId`, overlapping tags, overlapping symbols, and shared git branch/thread when those fields exist
- if a signal is intentionally skipped in Phase 1, document it inline next to the scoring code rather than silently dropping it

- [ ] **Step 4: Re-run the semantic runtime tests**

Run: `bun test tests/semantic.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/semantic.ts tests/semantic.test.ts
git commit -m "feat: add hybrid semantic ranking runtime"
```

### Task 6: Integrate hybrid ranking into `recall()`

**Files:**
- Modify: `tests/recall.test.ts`
- Modify: `src/recall.ts`

- [ ] **Step 1: Write failing recall integration tests**

Add tests to `tests/recall.test.ts` for the new search path:

```typescript
it('rescues wording mismatches with semantic ranking when a runtime is provided', async () => {
  await saveCheckpoint({
    description: 'Retry token refresh once to avoid login timeout',
    workspace: TEST_DIR_A,
    tags: ['auth']
  })

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'session expiry issue',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async texts => texts.map(text => text.includes('session expiry') || text.includes('token refresh') ? [1, 0] : [0, 1])
    }
  })

  expect(result.checkpoints[0]!.description).toContain('token refresh')
})

it('keeps exact lexical matches ahead of vague semantic ones', async () => {
  await saveCheckpoint({ description: 'Auth middleware fix', workspace: TEST_DIR_A, tags: ['auth'] })
  await saveCheckpoint({ description: 'Retry token refresh once to avoid login timeout', workspace: TEST_DIR_A })

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'auth',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async texts => texts.map(text => text.includes('token refresh') ? [1, 0] : [0, 1])
    }
  })

  expect(result.checkpoints[0]!.description).toContain('Auth middleware fix')
})

it('keeps cross-workspace search results in relevance order instead of timestamp order', async () => {
  const projectA = await mkdtemp(join(tmpdir(), 'semantic-order-a-'))
  const projectB = await mkdtemp(join(tmpdir(), 'semantic-order-b-'))
  const registryDir = await mkdtemp(join(tmpdir(), 'semantic-order-registry-'))
  await ensureMemoriesDir(projectA)
  await ensureMemoriesDir(projectB)

  await saveCheckpoint({ description: 'Database tuning note', workspace: projectA })
  await saveCheckpoint({ description: 'Retry token refresh once', workspace: projectB })

  const { registerProject } = await import('../src/registry')
  await registerProject(projectA, registryDir)
  await registerProject(projectB, registryDir)

  const result = await recall({
    workspace: 'all',
    search: 'session expiry issue',
    _registryDir: registryDir,
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async texts => texts.map(text => text.includes('session expiry') || text.includes('token refresh') ? [1, 0] : [0, 1])
    }
  })

  expect(result.checkpoints[0]!.description).toContain('token refresh')
})

it('filters by planId before lexical and semantic ranking', async () => {
  await saveCheckpoint({ description: 'Retry token refresh once from old work', workspace: TEST_DIR_A })
  await savePlan({ id: 'auth-plan', title: 'Auth', content: 'Content', workspace: TEST_DIR_A, activate: true })
  await saveCheckpoint({ description: 'Retry token refresh once', workspace: TEST_DIR_A })

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'session expiry issue',
    planId: 'auth-plan',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async texts => texts.map(text => text.includes('session expiry') || text.includes('token refresh') ? [1, 0] : [0, 1])
    }
  })

  expect(result.checkpoints.every(cp => cp.planId === 'auth-plan')).toBe(true)
  expect(result.checkpoints).toHaveLength(1)
})
```

- [ ] **Step 2: Run the recall tests**

Run: `bun test tests/recall.test.ts`
Expected: FAIL because `recall()` still uses lexical-only ranking and cross-workspace search sorting.

- [ ] **Step 3: Implement hybrid ranking in `src/recall.ts`**

Refactor carefully:

```typescript
import { buildRetrievalDigest, buildCompactSearchDescription } from './digests'
import { loadSemanticState } from './semantic-cache'
import { buildHybridRanking } from './semantic'

if (options.search) {
  if (options.planId) {
    checkpoints = checkpoints.filter(cp => cp.planId === options.planId)
  }

  const digests = new Map(checkpoints.map(checkpoint => [checkpoint.id, buildRetrievalDigest(checkpoint)]))
  const lexical = searchCheckpointDigests(options.search, checkpoints, digests)
  const semanticState = await loadSemanticState(workspace)
  const readyRecords = new Map(
    semanticState.records
      .filter(record => record.status === 'ready' && record.embedding)
      .map(record => [record.checkpointId, record])
  )

  checkpoints = await buildHybridRanking({
    query: options.search,
    checkpoints,
    lexicalOrder: lexical,
    digests,
    readyRecords,
    runtime: options._semanticRuntime
  })
}
```

Add a small helper such as `searchCheckpointDigests()` inside `src/recall.ts` so Fuse ranks digest text rather than full checkpoint bodies.

Then make Phase 1 token savings real without changing the result shape:

- for non-`full` search results, replace `description` with `buildCompactSearchDescription(checkpoint)`
- keep `full: true` search behavior unchanged
- preserve active plan and workspace summary behavior
- keep `limit` behavior identical
- apply `planId` filtering before digest building, lexical ranking, and semantic ranking
- for `workspace: 'all'` plus `search`, gather candidates first and run one global hybrid rerank before tagging workspaces and slicing `limit`
- preserve relevance order for cross-workspace searches; only non-search cross-workspace recall should sort by timestamp

- [ ] **Step 4: Re-run the recall tests**

Run: `bun test tests/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "feat: add hybrid semantic ranking to recall"
```

### Task 7: Add bounded maintenance to the search path

**Files:**
- Modify: `tests/recall.test.ts`
- Modify: `src/recall.ts`
- Modify: `src/semantic-cache.ts`

- [ ] **Step 1: Add failing maintenance-bound tests**

Extend `tests/recall.test.ts` with explicit failing tests like these:

```typescript
it('processes at most three pending semantic records per warm search call', async () => {
  for (let i = 0; i < 5; i++) {
    await upsertPendingSemanticRecord(TEST_DIR_A, {
      checkpointId: `checkpoint_${i}`,
      checkpointTimestamp: '2026-03-12T10:00:00.000Z',
      digest: `auth digest ${i}`,
      digestHash: `hash-${i}`,
      digestVersion: 1
    })
  }

  await recall({
    workspace: TEST_DIR_A,
    search: 'auth',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async texts => texts.map(() => [1, 0])
    }
  })

  const state = await loadSemanticState(TEST_DIR_A)
  expect(state.records.filter(record => record.status === 'ready')).toHaveLength(3)
})

it('skips maintenance on plain recall without a search query', async () => {
  await upsertPendingSemanticRecord(TEST_DIR_A, {
    checkpointId: 'checkpoint_plain',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'plain recall digest',
    digestHash: 'plain-hash',
    digestVersion: 1
  })

  await recall({ workspace: TEST_DIR_A })

  const state = await loadSemanticState(TEST_DIR_A)
  expect(state.records[0]!.status).toBe('pending')
})

it('does not run maintenance on the first cold search call even if ranking warms the runtime', async () => {
  let warm = false
  await upsertPendingSemanticRecord(TEST_DIR_A, {
    checkpointId: 'checkpoint_cold',
    checkpointTimestamp: '2026-03-12T10:00:00.000Z',
    digest: 'cold runtime digest',
    digestHash: 'cold-hash',
    digestVersion: 1
  })

  await recall({
    workspace: TEST_DIR_A,
    search: 'cold runtime',
    _semanticRuntime: {
      isReady: () => warm,
      embedTexts: async texts => {
        warm = true
        return texts.map(() => [1, 0])
      }
    }
  })

  const state = await loadSemanticState(TEST_DIR_A)
  expect(state.records[0]!.status).toBe('pending')
})

it('preserves lexical results when some embeddings are missing', async () => {
  await saveCheckpoint({ description: 'Auth middleware fix', workspace: TEST_DIR_A, tags: ['auth'] })
  await saveCheckpoint({ description: 'Retry token refresh once', workspace: TEST_DIR_A })

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'auth',
    _semanticRuntime: {
      isReady: () => false,
      embedTexts: async () => [[1, 0]]
    }
  })

  expect(result.checkpoints.length).toBeGreaterThan(0)
  expect(result.checkpoints[0]!.description).toContain('Auth middleware fix')
})
```

Use a fake `_semanticRuntime` plus pre-seeded semantic cache state so the assertions stay deterministic.

Add one explicit time-budget test using the fake `now()` hook from `processPendingSemanticWork()` so the `150 ms` safety bound is pinned in addition to the `maxItems` bound.

- [ ] **Step 2: Run the targeted recall tests**

Run: `bun test tests/recall.test.ts -t "maintenance"`
Expected: FAIL because recall never attempts bounded maintenance yet.

- [ ] **Step 3: Implement the bounded maintenance pass**

In `src/semantic-cache.ts`, add a helper to list pending records:

```typescript
export async function listPendingSemanticRecords(workspace: string): Promise<SemanticRecord[]> {
  const state = await loadSemanticState(workspace)
  return state.records.filter(record => record.status === 'pending')
}
```

In `src/recall.ts`, create the runtime once at the start of the search flow, snapshot whether it was already warm, use it for hybrid ranking, and only then attempt bounded maintenance if it was warm before the call started:

```typescript
const runtime = options._semanticRuntime ?? getDefaultSemanticRuntime()
const wasWarm = runtime.isReady()

// use runtime for buildHybridRanking first

if (wasWarm) {
  await processPendingSemanticWork({
    pending: await listPendingSemanticRecords(workspace),
    maxItems: 3,
    maxMs: 150,
    embed: async record => runtime.embedTexts([record.digest]).then(v => v[0]!),
    save: async (checkpointId, embedding) => {
      await markSemanticRecordReady(workspace, checkpointId, embedding, {
        id: 'mixedbread-ai/mxbai-embed-xsmall-v1',
        version: '1'
      })
    }
  })
}
```

If anything in maintenance throws, swallow it and continue with lexical/hybrid results from already-available data.

- [ ] **Step 4: Re-run the maintenance tests**

Run: `bun test tests/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/semantic-cache.ts src/recall.ts tests/recall.test.ts
git commit -m "feat: bound semantic maintenance during search"
```

---

## Chunk 3: Compact Output, Runtime Integration, and Docs

### Task 8: Apply tighter default search limits in the handler

**Files:**
- Modify: `tests/handlers.test.ts`
- Modify: `src/handlers/recall.ts`

- [ ] **Step 1: Write failing handler tests**

Add search-specific token-efficiency tests to `tests/handlers.test.ts`:

```typescript
it('uses a tighter default limit for non-full search responses', async () => {
  for (let i = 0; i < 5; i++) {
    await saveCheckpoint({ description: `Auth result ${i}`, workspace: TEST_DIR, tags: ['auth'] })
  }

  const result = await handleRecall({ workspace: TEST_DIR, search: 'auth' })
  const text = result.content[0]!.text

  expect((text.match(/### /g) || []).length).toBe(3)
})

it('does not override an explicit limit', async () => {
  const result = await handleRecall({ workspace: TEST_DIR, search: 'auth', limit: 4 })
  const text = result.content[0]!.text

  expect((text.match(/### /g) || []).length).toBe(4)
})

it('does not tighten full search responses', async () => {
  const compact = await handleRecall({ workspace: TEST_DIR, search: 'auth' })
  const full = await handleRecall({ workspace: TEST_DIR, search: 'auth', full: true })

  expect(full.content[0]!.text.length).toBeGreaterThan(compact.content[0]!.text.length)
})
```

- [ ] **Step 2: Run the handler tests**

Run: `bun test tests/handlers.test.ts`
Expected: FAIL because the handler still forwards the default limit of 5 for search requests.

- [ ] **Step 3: Implement tighter handler presets in `src/handlers/recall.ts`**

Keep the current response structure. Let `src/recall.ts` own compact descriptions, and use the handler only for Phase 1 budget presets:

```typescript
const recallArgs = args.search && !args.full && args.limit === undefined
  ? { ...args, limit: 3 }
  : args

const result = await recallFunc(recallArgs)
```

Do not duplicate snippet-clamping logic in the handler. Phase 1 compact descriptions come from `src/recall.ts`.

- [ ] **Step 4: Re-run the handler tests**

Run: `bun test tests/handlers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/handlers/recall.ts tests/handlers.test.ts
git commit -m "feat: tighten default search limit in recall handler"
```

### Task 9: Add the lazy `Transformers.js` embedder

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `tests/transformers-embedder.test.ts`
- Modify: `tests/recall.test.ts`
- Create: `src/transformers-embedder.ts`
- Modify: `src/recall.ts`

- [ ] **Step 1: Write failing embedder tests**

Create `tests/transformers-embedder.test.ts` with a fake pipeline loader so no model download happens in test:

```typescript
import { describe, it, expect } from 'bun:test'
import { createTransformersEmbedder } from '../src/transformers-embedder'

it('lazy-loads the pipeline on first embed request', async () => {
  let loadCount = 0

  const embedder = createTransformersEmbedder({
    loadPipeline: async () => {
      loadCount++
      return async (texts: string[]) => ({
        tolist: () => texts.map(() => [0.1, 0.2, 0.3])
      })
    }
  })

  expect(embedder.isReady()).toBe(false)
  const vectors = await embedder.embedTexts(['hello'])
  expect(loadCount).toBe(1)
  expect(vectors).toEqual([[0.1, 0.2, 0.3]])
})

it('surfaces a false-ready runtime after loader failure', async () => {
  const embedder = createTransformersEmbedder({
    loadPipeline: async () => {
      throw new Error('offline')
    }
  })

  await expect(embedder.embedTexts(['hello'])).rejects.toThrow('offline')
  expect(embedder.isReady()).toBe(false)
})
```

Also add a recall-level regression test in `tests/recall.test.ts`:

```typescript
it('falls back to lexical search when semantic embedding fails', async () => {
  await saveCheckpoint({ description: 'Auth middleware fix', workspace: TEST_DIR_A, tags: ['auth'] })

  const result = await recall({
    workspace: TEST_DIR_A,
    search: 'auth',
    _semanticRuntime: {
      isReady: () => true,
      embedTexts: async () => {
        throw new Error('offline')
      }
    }
  })

  expect(result.checkpoints[0]!.description).toContain('Auth middleware fix')
})
```

- [ ] **Step 2: Run the embedder tests**

Run: `bun test tests/transformers-embedder.test.ts tests/recall.test.ts`
Expected: FAIL because the embedder module and dependency do not exist yet.

- [ ] **Step 3: Add the dependency and implement the embedder**

Update `package.json`:

```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.0.0",
    "@modelcontextprotocol/sdk": "^1.26.0",
    "fuse.js": "^7.0.0",
    "yaml": "^2.8.2"
  }
}
```

Then run: `bun install`

Expected: `bun.lock` updates to include `@huggingface/transformers`.

Create `src/transformers-embedder.ts` with a module-scoped singleton and external cache location:

```typescript
import type { SemanticRuntime } from './types'
import { getModelCacheDir } from './workspace'

const MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1'
let defaultRuntime: SemanticRuntime | null = null

export function getDefaultSemanticRuntime(): SemanticRuntime {
  if (!defaultRuntime) defaultRuntime = createTransformersEmbedder()
  return defaultRuntime
}

export function createTransformersEmbedder(deps?: {
  loadPipeline?: () => Promise<(texts: string[], options?: Record<string, unknown>) => Promise<{ tolist(): number[][] }>>
}): SemanticRuntime {
  let extractor: ((texts: string[], options?: Record<string, unknown>) => Promise<{ tolist(): number[][] }>) | null = null

  async function ensureExtractor() {
    if (extractor) return extractor
    extractor = deps?.loadPipeline ? await deps.loadPipeline() : await defaultLoadPipeline()
    return extractor
  }

  return {
    isReady: () => extractor !== null,
    async embedTexts(texts: string[]) {
      const run = await ensureExtractor()
      const output = await run(texts, { pooling: 'mean', normalize: true })
      return output.tolist()
    }
  }
}
```

Reuse the `getModelCacheDir()` helper added in Task 1; do not add a second cache-path implementation here.

Inside `defaultLoadPipeline()`, configure `@huggingface/transformers` to use `getModelCacheDir()` so model artifacts live under `~/.goldfish/models/transformers` instead of the project workspace.

Wire it into `src/recall.ts` so `options._semanticRuntime ?? getDefaultSemanticRuntime()` is used for search.

Wrap hybrid ranking in a fallback guard:

```typescript
try {
  checkpoints = await buildHybridRanking(/* ... */)
} catch {
  checkpoints = lexical
}
```

That guard is the Phase 1 contract: semantic failures may reduce ranking quality, but they must not fail `recall()`.

- [ ] **Step 4: Re-run the embedder tests**

Run: `bun test tests/transformers-embedder.test.ts tests/recall.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/transformers-embedder.ts src/recall.ts tests/transformers-embedder.test.ts tests/recall.test.ts
git commit -m "feat: add lazy transformers embedder"
```

### Task 10: Update docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/IMPLEMENTATION.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write doc updates**

Update:

- `README.md` to explain semantic recall is built in, the cache lives under `~/.goldfish/cache/semantic/`, and search results are compact by default unless `full: true`
- `docs/IMPLEMENTATION.md` to add the new modules and the Phase 1 hybrid search flow
- `CLAUDE.md` to reflect the new modules, runtime dependency count, and the fact that semantic cache files are derived JSON/JSONL outside `.memories/`

- [ ] **Step 2: Run focused regression tests**

Run: `bun test tests/workspace.test.ts tests/checkpoints.test.ts tests/digests.test.ts tests/semantic-cache.test.ts tests/semantic.test.ts tests/transformers-embedder.test.ts tests/recall.test.ts tests/handlers.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full test suite**

Run: `bun test`
Expected: PASS.

- [ ] **Step 4: Run the type checker**

Run: `bunx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/IMPLEMENTATION.md CLAUDE.md
git commit -m "docs: document semantic recall phase 1"
```

---

## Post-Plan Notes

- Do not expose `budget` in `src/tools.ts` or `src/types.ts` during this plan
- Do not add WebGPU-specific branching yet; keep the embedder interface ready for a later plan
- If `@huggingface/transformers` proves too large or too flaky in Bun, stop after Task 9, capture the failure in a checkpoint, and open a follow-up plan for a lighter built-in embedder
