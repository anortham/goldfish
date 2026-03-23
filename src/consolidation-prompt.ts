/**
 * Build the subagent prompt for memory consolidation.
 */

/**
 * Returns the prompt template string instructing a consolidation subagent
 * how to synthesize checkpoints into MEMORY.md.
 *
 * @param memoryPath - Absolute path where MEMORY.md should be written
 * @param lastConsolidatedPath - Absolute path where .last-consolidated should be written
 * @param checkpointCount - Number of unconsolidated checkpoints in this batch
 * @param previousTotal - Running total of checkpoints consolidated before this batch
 */
export function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointCount: number,
  previousTotal: number
): string {
  const newTotal = previousTotal + checkpointCount;

  return `You are a memory consolidation subagent. Your job is to synthesize developer checkpoints into a durable, well-structured MEMORY.md.

## Inputs (provided in this payload)

- \`currentMemory\`: The current MEMORY.md content (may be empty if this is the first consolidation).
- \`unconsolidatedCheckpoints\`: Array of ${checkpointCount} checkpoint objects, each with a \`timestamp\` and \`description\` (markdown body) plus optional metadata fields.
- \`activePlan\` (optional): The active plan content, provided for context on current project direction.

## Synthesis Instructions

1. **Use currentMemory as baseline.** Start from the existing MEMORY.md structure and content. Do not discard what is already there unless it is contradicted or obsoleted by newer checkpoints.

2. **Read each unconsolidated checkpoint.** Extract durable facts, decisions, discoveries, architectural choices, and current state. Process them in chronological order (oldest first).

3. **Use the active plan for context.** If provided, let the plan inform which areas are in active flux and which sections deserve more detail.

4. **Synthesize — do not append.** Do not dump checkpoints verbatim. Extract what matters and integrate it into the appropriate sections.

5. **Overwrite contradictions.** New facts replace old ones. If a checkpoint says "we switched from X to Y", update the relevant section to reflect Y and remove stale mentions of X.

6. **Prune ephemeral details.** Keep: decisions, architecture, key discoveries, current state, active concerns, open questions. Drop: debugging steps, false starts, commands run, transient errors resolved.

7. **Preserve document voice.** Write in clear prose. Avoid bullet soup — use bullets only when items are genuinely list-like. Keep sections cohesive and readable.

8. **Hard cap: 500 lines.** If the document would exceed 500 lines, compress old or resolved sections. Summarize instead of listing. Archive resolved concerns.

9. **Use ## headers for sections.** Standard sections include (use what's relevant, add others as needed):
   - \`## Project Overview\`
   - \`## Architecture\`
   - \`## Key Decisions\`
   - \`## Current State\`
   - \`## Active Concerns\`
   - \`## Open Questions\`

   Do NOT include a title line or frontmatter. The document starts directly with a \`##\` header.

## Output: Write Two Files

**File 1:** Write the updated MEMORY.md to:
\`${memoryPath}\`

- No frontmatter, no title. Pure markdown starting with a \`##\` header.
- Must not exceed 500 lines.

**File 2:** Write the consolidation state JSON to:
\`${lastConsolidatedPath}\`

Content must be exactly:
\`\`\`json
{ "timestamp": "<UTC ISO timestamp of now>", "checkpointsConsolidated": ${newTotal} }
\`\`\`

Replace \`<UTC ISO timestamp of now>\` with the actual current UTC time in ISO 8601 format (e.g. \`2026-03-23T15:04:05.000Z\`).

## Constraints

- Do NOT modify or delete any checkpoint files.
- Do NOT touch plan files.
- Do NOT create any files other than the two listed above.
- If you are uncertain about a fact from the checkpoints, omit it rather than guess.`;
}
