# Brief Repositioning

**Date:** 2026-04-16
**Status:** Approved

## Context

Goldfish's current `plan` artifact was designed when agent harnesses had weaker native planning and weaker local memory. That world is gone.

By 2026, Claude Code, Codex, and OpenCode all provide native planning workflows, plus some combination of session memory, project memory, or planning-oriented agent flows. Goldfish still has a useful forward-looking role, but copying harness plans into `.memories/plans/` now creates overlap instead of clarity.

The repo already hints at the intended split:

- Goldfish plans are described as strategic direction that appears in `recall()`
- `docs/plans/` holds detailed implementation specs
- skills such as `/standup` and `/plan-status` already read both sources

The contradiction is the automatic mirroring behavior. The `ExitPlanMode` hook currently pushes approved harness plans into Goldfish as active plans, which turns Goldfish into a second planner and creates another source of truth.

## Problem

The current `plan` tool is doing the wrong job for the modern agent stack.

- The name `plan` implies execution planning, task breakdown, and implementation steps
- Harnesses already own that layer, often better than Goldfish can
- Auto-saving harness plans into Goldfish duplicates content that already exists elsewhere
- Duplicated plans go stale fast and mislead later sessions
- The artifact's intended role is strategic context, but the product language keeps inviting task-manager behavior

This produces three competing plan authorities:

1. Harness-native planning mode
2. `docs/plans/` implementation specs
3. Goldfish `plan`

That is one authority too many.

## Decision

Rename the Goldfish `plan` artifact to `brief` and narrow its role.

A `brief` is a compact strategic document for the current workspace. It captures forward-looking context that should survive across sessions and across clients, but it is not the execution plan.

The brief should answer:

- What are we trying to do?
- Why does it matter now?
- What constraints or decisions shape the work?
- What does success look like?
- Where does the execution plan live?

The brief should not become:

- a copied Claude Code or Codex plan
- a step-by-step implementation checklist
- a file-by-file execution script
- a task board

## Goals

- Give Goldfish a clear forward-looking niche that does not duplicate harness planning
- Preserve durable strategic context in source control
- Keep `recall()` useful by surfacing the current direction in a compact form
- Maintain portability across clients, including clients without rich native memory
- Reduce source-of-truth conflicts between Goldfish and `docs/plans/`

## Non-Goals

- Replacing harness-native planning
- Syncing every harness-generated plan into Goldfish
- Building a task manager
- Inferring implementation steps from checkpoints
- Tracking multiple concurrent strategic workstreams as first-class objects

## Why `brief`

`brief` matches the new role better than `plan`.

- It sounds like a concise document, not a second planner
- It does not collide with `checkpoint`
- It supports references to external implementation plans without implying Goldfish owns them
- It keeps the artifact small, durable, and legible

`initiative` was considered and rejected for this change. It sounds more like a workstream or portfolio object, which nudges the product back toward project management semantics.

## Product Model

### 1. Brief artifact

Goldfish stores one active brief per workspace.

The brief remains a markdown document with YAML frontmatter and a markdown body. Keep the existing lightweight shape:

```markdown
---
id: recall-rework
title: Recall Rework
status: active
created: 2026-04-16T15:00:00.000Z
updated: 2026-04-16T18:00:00.000Z
tags: [recall, UX]
---

## Goal
Make recall resilient to noisy inputs while keeping the API small.

## Why Now
Recent fixes exposed prompt-shape fragility and too many entry points.

## Constraints
- Keep backward compatibility where feasible
- Do not turn Goldfish into a planner

## Success Criteria
- Recall handles placeholder input safely
- The forward-looking memory layer stays compact

## References
- docs/plans/2026-04-16-recall-rework-implementation.md
```

No new mandatory schema is required for the first pass. The role changes more than the file format.

### 2. Brief semantics

The active brief is the workspace's current strategic summary, not its task list.

- One active brief per workspace still makes sense
- `active`, `completed`, and `archived` remain useful statuses
- The body should stay compact and stable enough to survive many sessions
- External execution plans belong in `docs/plans/` or the harness, and the brief points at them

## Behavior Changes

### 1. Tool rename

Rename the MCP tool from `plan` to `brief`.

The new tool keeps the same basic actions:

- `save`
- `get`
- `list`
- `activate`
- `update`
- `complete`

This keeps migration simple while changing the meaning of the artifact.

### 2. Remove mandatory plan-mode mirroring

Remove the `ExitPlanMode` auto-save behavior that treats every approved harness plan as something Goldfish must persist.

Goldfish should no longer assume:

- every harness plan deserves durable storage in Goldfish
- every plan approval implies strategic direction changed
- copied plan text will remain accurate after execution begins

If the user or agent reaches a durable strategic decision, they may save or update the brief. That becomes intentional, not automatic.

### 3. Recall wording

`recall()` should surface the active brief, not the active plan.

User-facing output should shift accordingly:

- `Active Plan` -> `Active Brief`
- `+ active plan` -> `+ active brief`
- plan-oriented docs and examples -> brief-oriented language

### 4. Checkpoint affinity

Checkpoints should remain linkable to the current forward-looking artifact, but the language should follow the rename.

- Public API and types should move from `planId` to `briefId`
- Readers must continue accepting legacy `planId`
- Existing checkpoint files remain valid
- New checkpoint writes should use the new term

This preserves the useful ability to answer "what progress happened under this brief?" without keeping the old product language forever.

### 5. Skills and commands

Rename the user-facing skill layer to match the new mental model.

- `/plan` -> `/brief`
- `/plan-status` -> `/brief-status`

`/brief-status` assesses alignment between:

- the active brief
- external implementation plans in `docs/plans/`
- checkpoint evidence

This keeps Goldfish's role honest: strategic context plus evidence, not task orchestration.

### 6. Standup behavior

`/standup` should continue reading both the Goldfish artifact and `docs/plans/`, but the interpretation changes:

- brief = current direction
- `docs/plans/` = implementation detail
- checkpoints = evidence of actual progress

Standup output should flag drift between these layers instead of pretending they are interchangeable plan sources.

## Storage and Compatibility

### 1. Storage rename

Rename storage paths to match the new artifact:

- `.memories/plans/` -> `.memories/briefs/`
- `.active-plan` -> `.active-brief`

### 2. Backward-compatible reads

During migration, Goldfish should read both old and new locations.

- Prefer `.memories/briefs/` and `.active-brief`
- Fall back to `.memories/plans/` and `.active-plan`
- Accept legacy `planId` in checkpoint frontmatter

### 3. Migration strategy

Use lazy migration rather than requiring a separate migration command.

- Existing plan files remain readable
- First write through the new `brief` API writes to brief storage
- Updating a legacy plan through compatibility aliases can rewrite it as a brief
- Docs and examples move to the new terminology in the same release

This keeps the migration small and avoids forcing users to run a one-off conversion step.

## Alternatives Considered

### Keep `plan` and only change the docs

Rejected. The name itself keeps teaching the wrong behavior. If the artifact is strategic context, calling it a plan continues to invite duplication and stale execution detail.

### Delete the tool entirely

Rejected. Goldfish still benefits from one forward-looking strategic artifact that survives across sessions, across clients, and in source control. That role is still useful even when harnesses plan natively.

### Rename to `initiative`

Rejected for this change. `initiative` is decent, but it sounds heavier and more portfolio-oriented. Goldfish does not need the baggage of multi-track strategic management.

## Rollout

### Phase 1: Rename and compatibility

- Add `brief` tool and skill
- Keep `plan` as a compatibility alias
- Rename recall output to brief language
- Stop auto-saving harness plan-mode output

### Phase 2: Storage and affinity rename

- Introduce brief storage paths and active-brief marker
- Add legacy read support for old paths
- Rename `planId` API surfaces to `briefId` with compatibility support

### Phase 3: Cleanup

- Remove prominent `plan` terminology from docs
- Demote or remove the compatibility alias after at least one stable release

## Acceptance Criteria

- Goldfish no longer auto-mirrors harness plan-mode output into durable storage
- The forward-looking artifact is named `brief` in user-facing flows
- `recall()` surfaces the active brief using brief language
- The brief is positioned as strategic context, not execution planning
- `docs/plans/` remains the source of truth for implementation specs
- Existing plan files and checkpoint references remain readable during migration
- Checkpoints can still be associated with the active brief

