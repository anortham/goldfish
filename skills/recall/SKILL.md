---
name: recall
description: Use when starting a new session, after context loss, searching for prior work, or when the user asks what happened previously and needs Goldfish memory restored
allowed-tools: mcp__goldfish__recall, mcp__goldfish__brief
---

# Recall

## When To Use

Call recall at session start, after compaction, or when you need prior work, decisions, or cross-project context.

```ts
mcp__goldfish__recall({})
```

## Common Cases

- New session: `recall()`
- Recent work only: `recall({ since: "2h" })`
- Wider history: `recall({ days: 7, limit: 20 })`
- Search: `recall({ search: "auth refactor", full: true })`
- Cross-project scan: `recall({ workspace: "all", days: 1 })`
- Brief only: `recall({ limit: 0 })`

## Read The Result Correctly

Recall can surface:

- Active brief, which is the current strategic direction
- Checkpoints, which are the evidence trail
- Workspace summaries for cross-project recall

Treat the active brief as direction, not as an execution checklist. If you need implementation detail, read `docs/plans/`.

## After Recall

- Summarize the active brief or recent checkpoint thread when it exists.
- Continue from the recalled context instead of re-deriving it.
