---
name: recall
description: Restore context from Goldfish developer memory — use when starting a new session, after context loss, searching for past work, or when the user asks what happened previously, wants to find old decisions, or needs cross-project context
allowed-tools: mcp__goldfish__recall, mcp__goldfish__plan
---

# Recall — Restore Developer Memory

## When to Use

Call `mcp__goldfish__recall` to restore context from previous sessions. Recall runs automatically at session start, but users can also invoke `/recall` for targeted queries (search, cross-project, specific time ranges).

```
mcp__goldfish__recall({})
```

Default parameters (last 5 checkpoints, no date window) cover most cases.

## Common Scenarios

- **New session, need prior context** — `recall()` with defaults
- **After context compaction** — recall to restore lost state
- **Searching for past work** — `recall({ search: "auth refactor", full: true })`
- **Cross-project standup** — `recall({ workspace: "all", days: 1 })`
- **Just need the plan** — `recall({ limit: 0 })`

## Parameter Examples

### Standard recall (most common)
```
mcp__goldfish__recall({})
```

### Need more history
```
mcp__goldfish__recall({ days: 7, limit: 20 })
```

### Looking for specific work
```
mcp__goldfish__recall({ search: "auth refactor", full: true })
```

### Recent activity only
```
mcp__goldfish__recall({ since: "2h" })
```

### Search without MEMORY.md (leaner results)
```
mcp__goldfish__recall({ search: "auth", includeMemory: false })
```

## Interpreting Results

Recall returns up to three sections:

### 1. Active Plan (top of response)
The current strategic plan for this workspace. If present, work should align with it.

### 2. Checkpoints (chronological array)
Each checkpoint contains:
- `timestamp` — when it happened (UTC)
- `description` — what was done, why, and how
- `tags` — categorization labels
- `git.branch`, `git.commit` — git state at checkpoint time (only with `full: true`)
- `git.files` — changed files (only with `full: true`)

### 3. Workspace Summaries (cross-project only)
When using `workspace: "all"`, you get per-project summaries with checkpoint counts.

## Processing Large Result Sets

When you get 10+ checkpoints back, distill them:

1. **Group by date** — what happened each day
2. **Identify themes** — feature work, bug fixes, refactoring, planning
3. **Highlight blockers** — anything marked stuck, blocked, or failed
4. **Surface decisions** — architectural choices, tradeoffs made
5. **Find the thread** — what was the user working toward?

Present a concise summary: "Based on your recent work, you were [doing X] on [project area]. Last session you [accomplished Y] and the next step appears to be [Z]."

## After Recall

Once you have context, act on it:
1. Recall (restore memory)
2. Understand (process what you get back)
3. Continue (pick up where the last session left off)

Trust recalled context — don't re-verify information from checkpoints.

## Consolidation

Recall now returns consolidated memory (MEMORY.md) alongside checkpoints. When recall flags `consolidation.needed: true`, use the `/consolidate` skill to handle it.
