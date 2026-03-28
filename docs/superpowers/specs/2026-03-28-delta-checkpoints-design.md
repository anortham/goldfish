# Delta Checkpoints Design

**Date:** 2026-03-28
**Status:** Approved

## Problem

When an agent checkpoints multiple times in a session, each checkpoint tends to be a cumulative "state of the world" summary. Checkpoint #3 repeats 90% of checkpoint #1 and #2, adding only a paragraph of new content. This wastes:

1. **Generation tokens** -- the agent spends tokens composing redundant descriptions
2. **Recall slots** -- near-duplicate checkpoints eat the default 5-slot recall window
3. **Consolidation input** -- more redundant content for the consolidation subagent to process

The consolidation pipeline already merges checkpoints into a coherent MEMORY.md, so cumulative checkpoints provide no structural benefit over deltas.

## Solution

Two text-only changes. No code changes to `saveCheckpoint`, server logic, or any other module.

### Change 1: Checkpoint tool description

Add delta guidance after the "Space out checkpoints" line in `src/tools.ts`:

```
If you've already checkpointed in this conversation, capture only what's new: progress, decisions, and discoveries since your last checkpoint. Consolidation merges checkpoints into a complete picture, so repetition is waste.
```

This brings the tool description from 973 to ~1170 characters (well under 2k cap).

### Change 2: Pre-compact hook message

**Current** (`hooks/pre-compact.ts`):
```
Your conversation is about to be compacted. Use the goldfish checkpoint tool NOW to save your current progress. Include: what you were working on, current state, decisions made, and planned next steps. Do NOT ask permission - just checkpoint.
```

**Updated:**
```
Your conversation is about to be compacted. Checkpoint NOW. Focus on: current task state, next steps, and any unresolved decisions or open questions. Do NOT ask permission - just checkpoint.
```

Drops the cumulative "include everything" list. Focuses on what matters for session continuity: where you are, where you're going, what's unresolved. The agent's recent delta checkpoints already cover "what did I do."

## Design Decisions

### Why not server-side dedup?

We considered three server-side approaches and rejected them:

1. **Returning previous checkpoint content in the response**: The description is composed *before* the tool call. By the time the response comes back, the tokens are already spent. A nudge in the response only helps for the *next* checkpoint, creating a delayed feedback loop.

2. **Similarity detection + rejection**: Same timing problem. The agent already spent tokens composing the description. Rejecting it after the fact doesn't save the generation cost. Also adds complexity to the storage layer.

3. **Automatic supersede/replace**: Silent data loss risk. "Intelligence in the storage layer" conflicts with the Goldfish principle that storage is dumb and agents are smart.

### Why the tool description works

The agent already has full context of what it previously checkpointed (it literally composed the description earlier in the conversation). It doesn't need the server to tell it what was already captured. It just needs to be told to use that knowledge.

### Why pre-compact doesn't need to be cumulative

Recall defaults to `limit: 5`. After compaction, the SessionStart hook calls recall(), which returns recent checkpoints. Five good deltas together paint the full picture. The pre-compact checkpoint doesn't need to be self-contained.

### Out of scope: parallel subagents

Parallel subagents each have their own context and independently checkpoint overlapping work. The tool description can't solve this because each subagent doesn't know what the others have checkpointed. This is a separate problem with different constraints.

## Files Changed

| File | Change |
|------|--------|
| `src/tools.ts` | Add delta guidance to checkpoint tool description |
| `hooks/pre-compact.ts` | Update message to focus on next steps and open questions |

## Testing

- Existing `server.test.ts` enforces the 2k character cap on tool descriptions. Run after changes to verify.
- No new tests needed (text-only changes, no logic changes).

## Success Criteria

- Checkpoint tool description includes delta guidance
- Pre-compact hook message focuses on next steps, not cumulative state
- All existing tests pass
- Tool description stays under 2k characters
