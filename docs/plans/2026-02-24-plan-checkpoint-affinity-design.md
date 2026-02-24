# Plan-Checkpoint Affinity

**Date:** 2026-02-24
**Status:** Approved

## Problem

Checkpoints and plans exist in parallel but aren't linked. A checkpoint doesn't know which plan it was created under, making it impossible to answer "what progress was made on plan X?" without manual correlation.

## Design

Store the active plan's ID in checkpoint YAML frontmatter. When `saveCheckpoint()` runs and an active plan exists in the workspace, include `planId: <id>` in the checkpoint metadata. On recall, support filtering by `planId`.

## Changes

### 1. Type: `Checkpoint` — add optional `planId`

```typescript
export interface Checkpoint {
  // ... existing fields
  planId?: string;  // ID of active plan when checkpoint was created
}
```

### 2. `saveCheckpoint()` — read active plan, attach ID

After creating the checkpoint object and before writing to disk, call `getActivePlan(projectPath)`. If a plan is active, set `checkpoint.planId = plan.id`.

Cost: one extra file read (~1ms) on the `.active-plan` file per checkpoint save.

### 3. `formatCheckpoint()` / `parseCheckpointFile()` — serialize/deserialize

- `formatCheckpoint`: include `planId` in frontmatter when present
- `parseCheckpointFile`: read `planId` from frontmatter when present

### 4. Type: `RecallOptions` — add optional `planId`

```typescript
export interface RecallOptions {
  // ... existing fields
  planId?: string;  // Filter to checkpoints associated with this plan
}
```

### 5. `recallFromWorkspace()` — filter by `planId`

After loading checkpoints and before applying search/limit, filter out checkpoints whose `planId` doesn't match when the option is specified.

### 6. `handleRecall()` — pass through `planId`

No special handling needed — it flows through `RecallOptions`.

### 7. Tool definition — expose `planId` parameter on `recall` tool

Add `planId` as an optional string parameter with description explaining it filters to checkpoints created while a specific plan was active.

## Backward Compatibility

- Existing checkpoints without `planId` are unaffected (field is optional)
- When filtering by `planId`, checkpoints without the field are excluded from results
- No migration needed

## Non-Goals

- Linking checkpoints to plans retroactively
- Multiple plan associations per checkpoint
- Auto-updating plan progress based on checkpoint counts
