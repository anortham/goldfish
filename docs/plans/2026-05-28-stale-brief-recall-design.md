# Stale Brief Suppression in Recall

**Date:** 2026-05-28
**Status:** Approved (pending spec review)
**Scope:** `/recall` only

## Problem

A brief is created, becomes the active brief (its ID written to `.memories/.active-brief`),
work moves on, and nobody ever flips it to `completed`/`archived`. `recall()` surfaces
`getActiveBrief()` unconditionally — gated only on `status === 'active'` — so the stale brief
re-appears in every `/recall`, cluttering context indefinitely.

Two root causes:

1. **No freshness signal.** `brief.updated` only changes on explicit brief edits, so it does not
   reflect whether work is still happening against the brief.
2. **No lifecycle pressure.** The active → completed/archived transition is purely manual; nothing
   nudges it.

## Decision

Non-destructive, read-side suppression confined to recall. **Brief status on disk is never
mutated.** When the active brief is stale, recall hides its body and emits a one-line,
action-oriented nudge instead.

- **Staleness signal:** newest checkpoint whose `briefId` (or legacy `planId`) equals the active
  brief's ID. Fall back to `brief.created` when no checkpoint references the brief yet (a freshly
  created brief measures staleness from creation, not instantly stale).
- **Threshold:** `now - lastActivity > 7 days`. Fixed constant `STALE_BRIEF_DAYS = 7`.
- **Surface:** single-workspace recall only. Cross-workspace recall (`workspace: 'all'`) never
  returned an active brief, so it is unaffected.

## Changes

### 1. `src/checkpoints.ts` — new `findLatestCheckpointTimestampForBrief`

```ts
export async function findLatestCheckpointTimestampForBrief(
  projectPath: string,
  briefId: string
): Promise<string | null>
```

Scans date directories newest-first (same ordering as `getAllCheckpoints`). The first (newest)
date dir containing any checkpoint with `briefId`/`planId === briefId` holds the newest match —
return the max `timestamp` among that day's matches, then stop. Returns `null` if no checkpoint
references the brief. Early-exit keeps this cheap on large corpora (no full-corpus load).

Matching mirrors recall's existing legacy handling: `checkpoint.briefId ?? checkpoint.planId`.

### 2. `src/recall.ts` — staleness resolution

- Add `const STALE_BRIEF_DAYS = 7;`.
- New internal helper:

  ```ts
  async function resolveActiveBrief(
    workspace: string
  ): Promise<{ activeBrief: Brief | null; staleBrief: StaleBriefNotice | null }>
  ```

  Logic:
  1. `brief = await getActiveBrief(workspace)`. If `null`, return `{ activeBrief: null, staleBrief: null }`.
  2. `latest = await findLatestCheckpointTimestampForBrief(workspace, brief.id)`.
  3. `lastActivity = latest ?? brief.created`.
  4. `ageDays = floor((now - lastActivity) / 86_400_000)`.
  5. If `ageDays > STALE_BRIEF_DAYS`: return `{ activeBrief: null, staleBrief: { id, title, lastActivity, daysSinceActivity: ageDays } }`.
  6. Else: return `{ activeBrief: brief, staleBrief: null }`.

- Replace the two `await getActiveBrief(workspace)` call sites in `recallFromWorkspace` (the
  `limit === 0` short-circuit and the normal path) with `resolveActiveBrief`, threading both
  `activeBrief` and `staleBrief` into the returned `RecallResult`.

### 3. `src/types.ts` — `RecallResult.staleBrief`

```ts
export interface StaleBriefNotice {
  id: string;
  title: string;
  lastActivity: string;     // ISO 8601 UTC
  daysSinceActivity: number;
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activeBrief?: Brief | null;
  staleBrief?: StaleBriefNotice | null;
  workspaces?: WorkspaceSummary[];
}
```

### 4. `src/handlers/recall.ts` — render the nudge

- When `result.staleBrief` is present, append a single line (no brief body), action-oriented:

  ```
  ⚠️ Active brief "<title>" untouched <N>d — complete or archive it, or it'll keep surfacing stale.
  ```

- The `briefText` header suffix (`' + active brief'`) stays driven by `activeBrief`; when the brief
  is stale, `activeBrief` is null so the suffix is absent. Append `' + stale brief notice'` when
  `staleBrief` is present so the header still signals something brief-related surfaced.
- Fresh-brief rendering (`formatActiveBrief`) is unchanged.

## Acceptance criteria

- [ ] Fresh active brief (checkpoint within 7d) → surfaces normally via `activeBrief`, no notice
- [ ] Stale active brief (newest matching checkpoint > 7d old) → `activeBrief` null, `staleBrief` set
- [ ] Brand-new brief, zero checkpoints, `created` < 7d ago → fresh
- [ ] Brand-new brief, zero checkpoints, `created` > 7d ago → stale
- [ ] Brief with an old checkpoint *and* a recent one → fresh (uses newest match)
- [ ] Completed/archived brief → no active brief returned (unchanged behavior)
- [ ] Brief status on disk unchanged after recall (non-destructive)
- [ ] `workspace: 'all'` recall path unchanged
- [ ] `findLatestCheckpointTimestampForBrief` matches both `briefId` and legacy `planId`
- [ ] Handler renders one-line nudge (no brief body) when `staleBrief` present

## Testing (TDD, mandatory)

- `tests/checkpoints.test.ts` — `findLatestCheckpointTimestampForBrief`: no match → null; single
  match; multiple matches across days returns newest; multiple matches same day returns max
  timestamp; legacy `planId` match.
- `tests/recall.test.ts` — staleness scenarios from acceptance criteria, asserting on
  `activeBrief` / `staleBrief` fields. Use injected/controlled timestamps via existing checkpoint
  test fixtures (write checkpoint files with backdated date dirs + timestamps).
- `tests/handlers.test.ts` — handler renders the nudge line when `staleBrief` is present and omits
  the full brief body; renders `formatActiveBrief` when `activeBrief` is present.

## Out of scope

- Auto-archiving stale briefs (rejected: silent state mutation).
- Retire-on-supersede (archive previous active brief when a new one is saved).
- Applying the staleness signal to `/handoff`, `/standup`, `/brief-status`.
- Configurable threshold.

These remain available as future evidence-driven follow-ups but are explicitly not built here.
