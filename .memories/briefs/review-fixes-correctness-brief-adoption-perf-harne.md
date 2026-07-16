---
id: review-fixes-correctness-brief-adoption-perf-harne
title: "Review fixes: correctness, brief adoption, perf, harness tier-1"
status: completed
created: 2026-07-16T12:26:57.112Z
updated: 2026-07-16T13:32:07.348Z
tags:
  - review-fixes
  - recall
  - briefs
  - performance
  - harness-support
---

## Goal

Land the four fix tracks from the 2026-07-16 project review: correctness/doc fixes, brief behavioral adoption, performance/token fixes, and harness tier-1.

## Status (2026-07-16)

All four tracks are implemented, tested (596 pass), and committed to main as d0fc6a8, f8776e0, 0c23e29, 21c3eea. Remaining: push to origin and cut the 7.5.0 release (version bump across 5 surfaces + CHANGELOG) — both need user approval.

## Constraints

- TDD mandatory; markdown stays source of truth (in-memory caches only, no derived files on disk).
- MCP instructions and tool descriptions stay under the 2k cap (instructions now at 1,763).
- No version bump, push, or release without user approval.

## Success Criteria (all met)

- Cross-workspace recall returns true counts with a no-date-params regression test.
- Checkpoint response reinforces commit inclusion and brief freshness.
- Search at 1k checkpoints ~11ms warm (target 50ms); save path off the event-loop-blocking git spawns (~21ms).
- Instruction tier served by generated docs/agent-instructions/goldfish-usage.md; version-tag and mirror drift guarded by tests.

## References

- docs/plans/2026-07-16-review-fixes-plan.md
- docs/agent-portability.md
