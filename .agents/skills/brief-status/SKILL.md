---
name: brief-status
description: Use when the user asks for progress against current project direction, wants a status check on the active brief, or needs evidence-backed assessment across briefs, checkpoints, and docs/plans
allowed-tools: mcp__goldfish__recall, mcp__goldfish__brief
---

# Brief Status

## Core Split

Assess status from three sources:

- Goldfish brief = strategic direction
- `docs/plans/` = execution detail
- Checkpoints = evidence

## Workflow

### 1. Load the current brief

```ts
mcp__goldfish__recall({ limit: 0 })
```

If the user asks about a specific brief, fetch it directly:

```ts
mcp__goldfish__brief({ action: "get", id: "brief-id" })
```

### 2. Pull recent evidence

```ts
mcp__goldfish__recall({ days: 7, limit: 20, full: true })
```

Use `full: true` when you need files, git context, or detailed checkpoint metadata.

### 3. Read `docs/plans/` when execution detail matters

Use project plan docs to understand implementation sequencing, task lists, and status headers. Do not trust the status header blindly. Verify it against checkpoints.

## What To Report

- Which brief goals have checkpoint evidence
- Which goals are active but unfinished
- Which goals have no recent evidence
- Whether `docs/plans/` execution detail matches the brief
- Drift, blockers, and unplanned work

## Report Shape

Use short sections:

- `Direction` for the active brief
- `Evidence` for completed and active work
- `Drift` for work that does not map back to the brief
- `Next` for likely immediate follow-up

Be direct. If the brief is stale, say so. If the implementation work has drifted away from the brief, say so.

## Rules

- Do not fabricate progress.
- Checkpoints beat status headers.
- `docs/plans/` can explain how the team is executing, but the brief explains why.
- If no brief exists, say that and assess status from checkpoints plus `docs/plans/`.
