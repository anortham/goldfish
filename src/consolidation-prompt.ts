/**
 * Build the subagent prompt for memory consolidation.
 *
 * The prompt tells the subagent to read checkpoint files from disk
 * rather than receiving content inline.
 */

/**
 * @param memoryPath - Absolute path to MEMORY.md (may not exist yet)
 * @param lastConsolidatedPath - Absolute path to .last-consolidated
 * @param checkpointFiles - Absolute paths to checkpoint files, oldest-first
 * @param activePlanPath - Absolute path to active plan, or undefined
 * @param checkpointCount - Number of checkpoint files in this batch
 * @param previousTotal - Running total of checkpoints consolidated before this batch
 */
export function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointFiles: string[],
  activePlanPath: string | undefined,
  checkpointCount: number,
  previousTotal: number
): string {
  const newTotal = previousTotal + checkpointCount;

  const fileList = checkpointFiles
    .map((f, i) => `   ${i + 1}. \`${f}\``)
    .join('\n');

  const planSection = activePlanPath
    ? `\`${activePlanPath}\`\n   - Use it to understand project direction. Do not modify it.`
    : 'No active plan.';

  return `You are a memory consolidation subagent. Your job is to synthesize developer checkpoints into a durable, well-structured MEMORY.md.

## Inputs

Read the following files using the Read tool:

1. **Current MEMORY.md** (baseline): \`${memoryPath}\`
   - If the file does not exist, this is the first consolidation. Start from scratch.

2. **Checkpoint files** (read in this exact order, oldest first):
${fileList}
   - Each file has YAML frontmatter (between \`---\` markers) with metadata fields, followed by a markdown body (the checkpoint description).
   - Extract durable facts from the markdown body. The frontmatter contains timestamp, tags, type, and optional structured fields (decision, context, impact, symbols, next).

3. **Active plan** (optional context): ${planSection}

## Synthesis Instructions

1. **Use currentMemory as baseline.** Start from the existing MEMORY.md structure and content. Do not discard what is already there unless it is contradicted or obsoleted by newer checkpoints.

2. **Read each unconsolidated checkpoint.** Extract durable facts, decisions, discoveries, architectural choices, and current state. Process them in chronological order (oldest first).

3. **Use the active plan for context.** If provided, let the plan inform which areas are in active flux and which sections deserve more detail.

4. **Synthesize, do not append.** Do not dump checkpoints verbatim. Extract what matters and integrate it into the appropriate sections.

5. **Overwrite contradictions.** New facts replace old ones. If a checkpoint says "we switched from X to Y", update the relevant section to reflect Y and remove stale mentions of X.

6. **Prune ephemeral details.** Keep: decisions, architecture, key discoveries, current state, active concerns, open questions. Drop: debugging steps, false starts, commands run, transient errors resolved.

7. **Preserve document voice.** Write in clear prose. Avoid bullet soup; use bullets only when items are genuinely list-like. Keep sections cohesive and readable.

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
