# Consolidation Tool Rework Design

**Date:** 2026-03-23
**Scope:** Goldfish consolidate tool, consolidation prompt, skill, types
**Status:** Design approved, pending implementation
**Supersedes:** The consolidation pipeline section of `2026-03-23-memory-consolidation-design.md`. That spec defined the overall MEMORY.md architecture (still authoritative). This spec replaces only the data flow between the consolidate tool, calling agent, and subagent.

## Problem

The `consolidate()` tool reads all unconsolidated checkpoint content into memory, serializes it as JSON through the MCP response (100K+ chars for 50 checkpoints), then the calling agent stuffs it into a subagent prompt. The checkpoint data gets copied three times before the subagent touches it, even though the files are already on disk. This defeats the purpose of consolidation, which exists to reduce token usage.

## Solution

The consolidate tool returns metadata only: file paths, counts, timestamps, and the subagent prompt. The subagent reads checkpoint files, MEMORY.md, and the active plan directly from disk using its file tools. The MCP response stays under a few KB regardless of checkpoint count.

## Consolidate Tool Response

The tool returns a lightweight metadata payload:

```typescript
interface ConsolidationPayload {
  status: 'ready' | 'current';
  message?: string;                    // Only when status === 'current'
  checkpointFiles?: string[];          // Absolute paths, chronological (oldest-first), capped at 50
  memoryPath?: string;                 // Absolute path to .memories/MEMORY.md (may not exist yet)
  lastConsolidatedPath?: string;       // Absolute path to .memories/.last-consolidated
  activePlanPath?: string;             // Absolute path to active plan file, if one exists
  checkpointCount?: number;            // Number of checkpoints in this batch
  remainingCount?: number;             // Unconsolidated checkpoints beyond this batch (0 = fully caught up)
  previousTotal?: number;              // Running total for incrementing checkpointsConsolidated
  prompt?: string;                     // Subagent instructions (includes file paths and previousTotal)
}
```

**Removed fields:** `currentMemory`, `unconsolidatedCheckpoints`, `activePlan`, `lastConsolidated`. No file content passes through the MCP response.

**New field:** `remainingCount` tells the caller how many checkpoints remain after this batch. Zero means fully caught up. Greater than zero means more passes needed.

## Handler Changes

`src/handlers/consolidate.ts` changes:

1. Calls `getAllCheckpoints()` but only uses `timestamp` and `filePath` for filtering. Does not read or return checkpoint content.
2. No longer calls `readMemory()`. The `memoryPath` is derived from `join(memoriesDir, 'MEMORY.md')` without reading the file.
3. Still calls `getActivePlan()` to verify a valid active plan exists (checks status, handles missing files), but only uses the returned plan's `id` to construct `activePlanPath`. Does not return plan content.
4. Filters to unconsolidated checkpoints (same timestamp logic as today).
5. **Batching is oldest-first.** All unconsolidated checkpoints are sorted chronologically (oldest first). The batch is the first 50. This is critical: if the batch were newest-first, writing `.last-consolidated` with the newest timestamp would orphan all older uncheckpointed files, making them unreachable in subsequent passes.
6. Caps at `CONSOLIDATION_BATCH_CAP` (50).
7. Computes `remainingCount` as the number of unconsolidated checkpoints beyond the cap.
8. Returns file paths instead of checkpoint objects.

### Getting Checkpoint File Paths

Checkpoint files follow the pattern `.memories/{date}/{HHMMSS}_{hash}.md`. The `getAllCheckpoints()` function already knows each file's path when it reads it but discards that information.

Add a `filePath` field to the `Checkpoint` interface. Populate it in `getCheckpointsForDay()` for both `.md` and legacy `.json` checkpoint files. The path survives through sorting and slicing in `getAllCheckpoints()` naturally since it's on the object.

**Legacy `.json` files:** The subagent reads raw files from disk. Legacy `.json` checkpoint files have a different format than `.md` files (no YAML frontmatter). The handler must exclude `.json` files from `checkpointFiles` since the subagent prompt only describes the `.md` format. Legacy checkpoints are still loaded for recall and search (existing behavior), but they are not eligible for consolidation file-path handoff. If a project has only legacy `.json` checkpoints, `checkpointFiles` will be empty and the tool returns `status: "current"`.

### Active Plan Path

The handler still calls `getActivePlan()` to verify the plan exists and is active (not completed/archived). If it returns a plan, the handler constructs the path: `join(getPlansDir(workspace), \`${plan.id}.md\`)`. If `getActivePlan()` returns null, `activePlanPath` is omitted. This prevents returning paths to deleted or archived plan files.

## Prompt Template Changes

`src/consolidation-prompt.ts` changes:

The function signature expands to include the file lists:

```typescript
function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointFiles: string[],
  activePlanPath: string | undefined,
  checkpointCount: number,
  previousTotal: number
): string
```

The prompt tells the subagent to read files from disk. Key sections:

**Inputs section:**
```
## Inputs

Read the following files using the Read tool:

1. **Current MEMORY.md** (baseline): `{memoryPath}`
   - If the file does not exist, this is the first consolidation. Start from scratch.

2. **Checkpoint files** (in this exact order, oldest first):
   {numbered list of checkpointFiles paths}
   - Each file has YAML frontmatter (between --- markers) with metadata fields,
     followed by a markdown body (the checkpoint description).
   - Extract durable facts from the markdown body. The frontmatter contains
     timestamp, tags, type, and optional structured fields (decision, context,
     impact, symbols, next).

3. **Active plan** (optional context): {activePlanPath or "No active plan."}
   - If provided, use it to understand project direction. Do not modify it.
```

**Output section** (unchanged in substance):
```
## Output: Write Two Files

File 1: Write updated MEMORY.md to: `{memoryPath}`
File 2: Write consolidation state JSON to: `{lastConsolidatedPath}`
Content: { "timestamp": "<current UTC ISO>", "checkpointsConsolidated": {newTotal} }
```

The synthesis instructions and constraints remain identical to the current prompt.

`previousTotal` is embedded in the prompt (as `newTotal = previousTotal + checkpointCount`) so the subagent writes the correct `checkpointsConsolidated` value. The subagent does not need to read `.last-consolidated` itself.

## Skill Changes

`skills/consolidate/SKILL.md` changes:

**Default invocation (`/consolidate`):**
1. Call `consolidate()`.
2. If `status: "current"`, tell user memory is up to date.
3. If `status: "ready"`, dispatch a **background** subagent with the prompt (the prompt already contains all file paths).
4. If `remainingCount > 0`, tell user: "Consolidated {checkpointCount} checkpoints. {remainingCount} remain. Run `/consolidate` again to process more, or `/consolidate all` to process everything."

**Full invocation (`/consolidate all`):**
Loop until caught up:
1. Call `consolidate()`.
2. If `status: "current"`, done.
3. If `status: "ready"`, dispatch a **foreground** subagent (must wait for `.last-consolidated` to be written before the next batch can filter correctly).
4. If `remainingCount > 0`, repeat from step 1.
5. **Circuit breaker:** Max 10 iterations. If the loop exceeds 10 passes, stop and tell the user: "Processed {total} checkpoints across {iterations} passes. {remainingCount} still remain. Something may be wrong; check `.last-consolidated` and re-run if needed."

The `all` variant uses foreground subagents because each batch must complete (writing `.last-consolidated`) before the next batch can correctly determine what's unconsolidated.

## Type Changes

`src/types.ts`:

The `ConsolidationPayload` interface is updated to match the new response shape:
- **Removed:** `currentMemory`, `unconsolidatedCheckpoints`, `activePlan`, `lastConsolidated`
- **Added:** `checkpointFiles`, `memoryPath`, `lastConsolidatedPath`, `activePlanPath`, `remainingCount`, `previousTotal`

The `Checkpoint` interface gains an optional `filePath?: string` field, populated by the checkpoint loading pipeline in `getCheckpointsForDay()`.

## Tool Description Changes

`src/tools.ts`:

The consolidate tool description is updated to reflect that it returns metadata and file paths, not checkpoint content. The workflow section is unchanged (call consolidate, dispatch subagent if ready).

## What Does NOT Change

- **Recall** (unchanged): three-part response with memory, delta, consolidation flag.
- **Hooks** (unchanged): PreCompact and SessionStart scripts still check staleness and suggest consolidation. They trigger the normal single-pass flow.
- **Checkpoint storage** (unchanged): same files, same format, same directory structure.
- **MEMORY.md format** (unchanged): same 500-line cap, same section structure, same write paths.
- **Consolidation subagent behavior** (unchanged in substance): it still reads checkpoints, synthesizes, writes two files. It just reads from disk instead of from the prompt payload.

## Performance Characteristics

**Before:** `consolidate()` with 50 checkpoints returns ~100K chars through MCP. Calling agent parses ~100K chars of JSON. Subagent prompt contains ~100K chars of checkpoint data.

**After:** `consolidate()` with 50 checkpoints returns ~5K chars through MCP (paths + prompt). Subagent reads ~100K chars from disk in chunks as needed, within its own context. Calling agent context is barely touched.

The total tokens consumed by the subagent are roughly the same (it still needs to read the checkpoints), but the calling agent's context is no longer polluted with checkpoint data it never uses.

## Testing

- Update `tests/consolidate.test.ts` to verify the new response shape (file paths, no content).
- Verify `remainingCount` is correct when checkpoints exceed the cap.
- Verify `checkpointFiles` are in chronological (oldest-first) order.
- Verify `checkpointFiles` excludes legacy `.json` checkpoint files.
- Verify `activePlanPath` is returned when a plan is active, absent when not.
- Verify `activePlanPath` is absent when the plan is completed or archived.
- Verify `memoryPath` and `lastConsolidatedPath` are correct absolute paths.
- Verify first-consolidation batching processes oldest checkpoints first (not newest).
- Verify `filePath` is populated on `Checkpoint` objects from `getAllCheckpoints()`.
- Existing `tests/memory.test.ts` and `tests/recall.test.ts` should be unaffected.
