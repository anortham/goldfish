---
name: recall
description: Use when starting a new session, after context loss, searching for prior work, or when the user asks what happened previously and needs Goldfish memory restored
---

# Recall

## When To Use

Call recall at session start, after compaction, or when you need prior work, decisions, or cross-project context.

```ts
recall({})
```

## Common Cases

- New session: `recall()`
- Recent work only: `recall({ since: "2h" })`
- Wider history: `recall({ days: 7, limit: 20 })`
- Search: `recall({ search: "auth refactor", full: true })`
- Past decisions: `recall({ type: "decision" })`
- By tags (AND): `recall({ tags: ["db", "ops"] })`
- By file path: `recall({ file: "workspace.ts" })`
- By symbol: `recall({ symbol: "recoverWorkspace" })`
- Cross-project scan: `recall({ workspace: "all", days: 1 })`
- Brief only: `recall({ limit: 0 })`

`type` keeps one of checkpoint/decision/incident/learning (untyped counts as checkpoint); `tags` matches checkpoints carrying ALL listed tags, case-insensitive. `file` matches git.files path suffixes; `symbol` matches exact symbol names. All combine with `search` and each other.

## Read The Result Correctly

Recall can surface:

- Active brief, which is the current strategic direction
- A stale notice in place of the brief when it has had no activity for 7+ days — review it with `brief({ action: "get" })`, then complete, archive, or update it
- A refresh nudge when the brief text hasn't been updated in 14+ days even though recent checkpoints keep it active
- Checkpoints, which are the evidence trail
- Workspace summaries for cross-project recall

Treat the active brief as direction, not as an execution checklist. If you need implementation detail, read `docs/plans/`.

## After Recall

- Summarize the active brief or recent checkpoint thread when it exists.
- Continue from the recalled context instead of re-deriving it.
