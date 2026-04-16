---
name: plan-status
description: Use when older workflows ask for /plan-status during the brief migration, so status can be assessed with brief-first semantics while preserving compatibility for legacy wording
allowed-tools: mcp__goldfish__recall, mcp__goldfish__brief, mcp__goldfish__plan
---

# Plan Status Compatibility Alias

`/plan-status` is a compatibility alias for `/brief-status`.

Assess status with this split:

- Goldfish brief = strategic direction
- `docs/plans/` = execution detail
- Checkpoints = evidence

## Workflow

1. Call `mcp__goldfish__recall({ limit: 0 })` to load the active brief.
2. Call `mcp__goldfish__recall({ days: 7, limit: 20, full: true })` to gather evidence.
3. Read `docs/plans/` when you need execution detail or task status.
4. Report drift, blockers, and stale direction plainly.

If a user or older script says `plan`, translate the request to brief semantics unless they are asking about a legacy plan artifact on purpose.
