---
name: consolidate
description: Consolidate Goldfish checkpoints into MEMORY.md -- use when recall flags consolidation needed, before ending long sessions, or on a scheduled cadence to synthesize episodic checkpoints into durable project understanding
allowed-tools: mcp__goldfish__consolidate, Agent
---

# Consolidate -- Synthesize Developer Memory

## When to Consolidate

- **Recall flags it** -- `consolidation.needed: true` in recall response
- **Before ending a long session** -- significant new work that should be synthesized
- **Scheduled cadence** -- daily wrap-up, weekly review
- **Manual request** -- user asks to consolidate or update project memory

## Workflow

### Step 1: Get the Payload

```
mcp__goldfish__consolidate({})
```

Returns a lightweight JSON payload with `status`, `checkpointFiles` (paths), `memoryPath`, `remainingCount`, and a `prompt` template. No checkpoint content is returned.

### Step 2: Check Status

- **`status: "current"`** -- nothing to do, memory is up to date. Tell the user and stop.
- **`status: "ready"`** -- proceed to step 3.

### Step 3: Dispatch Background Subagent

The `prompt` field already contains everything the subagent needs: file paths to read, synthesis instructions, and output paths to write. Dispatch it directly.

```
Agent({
  description: "Consolidate project memory",
  prompt: payload.prompt,
  run_in_background: true,
  mode: "bypassPermissions"
})
```

### Step 4: Report Remaining

If `remainingCount > 0`, tell the user:
"Consolidated {checkpointCount} checkpoints. {remainingCount} remain. Run `/consolidate` again to process more, or `/consolidate all` to process everything."

If `remainingCount` is 0, the user does not need to know about batching.

## `/consolidate all` -- Process Everything

When the user passes "all" as an argument, loop until fully caught up:

1. Call `consolidate()`
2. If `status: "current"`, done. Report total processed.
3. If `status: "ready"`, dispatch a **foreground** subagent (must wait for `.last-consolidated` to update before next batch).
4. If `remainingCount > 0`, repeat from step 1.
5. **Circuit breaker:** Max 10 iterations. If exceeded, stop and tell user how many were processed and how many remain.

Foreground subagents are required because each batch writes `.last-consolidated`, and the next `consolidate()` call needs that timestamp to filter correctly.

## What the Subagent Does

1. Reads MEMORY.md from disk (if it exists)
2. Reads each checkpoint file from the provided path list
3. Reads the active plan from disk (if provided)
4. Synthesizes into well-structured prose sections (## headers)
5. Overwrites contradictions (new facts replace old)
6. Prunes ephemeral details (keeps decisions, drops debugging steps)
7. Respects the 500-line hard cap
8. Writes updated MEMORY.md and .last-consolidated

The subagent does NOT modify or delete checkpoints or plans.

## After Consolidation

Next time `recall()` runs, it will load the fresh MEMORY.md and show fewer (or zero) delta checkpoints. The consolidation flag will show `needed: false`.
