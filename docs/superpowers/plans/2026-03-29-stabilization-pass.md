# Goldfish v6.5.0 Stabilization Pass

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs, extract ranking module, type handler args, update stale docs, clean TODO.md, and bump to v6.5.0.

**Architecture:** Seven sequential commits. Tier 1 (bugs) first, then Tier 2 (quality). Each task is independently testable. The ranking extraction touches `semantic.ts` and `recall.ts`; the stale-counting fix touches `recall.ts` and `consolidate.ts`. Do these in the listed order to avoid conflicts.

**Tech Stack:** Bun, TypeScript, bun:test

---

### Task 1: Centralize Stale-Counting with 30-Day Age Filter

**Files:**
- Modify: `src/checkpoints.ts` (add exported constant)
- Modify: `hooks/count-stale.ts` (rewrite to use frontmatter timestamps + age filter)
- Modify: `src/recall.ts:571` (import shared constant)
- Modify: `src/handlers/consolidate.ts:19` (import shared constant)
- Test: `tests/checkpoints.test.ts` (new describe block for the constant export)
- Test: add a new file `tests/count-stale.test.ts` for hook counting logic

- [ ] **Step 1: Add the shared constant to `src/checkpoints.ts`**

At the top of `src/checkpoints.ts`, after the existing imports, add:

```typescript
/** Checkpoints older than this are excluded from consolidation. Shared by recall, consolidate handler, and hooks. */
export const CONSOLIDATION_AGE_LIMIT_DAYS = 30;
```

- [ ] **Step 2: Write failing test for `countStaleCheckpoints` using frontmatter timestamps**

Create `tests/count-stale.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { countStaleCheckpoints } from '../hooks/count-stale'

function writeCheckpoint(memoriesDir: string, dateStr: string, filename: string, timestamp: string) {
  const dateDir = join(memoriesDir, dateStr)
  mkdirSync(dateDir, { recursive: true })
  const content = `---\nid: checkpoint_${filename}\ntimestamp: "${timestamp}"\ntags: []\n---\n\nTest checkpoint`
  writeFileSync(join(dateDir, `${filename}.md`), content)
}

function writeConsolidationState(statePath: string, timestamp: string, count: number) {
  const { mkdirSync: mk, writeFileSync: wf } = require('fs')
  const { dirname } = require('path')
  mk(dirname(statePath), { recursive: true })
  wf(statePath, JSON.stringify({ timestamp, checkpointsConsolidated: count }))
}

describe('countStaleCheckpoints', () => {
  let tmpDir: string
  let memoriesDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'stale-test-'))
    memoriesDir = join(tmpDir, '.memories')
    mkdirSync(memoriesDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('uses frontmatter timestamp, not file mtime', () => {
    // Write a checkpoint with an old frontmatter timestamp but fresh mtime (file was just written)
    const oldTimestamp = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() // 60 days ago
    writeCheckpoint(memoriesDir, '2026-01-28', '120000_aaaa', oldTimestamp)

    // No consolidation state means all recent checkpoints are stale
    // But this one is old, so it should NOT be counted (30-day filter)
    const count = countStaleCheckpoints(memoriesDir)
    expect(count).toBe(0)
  })

  it('ignores checkpoints older than 30 days', () => {
    const now = Date.now()
    const recentTimestamp = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days ago
    const oldTimestamp = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString() // 45 days ago

    writeCheckpoint(memoriesDir, '2026-03-24', '120000_bbbb', recentTimestamp)
    writeCheckpoint(memoriesDir, '2026-02-12', '120000_cccc', oldTimestamp)

    const count = countStaleCheckpoints(memoriesDir)
    expect(count).toBe(1) // Only the recent one
  })

  it('counts only checkpoints newer than last consolidation AND within 30 days', () => {
    const now = Date.now()
    const consolidatedAt = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() // 10 days ago
    const beforeConsolidation = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString() // 15 days ago
    const afterConsolidation = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 days ago

    writeCheckpoint(memoriesDir, '2026-03-14', '120000_dddd', beforeConsolidation)
    writeCheckpoint(memoriesDir, '2026-03-26', '120000_eeee', afterConsolidation)

    // Write consolidation state to the legacy location (count-stale checks this)
    // We need to use the project path for getConsolidationStatePath
    // For this test, write to legacy location
    writeFileSync(join(memoriesDir, '.last-consolidated'), JSON.stringify({
      timestamp: consolidatedAt,
      checkpointsConsolidated: 5
    }))

    const count = countStaleCheckpoints(memoriesDir)
    expect(count).toBe(1) // Only the one after consolidation
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/count-stale.test.ts`
Expected: FAIL because `countStaleCheckpoints` still uses `mtimeMs` instead of frontmatter timestamps.

- [ ] **Step 4: Rewrite `hooks/count-stale.ts` to use frontmatter timestamps and 30-day filter**

Replace the entire file:

```typescript
/**
 * Shared utility for counting unconsolidated checkpoints.
 * Used by session-start and pre-compact hooks.
 *
 * Uses checkpoint frontmatter timestamps (not file mtime) and applies
 * the same 30-day age filter as recall and the consolidate handler.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getConsolidationStatePath } from '../src/workspace';
import { CONSOLIDATION_AGE_LIMIT_DAYS } from '../src/checkpoints';

/**
 * Extract the timestamp from a checkpoint file's YAML frontmatter.
 * Returns epoch ms, or 0 if unparseable.
 */
function readCheckpointTimestamp(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n[\s\S]*?timestamp:\s*"?([^"\n]+)"?\n[\s\S]*?---/);
    if (!match?.[1]) return 0;
    const ms = new Date(match[1]).getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

export function countStaleCheckpoints(memoriesDir: string): number {
  let staleCount = 0;
  let lastTimestamp = 0;

  const projectPath = memoriesDir.replace(/[/\\]\.memories$/, '');

  // Try new machine-local path first
  try {
    const raw = readFileSync(getConsolidationStatePath(projectPath), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch {
    // Fall back to legacy location
    try {
      const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
      const state = JSON.parse(raw);
      lastTimestamp = new Date(state.timestamp).getTime();
    } catch { /* no state */ }
  }

  const ageLimit = Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;

  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const cpTimestamp = readCheckpointTimestamp(join(dateDir, file));
        if (cpTimestamp === 0) continue;
        if (cpTimestamp >= ageLimit && cpTimestamp > lastTimestamp) {
          staleCount++;
        }
      }
    }
  } catch { /* no dirs */ }

  return staleCount;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/count-stale.test.ts`
Expected: PASS (all 3 tests)

- [ ] **Step 6: Update `src/recall.ts` to import the shared constant**

In `src/recall.ts`, add to the import from `./checkpoints`:

```typescript
import { getCheckpointsForDateRange, getAllCheckpoints, CONSOLIDATION_AGE_LIMIT_DAYS } from './checkpoints';
```

Then at line 571, replace the local constant:

```typescript
  // Remove this line:
  const CONSOLIDATION_AGE_LIMIT_DAYS = 30;
```

The `ageLimit` calculation on the next line stays as-is since it already references `CONSOLIDATION_AGE_LIMIT_DAYS`.

- [ ] **Step 7: Update `src/handlers/consolidate.ts` to import the shared constant**

In `src/handlers/consolidate.ts`, add to the import from `../checkpoints.js`:

```typescript
import { getAllCheckpoints, CONSOLIDATION_AGE_LIMIT_DAYS } from '../checkpoints.js';
```

Then remove the local constant at line 19:

```typescript
// Remove this line:
const CONSOLIDATION_AGE_LIMIT_DAYS = 30;
```

- [ ] **Step 8: Run full test suite to verify nothing broke**

Run: `bun test`
Expected: All tests pass. The constant is the same value (30), so behavior is unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/checkpoints.ts hooks/count-stale.ts src/recall.ts src/handlers/consolidate.ts tests/count-stale.test.ts
git commit -m "fix: centralize stale-counting with 30-day age filter

Hook counting was using file mtime without age filter, disagreeing with
recall and consolidate handler which use checkpoint timestamps with a
30-day window. Extracted CONSOLIDATION_AGE_LIMIT_DAYS to shared constant
and rewrote count-stale.ts to parse frontmatter timestamps."
```

---

### Task 2: Fix Registry `GOLDFISH_HOME`

**Files:**
- Modify: `src/registry.ts:27-28` (use `getGoldfishHomeDir`)
- Test: `tests/registry.test.ts` (add test for env var)

- [ ] **Step 1: Write failing test for GOLDFISH_HOME in registry**

Add to `tests/registry.test.ts`, in a new describe block:

```typescript
describe('getRegistryPath respects GOLDFISH_HOME', () => {
  const originalHome = process.env.GOLDFISH_HOME;

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.GOLDFISH_HOME = originalHome;
    } else {
      delete process.env.GOLDFISH_HOME;
    }
  });

  it('uses GOLDFISH_HOME when set', () => {
    process.env.GOLDFISH_HOME = '/custom/goldfish/home';
    const path = getRegistryPath();
    expect(path).toBe('/custom/goldfish/home/registry.json');
  });
});
```

Make sure `getRegistryPath` is exported and imported in the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/registry.test.ts -t "uses GOLDFISH_HOME"`
Expected: FAIL because `getRegistryPath` hardcodes `homedir()`.

- [ ] **Step 3: Fix `getRegistryPath` to use `getGoldfishHomeDir`**

In `src/registry.ts`, add the import:

```typescript
import { getGoldfishHomeDir } from './workspace';
```

Then change `getRegistryPath`:

```typescript
export function getRegistryPath(): string {
  return join(getGoldfishHomeDir(), 'registry.json');
}
```

And update the default in `getRegistry`:

```typescript
export async function getRegistry(registryDir?: string): Promise<Registry> {
  const dir = registryDir ?? getGoldfishHomeDir();
```

Do the same for `registerProject`, `unregisterProject`, and `listRegisteredProjects` if they also default to `join(homedir(), '.goldfish')`.

Remove the `homedir` import if no longer used.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/registry.test.ts`
Expected: All registry tests pass, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts tests/registry.test.ts
git commit -m "fix: registry respects GOLDFISH_HOME env var

getRegistryPath() was hardcoded to ~/.goldfish while all other
machine-local paths use getGoldfishHomeDir(). This created a split
brain when relocating Goldfish state via the env var."
```

---

### Task 3: Clean Up Stale Artifacts

**Files:**
- Delete: `.memories/MEMORY.md`
- Delete: `.memories/.last-consolidated`
- Modify: `.memories/.active-plan` (cleared by completing the plan)

- [ ] **Step 1: Complete the stale active plan**

Run the MCP plan tool or use the plan handler directly. The `reduce-goldfish-tool-overuse` plan is done. Complete it:

```bash
# Verify the stale active plan
cat .memories/.active-plan
# Expected: reduce-goldfish-tool-overuse
```

Use the plan tool: `plan({ action: "complete", id: "reduce-goldfish-tool-overuse" })`

This sets the plan status to `completed` and clears `.active-plan`.

- [ ] **Step 2: Delete legacy files**

```bash
rm .memories/MEMORY.md
rm .memories/.last-consolidated
```

Verify `.active-plan` was cleared (file should be gone or empty after plan completion).

- [ ] **Step 3: Run tests to verify nothing depends on these files**

Run: `bun test`
Expected: All tests pass. No production code references these files as required.

- [ ] **Step 4: Commit**

```bash
git add -A .memories/
git commit -m "chore: remove stale MEMORY.md, .last-consolidated, complete old plan

MEMORY.md superseded by memory.yaml (v6.4.0). .last-consolidated
superseded by machine-local consolidation state. Active plan
reduce-goldfish-tool-overuse was completed but still pointed to."
```

---

### Task 4: Extract Ranking Module from `semantic.ts`

**Files:**
- Create: `src/ranking.ts` (ranking logic from `semantic.ts` + `rankSearchCheckpoints` from `recall.ts`)
- Modify: `src/semantic.ts` (remove ranking code, keep only embedding/pending work)
- Modify: `src/recall.ts` (update imports, remove `rankSearchCheckpoints`)
- Modify: `src/types.ts` (add `ScoredCheckpoint`)
- Create: `tests/ranking.test.ts` (ranking tests from `tests/semantic.test.ts`)
- Modify: `tests/semantic.test.ts` (remove ranking tests)

- [ ] **Step 1: Move `ScoredCheckpoint` to `types.ts`**

Add to the end of `src/types.ts`:

```typescript
export interface ScoredCheckpoint {
  checkpoint: Checkpoint
  score: number
}
```

- [ ] **Step 2: Create `src/ranking.ts` with all ranking code from `semantic.ts`**

Create `src/ranking.ts` containing:

```typescript
import type { Checkpoint, ScoredCheckpoint, SemanticRuntime } from './types'

export interface BuildHybridRankingInput {
  query: string
  checkpoints: Checkpoint[]
  lexicalOrder: string[]
  digests: Record<string, string>
  readyRecords: ReadySemanticRecord[]
  runtime: SemanticRuntime
  queryEmbedding?: number[]
}

export interface ReadySemanticRecord {
  checkpointId: string
  embedding: number[]
}

export const MINIMUM_SEARCH_RELEVANCE = 0.15
```

Then copy the following functions from `semantic.ts` into `ranking.ts` (in order):
- `normalize` (private)
- `tokenize` (private)
- `cosineSimilarity` (private)
- `lexicalScore` (private)
- `recencyScore` (private)
- `lexicalMatchBoost` (private)
- `metadataBoost` (private)
- `buildHybridRanking` (exported)

These are lines 50-228 of `semantic.ts`. Copy them exactly as-is, except:
- Change the `ScoredCheckpoint` import to come from `./types`
- Remove the local `ScoredCheckpoint` interface (it's now in `types.ts`)
- Remove the `BuildHybridRankingInput` interface from `semantic.ts` (it's now in `ranking.ts`)
- Remove the `ReadySemanticRecord` interface from `semantic.ts` (it's now in `ranking.ts`)

Then also move `rankSearchCheckpoints` from `recall.ts` (lines 315-375) into `ranking.ts`. This function needs these imports added to `ranking.ts`:

```typescript
import Fuse from 'fuse.js'
import { buildCompactSearchDescription } from './digests'
```

And the two helpers it calls from `recall.ts`:
- `searchCheckpoints` (lines 92-122 of `recall.ts`) - move to `ranking.ts`
- `buildLexicalSearchCandidates` (lines 203-211 of `recall.ts`) - move to `ranking.ts`

Export `rankSearchCheckpoints` and `searchCheckpoints` from `ranking.ts`.

- [ ] **Step 3: Strip ranking code from `semantic.ts`**

Remove from `semantic.ts`:
- The `ReadySemanticRecord` interface (lines 3-6)
- The `BuildHybridRankingInput` interface (lines 8-16)
- The `ScoredCheckpoint` export interface (lines 18-21)
- The `MINIMUM_SEARCH_RELEVANCE` export (line 23)
- All private scoring functions: `normalize`, `tokenize`, `cosineSimilarity`, `lexicalScore`, `recencyScore`, `lexicalMatchBoost`, `metadataBoost` (lines 50-158)
- The `buildHybridRanking` export function (lines 161-228)

What remains in `semantic.ts`:
- The `PendingSemanticWorkItem` interface
- The `ProcessPendingSemanticWorkInput` interface
- The `ProcessPendingSemanticWorkResult` interface
- The `TimedEmbeddingResult` type
- The `EMBED_BATCH_SIZE` constant
- The `processPendingSemanticWork` export function

Remove the `Checkpoint` import from `semantic.ts` if no longer used. Keep `SemanticRuntime` only if `processPendingSemanticWork` uses it (it does not; it takes a plain `embed` function).

- [ ] **Step 4: Update `recall.ts` imports**

Replace:
```typescript
import { buildHybridRanking, processPendingSemanticWork, MINIMUM_SEARCH_RELEVANCE } from './semantic';
```

With:
```typescript
import { processPendingSemanticWork } from './semantic';
import { rankSearchCheckpoints, MINIMUM_SEARCH_RELEVANCE } from './ranking';
```

Remove from `recall.ts`:
- The `ReadySemanticRecord` type alias (lines 23-26) — now exported from `ranking.ts`
- The `searchCheckpoints` function (lines 92-122) — moved to `ranking.ts`
- The `buildLexicalSearchCandidates` function (lines 203-211) — moved to `ranking.ts`
- The `rankSearchCheckpoints` function (lines 315-375) — moved to `ranking.ts`

Import `ReadySemanticRecord` from `ranking.ts` for the places that reference it in `recall.ts` (e.g., `loadReadySemanticRecords` return type).

- [ ] **Step 5: Create `tests/ranking.test.ts` with ranking tests from `tests/semantic.test.ts`**

Move the following describe blocks from `tests/semantic.test.ts` to `tests/ranking.test.ts`:
- `describe('buildHybridRanking', ...)` (the first one, with 3 tests)
- `describe('buildHybridRanking with large checkpoint count', ...)` (1 test)

Also move the `searchCheckpoints` tests from `tests/recall.test.ts` (the describe block using `searchCheckpoints` directly) into `tests/ranking.test.ts`, since `searchCheckpoints` now lives in `ranking.ts`.

Update the imports in `tests/ranking.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { buildHybridRanking, searchCheckpoints, MINIMUM_SEARCH_RELEVANCE } from '../src/ranking'
import type { ScoredCheckpoint } from '../src/types'
import type { Checkpoint, SemanticRuntime } from '../src/types'
```

Update `tests/semantic.test.ts` to remove the ranking describe blocks and update its imports (remove `ScoredCheckpoint`, `buildHybridRanking`, etc.).

Update `tests/recall.test.ts` to remove the `searchCheckpoints` import and its describe block (those tests moved to `tests/ranking.test.ts`).

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: All tests pass. The code moved, but behavior is identical.

- [ ] **Step 7: Verify line counts improved**

```bash
wc -l src/ranking.ts src/semantic.ts src/recall.ts
```

Expected: `ranking.ts` ~280 lines, `semantic.ts` ~120 lines, `recall.ts` ~680 lines.

- [ ] **Step 8: Commit**

```bash
git add src/ranking.ts src/semantic.ts src/recall.ts src/types.ts tests/ranking.test.ts tests/semantic.test.ts
git commit -m "refactor: extract ranking logic into dedicated module

Moved buildHybridRanking, scoring helpers, and rankSearchCheckpoints
from semantic.ts and recall.ts into ranking.ts. ScoredCheckpoint moved
to types.ts. semantic.ts now only owns embedding/pending work processing.
recall.ts drops ~120 lines of ranking code."
```

---

### Task 5: Add Typed Handler Arg Interfaces

**Files:**
- Modify: `src/types.ts` (add handler arg interfaces)
- Modify: `src/handlers/checkpoint.ts` (cast args)
- Modify: `src/handlers/recall.ts` (cast args)
- Modify: `src/handlers/plan.ts` (cast args)
- Modify: `src/handlers/consolidate.ts` (cast args)

- [ ] **Step 1: Add handler arg interfaces to `types.ts`**

Add at the end of `src/types.ts`:

```typescript
/** MCP tool argument types for compile-time safety */

export interface CheckpointArgs {
  description: string;
  tags?: string[] | string;
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[] | string;
  impact?: string;
  evidence?: string[] | string;
  symbols?: string[] | string;
  next?: string;
  confidence?: number | string;
  unknowns?: string[] | string;
  workspace?: string;
}

export interface RecallArgs {
  workspace?: string;
  limit?: number;
  days?: number;
  from?: string;
  to?: string;
  since?: string;
  search?: string;
  full?: boolean;
  planId?: string;
  plan_id?: string;
  includeMemory?: boolean;
  include_memory?: boolean;
  _registryDir?: string;
  _semanticRuntime?: SemanticRuntime;
}

export interface PlanArgs {
  action: string;
  id?: string;
  planId?: string;
  plan_id?: string;
  title?: string;
  content?: string;
  workspace?: string;
  tags?: string[];
  activate?: boolean;
  status?: string;
  updates?: PlanUpdate;
}

export interface ConsolidateArgs {
  all?: boolean;
  workspace?: string;
}
```

Note: Array fields use `string[] | string` because MCP args can arrive as JSON strings (the `coerceArray` helper handles this).

- [ ] **Step 2: Update handler signatures**

In `src/handlers/checkpoint.ts`, change:
```typescript
export async function handleCheckpoint(args: any) {
```
to:
```typescript
import type { CheckpointArgs } from '../types.js';

export async function handleCheckpoint(args: CheckpointArgs) {
```

In `src/handlers/recall.ts`, change:
```typescript
export async function handleRecall(args: any) {
```
to:
```typescript
import type { RecallArgs } from '../types.js';

export async function handleRecall(args: RecallArgs) {
```

In `src/handlers/plan.ts`, change:
```typescript
export async function handlePlan(args: any) {
```
to:
```typescript
import type { PlanArgs } from '../types.js';

export async function handlePlan(args: PlanArgs) {
```

Also update `resolveId` signature:
```typescript
async function resolveId(args: PlanArgs, workspace: string): Promise<string | null> {
```

In `src/handlers/consolidate.ts`, change:
```typescript
export async function handleConsolidate(args: any) {
```
to:
```typescript
import type { ConsolidateArgs } from '../types.js';

export async function handleConsolidate(args: ConsolidateArgs) {
```

- [ ] **Step 3: Fix any type errors surfaced by the change**

Run: `bunx tsc --noEmit`

Fix any errors. Common issues:
- The `args` destructuring in `handlePlan` uses `args.updates` which may need the `updates` property typed on `PlanArgs`.
- The `handlePlan` function accesses `args.title`, `args.content`, `args.status`, `args.tags` directly for the update action fallback. These are already on `PlanArgs`.

- [ ] **Step 4: Run full test suite**

Run: `bun test`
Expected: All tests pass. No runtime behavior changes; this is purely compile-time.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/handlers/checkpoint.ts src/handlers/recall.ts src/handlers/plan.ts src/handlers/consolidate.ts
git commit -m "refactor: add typed handler arg interfaces

Replace args: any with CheckpointArgs, RecallArgs, PlanArgs, and
ConsolidateArgs. Array fields use string[] | string to match MCP
coercion behavior. Catches the planId vs id class of bugs at compile time."
```

---

### Task 6: Documentation Patches

**Files:**
- Modify: `README.md`
- Modify: `docs/IMPLEMENTATION.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Update README.md**

Make these targeted changes:

1. Line 7: Change `**Version 5.8.1**` to `**Version 6.5.0**`
2. Line 20: Change `three MCP tools (checkpoint, recall, plan)` to `four MCP tools (checkpoint, recall, plan, consolidate)`
3. Line 113: Change `The 3 core tools` to `The 4 core tools` and add `consolidate` to the list
4. In the standalone MCP usage section (around line 113-118), add a bullet for `consolidate`:
   ```
   - Call `consolidate()` periodically to distill checkpoints into memory.yaml
   ```
5. Update any remaining test counts to current (516)
6. Remove any references to `.mcp.json` as a registration path (plugin.json is canonical)

- [ ] **Step 2: Update docs/IMPLEMENTATION.md**

1. Line 1: Change `# Goldfish v5.8.1 - Implementation Specification` to `# Goldfish v6.5.0 - Implementation Specification`
2. Architecture section (lines 21-29): Add `memory.yaml` and consolidation state paths:
   ```
   {project}/.memories/
     {date}/{HHMMSS}_{hash}.md   # Individual checkpoints (YAML frontmatter)
     plans/{plan-id}.md           # Plans (YAML frontmatter)
     .active-plan                 # Active plan ID
     memory.yaml                  # Consolidated memory (YAML, merge-friendly)

   ~/.goldfish/
     registry.json                # Cross-project registry
     consolidation-state/         # Per-workspace consolidation cursors
       {workspace}_{hash}.json
     cache/semantic/              # Derived semantic manifest + JSONL records
     models/transformers/         # Local embedding model cache
   ```
3. Plugin structure (line 159): Remove `.mcp.json` line
4. Modules table (line 131): Add entries for `memory.ts`, `ranking.ts`, `consolidation-prompt.ts`, `logger.ts`. Update `semantic.ts` description to "Embedding runtime and pending semantic work processing". Add `handlers/consolidate.ts`.
5. Behavioral language section (line 175-180): Update the checkpoint tool description to match the current positive framing (no "when NOT to" lists).
6. Recall tool section (lines 188-205): Remove the "bounded maintenance" paragraph about "at most 3 records and ~150ms" since that cap was removed in v5.9.0. Note that maintenance runs uncapped on first use.
7. Implementation status section (line 244): Change `v5.8.1` to `v6.5.0`, add consolidation as item 11.

- [ ] **Step 3: Update CONTRIBUTING.md**

1. Line 21: Change `v5.3.0` to `v6.5.0`
2. Line 29: Update line count (will be around ~14k after refactor, remove hardcoded number or update)
3. Add iteration 5 context to the "What We've Built" list:
   ```
   4. **Goldfish 4.0**: Radical simplicity, markdown storage
   5. **Goldfish 5.x-6.x**: Claude Code plugin, project-local .memories/, semantic recall, memory consolidation
   ```

- [ ] **Step 4: Run the MCP description length test**

Run: `bun test tests/server.test.ts -t "character"`
Expected: PASS (doc changes don't affect tool descriptions or server instructions)

- [ ] **Step 5: Commit**

```bash
git add README.md docs/IMPLEMENTATION.md CONTRIBUTING.md
git commit -m "docs: update README, IMPLEMENTATION.md, CONTRIBUTING.md for v6.5.0

Version references updated from 5.x to 6.5.0. Tool count updated to 4.
Architecture diagrams now show memory.yaml and consolidation-state paths.
Stale bounded-maintenance docs corrected. Module table updated."
```

---

### Task 7: Clean TODO.md to Live Backlog Only

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Strip all completed sections, keep only unchecked items**

Replace the entire contents of `TODO.md` with only the unchecked items:

```markdown
# Goldfish -- Backlog

## Consolidation Tuning (Needs Real Usage Data)
- [ ] Tune consolidation subagent prompt based on real output quality
- [ ] Monitor semantic search quality with memory sections in the index
- [ ] Evaluate consolidation frequency (too aggressive? too lazy?)

## From Real Usage
- [ ] Tune hook prompts based on actual agent behavior
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)

## Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (consolidation reduces urgency since memory.yaml captures the essence)
- [ ] Plan templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting (memory.yaml summaries in cross-project recall may solve this)
- [ ] Tiered temporal rollups: daily -> weekly -> monthly summaries (if single memory.yaml proves insufficient for long-lived projects)

## Open Questions
- Is the PreCompact hook reliable enough? Does Claude actually checkpoint before compaction?
- Does the SessionStart hook fire consistently? Any startup delay issues?
- Is the ExitPlanMode -> plan save hook working as expected?
- Should skills be more or less prescriptive?

## Low Priority (No Evidence of Impact)
- [ ] Checkpoint handler: optional metadata aliases (`next` vs `next_steps`, `symbols` vs `affected_symbols`)
- [ ] No tests for hook scripts (hooks have non-trivial logic but are standalone scripts)
```

Note: Removed the "Evaluate 500-line cap" item (stale; consolidation now uses entry-budget, not line cap). Removed "handler args: any typing" item (done in Task 5). Updated MEMORY.md references to memory.yaml.

- [ ] **Step 2: Commit**

```bash
git add TODO.md
git commit -m "chore: clean TODO.md to live backlog only

Removed all completed items and historical fix logs (v5.0.7 through
v6.3.0). Stripped stale items (500-line cap, handler typing). What
remains is the actual open backlog."
```

---

### Task 8: Version Bump to 6.5.0

**Files:**
- Modify: `package.json` (version field)
- Modify: `.claude-plugin/plugin.json` (version field)
- Modify: `src/server.ts` (SERVER_VERSION constant)

- [ ] **Step 1: Bump version in all three files**

In `package.json`, change:
```json
"version": "6.4.0",
```
to:
```json
"version": "6.5.0",
```

In `.claude-plugin/plugin.json`, change:
```json
"version": "6.4.0",
```
to:
```json
"version": "6.5.0",
```

In `src/server.ts`, change:
```typescript
export const SERVER_VERSION = '6.4.0';
```
to:
```typescript
export const SERVER_VERSION = '6.5.0';
```

- [ ] **Step 2: Run the version sync test**

Run: `bun test tests/server.test.ts -t "version"`
Expected: PASS (all three files match)

- [ ] **Step 3: Run full test suite as final check**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json .claude-plugin/plugin.json src/server.ts
git commit -m "chore: bump version to 6.5.0"
```
