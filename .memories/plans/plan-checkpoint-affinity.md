---
id: plan-checkpoint-affinity
title: Plan-Checkpoint Affinity
status: completed
created: 2026-02-24T20:24:24.682Z
updated: 2026-02-24T20:48:39.065Z
tags:
  - feature
  - plan-affinity
---

# Plan-Checkpoint Affinity

## Goal
Automatically link checkpoints to the active plan and support filtering recalled checkpoints by plan ID.

## Tasks
1. Add `planId` to Checkpoint type
2. Serialize `planId` in checkpoint frontmatter (format + parse)
3. Auto-attach `planId` during saveCheckpoint
4. Add `planId` filter to recall
5. Expose `planId` in tool definitions and handler
6. Update handler response to show planId
7. Update documentation

## Design Doc
`docs/plans/2026-02-24-plan-checkpoint-affinity-design.md`

## Implementation Plan
`docs/plans/2026-02-24-plan-checkpoint-affinity.md`
