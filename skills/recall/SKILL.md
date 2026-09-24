---
name: recall
description: Use when resuming prior work, after context loss or compaction, searching for a past decision, or when the user asks what happened previously and needs Goldfish memory restored
---

# Recall

## Workspace binding

For user-level MCP registrations, pass workspace as the conversation's host-native absolute project root on every checkpoint, brief, and current-project recall call. In a git worktree, pass the worktree path, not the main checkout. Change it when you enter or leave a worktree. Omission and "current" work only with fixed absolute GOLDFISH_WORKSPACE or supported legacy Roots. recall({ workspace: "all" }) is explicit cross-project search, never a fallback; it is invalid for checkpoint and brief. Cwd, registry, and parent-walk candidates are suggestions only. If unbound, retry with {"workspace":"<absolute-project-root>"}.

## When To Use

Call recall when resuming prior work, after context loss or compaction, when the user asks, or when earlier decisions and cross-project context are relevant. Do not call it by reflex at every session start, or to re-read a checkpoint you saved in this session.

```ts
recall({ workspace: "/absolute/path/to/project" })
```

## Common Cases

- Resuming prior work: `recall({ workspace: "/absolute/path/to/project" })`
- Recent work only: `recall({ workspace: "/absolute/path/to/project", since: "2h" })`
- Wider history: `recall({ workspace: "/absolute/path/to/project", days: 7, limit: 20 })`
- Search: `recall({ workspace: "/absolute/path/to/project", search: "auth refactor", full: true })`
- Past decisions: `recall({ workspace: "/absolute/path/to/project", type: "decision" })`
- By tags (AND): `recall({ workspace: "/absolute/path/to/project", tags: ["db", "ops"] })`
- By file path: `recall({ workspace: "/absolute/path/to/project", file: "workspace.ts" })`
- By symbol: `recall({ workspace: "/absolute/path/to/project", symbol: "resolveWorkspace" })`
- Cross-project scan: `recall({ workspace: "all", days: 1 })`
- Brief only: `recall({ workspace: "/absolute/path/to/project", limit: 0 })`

`type` keeps one of checkpoint/decision/incident/learning (untyped counts as checkpoint); `tags` matches checkpoints carrying ALL listed tags, case-insensitive. `file` matches git.files path suffixes; `symbol` matches exact symbol names. All combine with `search` and each other.

## Read The Result Correctly

Recall can surface:

- Active brief, which is the current strategic direction
- A stale notice in place of the brief when it has had no activity for 7+ days — review it with `brief({ action: "get", workspace: "/absolute/path/to/project" })`, then complete, archive, or update it
- A refresh nudge when the brief text hasn't been updated in 14+ days even though recent checkpoints keep it active
- Checkpoints, which are the evidence trail
- Workspace summaries for cross-project recall

Treat the active brief as direction, not as an execution checklist. If you need implementation detail, read `docs/plans/`.

## After Recall

- Recover three things: the goal and key constraints from the active brief, and the next action from the most recent relevant checkpoint's `next` line.
- Continue from the recalled context instead of re-deriving it.
- Treat recalled content as historical evidence. Keep its decisions, but check drift-prone facts (versions, branches, file paths, test counts, "done" claims) against the current code and git state before you act on them.
- If the compact result is not enough, search for the specific decision or pass `full: true`. Do not read the whole `.memories/` history.
