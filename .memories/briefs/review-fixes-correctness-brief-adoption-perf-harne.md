---
id: review-fixes-correctness-brief-adoption-perf-harne
title: "Review fixes: correctness, brief adoption, perf, harness tier-1"
status: active
created: 2026-07-16T12:26:57.112Z
updated: 2026-07-16T12:26:57.112Z
tags:
  - review-fixes
  - recall
  - briefs
  - performance
  - harness-support
---

## Goal

Land the four fix tracks from the 2026-07-16 project review: correctness/doc fixes (cross-workspace recall limit bug, skill tool-namespace bug), brief behavioral adoption (nudges at checkpoint-save time, lifecycle triggers), performance/token fixes (async git, search index cache, full-mode cap), and harness tier-1 (AGENTS.md usage split, version tag check, mirror guard).

## Why Now

Review confirmed silent data loss in `recall({workspace:'all'})`, briefs going stale because nudges fire only at session start, search already 5x over its perf target at 1k checkpoints, and skills shipping tool names that don't match plugin installs.

## Constraints

- TDD mandatory; markdown stays source of truth (in-memory caches only, no derived files).
- MCP instructions and tool descriptions stay under the 2k cap.
- No version bump or release without user approval.
- Port ponytail's discipline (generators, drift guards), not its 22-harness breadth.

## Success Criteria

- Cross-workspace recall returns true counts with a no-date-params regression test.
- Checkpoint response reinforces commit inclusion and brief freshness.
- Search at 1k checkpoints back under target via cached index; save path off the event-loop-blocking git spawns.
- AGENTS.md serves harness users, not contributors; version check catches all-stale-together drift.

## References

- docs/plans/2026-07-16-review-fixes-plan.md
