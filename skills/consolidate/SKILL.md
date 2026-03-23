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

This returns a JSON payload with `status`, `currentMemory`, `unconsolidatedCheckpoints`, and a `prompt` template.

### Step 2: Check Status

- **`status: "current"`** -- nothing to do, memory is up to date. Tell the user and stop.
- **`status: "ready"`** -- proceed to step 3.

### Step 3: Dispatch Background Subagent

Parse the payload and dispatch a **background** subagent with the consolidation prompt. The subagent writes two files: `.memories/MEMORY.md` and `.memories/.last-consolidated`.

```
Agent({
  description: "Consolidate project memory",
  prompt: `${payload.prompt}\n\n## Payload\n\ncurrentMemory:\n${payload.currentMemory}\n\nunconsolidatedCheckpoints:\n${JSON.stringify(payload.unconsolidatedCheckpoints, null, 2)}${payload.activePlan ? `\n\nactivePlan:\n${payload.activePlan}` : ''}`,
  run_in_background: true,
  mode: "bypassPermissions"
})
```

Continue your work. The subagent handles the synthesis in the background.

## What the Subagent Does

1. Reads current MEMORY.md as baseline (from the payload)
2. Processes each checkpoint chronologically, extracting durable facts
3. Synthesizes into well-structured prose sections (## headers)
4. Overwrites contradictions (new facts replace old)
5. Prunes ephemeral details (keeps decisions, drops debugging steps)
6. Respects the 500-line hard cap
7. Writes updated MEMORY.md and .last-consolidated

The subagent does NOT modify or delete checkpoints or plans.

## After Consolidation

Next time `recall()` runs, it will load the fresh MEMORY.md and show fewer (or zero) delta checkpoints. The consolidation flag will show `needed: false`.
