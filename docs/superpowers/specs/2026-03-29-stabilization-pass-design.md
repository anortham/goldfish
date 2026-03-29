# Goldfish v6.5.0 Stabilization Pass

Three-way review (Claude, Gemini, Codex) identified bugs, inconsistencies, and quality gaps. This spec covers the full stabilization pass before entering maintenance mode.

## 1. Centralize Stale-Counting (Bug Fix)

### Problem

Stale checkpoint counting is implemented three different ways, and they already disagree:

| Location | Method | Age Filter |
|----------|--------|------------|
| `recall.ts:568-582` | Checkpoint timestamp | 30-day filter |
| `handlers/consolidate.ts:55` | Checkpoint timestamp | 30-day filter |
| `hooks/count-stale.ts:37` | File `mtimeMs` | None |

The hook version uses file modification time instead of checkpoint timestamps and has no 30-day age window. On a fresh clone (all mtimes = clone time) or after filesystem timestamp changes, hooks prompt for consolidation when the tool would say nothing to do.

### Fix

1. Extract `CONSOLIDATION_AGE_LIMIT_DAYS = 30` to a shared constant in `src/checkpoints.ts` (already owns checkpoint loading).
2. Rewrite `hooks/count-stale.ts` to parse checkpoint YAML frontmatter for real timestamps and apply the 30-day filter. Keep it synchronous for hook performance.
3. Have `recall.ts` and `handlers/consolidate.ts` import the shared constant instead of defining their own.

### Tests

- Test that `countStaleCheckpoints` ignores checkpoints older than 30 days
- Test that `countStaleCheckpoints` uses frontmatter timestamp, not file mtime
- Test agreement between hook counting and recall counting on the same data

## 2. Registry `GOLDFISH_HOME` (Bug Fix)

### Problem

`registry.ts:28` hardcodes `join(homedir(), '.goldfish', 'registry.json')`. All other machine-local paths go through `getGoldfishHomeDir()` which respects the `GOLDFISH_HOME` env var. This creates a split brain when relocating Goldfish state (including test isolation via `GOLDFISH_HOME`).

### Fix

Change `getRegistryPath()` and `getRegistry()`/`registerProject()`/`unregisterProject()` default paths to use `getGoldfishHomeDir()` from `workspace.ts`. The `registryDir` override parameter stays for tests.

### Tests

- Test that `getRegistryPath()` respects `GOLDFISH_HOME` env var
- Verify existing registry tests still pass

## 3. Stale Artifact Cleanup

### Changes

- Delete `.memories/MEMORY.md` (superseded by `.memories/memory.yaml`)
- Delete `.memories/.last-consolidated` (superseded by machine-local `~/.goldfish/consolidation-state/`)
- Complete the `reduce-goldfish-tool-overuse` plan so `.active-plan` clears

These are file deletions and a plan status change, no code changes.

## 4. Extract Ranking into Dedicated Module

### Problem

Ranking logic (hybrid scoring, lexical matching, recency weighting, semantic similarity) is tangled into `semantic.ts` (342 lines), which also owns embedding runtime and pending work processing. `recall.ts` (802 lines) has a `rankSearchCheckpoints` wrapper that bridges recall orchestration to the ranking functions. Both external reviewers flagged recall.ts complexity and the muddled responsibilities in semantic.ts.

### Extraction

New file `src/ranking.ts` gets (from `semantic.ts`):

- `buildHybridRanking()` function and its `BuildHybridRankingInput` type
- `MINIMUM_SEARCH_RELEVANCE` constant
- All scoring helpers: `normalize`, `tokenize`, `cosineSimilarity`, `lexicalScore`, `recencyScore`, `lexicalMatchBoost`, `metadataBoost`

Also moves from `recall.ts`:

- `rankSearchCheckpoints()` function (wrapper that calls `buildHybridRanking`)

`ScoredCheckpoint` interface moves to `types.ts` (used across module boundaries by recall.ts, ranking.ts, and tests).

After extraction:
- `semantic.ts` (~110 lines): `processPendingSemanticWork` and embedding utilities only
- `ranking.ts` (~250 lines): all scoring, ranking, and relevance filtering
- `recall.ts` (~750 lines): orchestration, time parsing, checkpoint loading, memory synthesis, consolidation status, cross-workspace

### Tests

New `tests/ranking.test.ts` gets ranking-specific tests extracted from `tests/semantic.test.ts` (the `buildHybridRanking` describe blocks). `tests/recall.test.ts` keeps orchestration and integration tests. Semantic tests keep embedding/pending work tests. No test logic changes, just reorganization.

## 5. Handler Arg Typing

### Problem

Every handler function accepts `args: any`. This was the root cause of the `planId` vs `id` silent failure in v6.2.2. No compile-time checking on parameter access.

### Fix

Add to `types.ts`:

```typescript
interface CheckpointArgs {
  description: string;
  tags?: string[];
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[];
  impact?: string;
  evidence?: string[];
  symbols?: string[];
  next?: string;
  confidence?: number;
  unknowns?: string[];
  workspace?: string;
}

interface RecallArgs {
  workspace?: string;
  limit?: number;
  days?: number;
  from?: string;
  to?: string;
  since?: string;
  search?: string;
  full?: boolean;
  planId?: string;
  plan_id?: string;      // alias
  includeMemory?: boolean;
  include_memory?: boolean; // alias
}

interface PlanArgs {
  action: string;
  id?: string;
  planId?: string;       // alias
  plan_id?: string;      // alias
  title?: string;
  content?: string;
  status?: string;
  tags?: string[];
  activate?: boolean;
}

interface ConsolidateArgs {
  all?: boolean;
  workspace?: string;
}
```

Each handler casts `args` at entry point: `const typedArgs = args as RecallArgs`. No runtime validation changes, no new dependencies.

### Tests

Existing tests cover runtime behavior. The value is compile-time safety; `tsc --noEmit` catches future mismatches.

## 6. Documentation Patches

Targeted updates, not rewrites:

### README.md
- Update version references (5.x to 6.x)
- Update tool count (4 tools: checkpoint, recall, plan, consolidate)
- Fix architecture paths (add memory.yaml, consolidation-state)
- Update test count
- Fix any references to hooks "executing tools directly" (they prompt the agent)

### docs/IMPLEMENTATION.md
- Update header version
- Add memory.yaml to storage format section
- Add consolidation-state to architecture diagram
- Add consolidate tool description
- Update test counts

### CONTRIBUTING.md
- Update for memory.yaml and consolidation-state paths
- Update module table if stale

## 7. TODO.md Cleanup

Strip all completed/checked items and historical fix log sections (v5.0.7, v5.1.0, v5.10.0, v6.0.0, v6.2.2, v6.3.0). Keep only unchecked items from "What's Next" and any remaining low-priority items.

## Commit Sequence

1. `fix: centralize stale-counting with 30-day age filter`
2. `fix: registry respects GOLDFISH_HOME env var`
3. `chore: remove stale MEMORY.md, .last-consolidated, complete old plan`
4. `refactor: extract ranking logic from recall.ts`
5. `refactor: add typed handler arg interfaces`
6. `docs: update README, IMPLEMENTATION.md, CONTRIBUTING.md for v6.5.0`
7. `chore: clean TODO.md to live backlog only`
8. `chore: bump version to 6.5.0`
