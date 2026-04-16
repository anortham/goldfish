---
name: brief
description: Use when starting multi-session work, capturing approved project direction, updating goals or constraints, or when the user asks for durable strategic context that should persist across sessions
allowed-tools: mcp__goldfish__brief
---

# Brief

## Core Split

Goldfish brief = durable direction.

- Harness plan mode owns execution planning for the current session.
- `docs/plans/` owns implementation specs and task breakdowns.
- Goldfish brief owns the compact strategic context that future sessions need.

Do not copy a harness task list or `docs/plans/` checklist into the brief. Link to execution artifacts instead.

## What Belongs In A Brief

Keep the brief compact and stable:

- Goal
- Why now
- Constraints
- Success criteria
- References to `docs/plans/...` or other design docs
- Status

## What Does Not Belong

- Step by step task breakdowns
- File by file implementation notes
- A mirrored `ExitPlanMode` plan blob
- Session noise that belongs in checkpoints

## Save A Brief

```ts
mcp__goldfish__brief({
  action: "save",
  title: "Brief API surface around strategic context",
  content: "## Goal\n\nRename the forward-looking artifact to brief.\n\n## Why Now\n\nHarnesses now own execution planning.\n\n## Constraints\n\nKeep one-release compatibility for plan callers.\n\n## Success Criteria\n\nRecall, skills, hooks, and docs all present brief as canonical.\n\n## References\n\n- docs/plans/2026-04-16-brief-repositioning-design.md",
  tags: ["memory", "migration"],
  activate: true
})
```

## Lifecycle

- Save a brief when a direction needs to survive session boundaries.
- Update it when goals, constraints, or success criteria change.
- Complete it when the direction has landed.
- Archive it when it has been superseded.

Only one brief should be active per workspace.

## Retrieval

- `mcp__goldfish__brief({ action: "get" })` gets the active brief.
- `mcp__goldfish__brief({ action: "list" })` shows saved briefs.
- `mcp__goldfish__recall({ limit: 0 })` shows the active brief without loading checkpoints.

## Rules

- Treat the brief as a compact strategic document.
- Use checkpoints for evidence of work done.
- Use `docs/plans/` for execution detail.
- If an older workflow says `plan`, translate it to brief semantics unless the user is asking about a legacy artifact on purpose.
