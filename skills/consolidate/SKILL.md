---
name: consolidate
description: Use when recall flags consolidation needed, before ending a long session, or on a cadence where checkpoints should be synthesized into durable project memory
allowed-tools: mcp__goldfish__consolidate, Agent
---

# Consolidate

## When To Run It

- Recall says `consolidation.needed: true`
- A long session produced meaningful new checkpoints
- The user asks to refresh project memory
- A scheduled review or wrap-up is due

## Workflow

1. Get the payload:

```ts
mcp__goldfish__consolidate({})
```

2. If `status` is `current`, stop.
3. If `status` is `ready`, dispatch the subagent with the returned prompt.
4. If `remainingCount > 0`, report that more batches remain.

## What The Subagent Uses

- `memory.yaml` or legacy `MEMORY.md`
- The checkpoint files listed in the prompt
- The active brief file when one exists

## Rules

- The subagent updates `memory.yaml` and the consolidation state file.
- It must not modify checkpoints.
- It must not modify brief files.
- Use `/consolidate all` only when the user wants to drain every batch in one run.
