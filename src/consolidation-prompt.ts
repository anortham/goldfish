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
 * @param lastBatchTimestamp - ISO 8601 timestamp of the last checkpoint in this batch (used as consolidation cursor)
 */
export function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointFiles: string[],
  activePlanPath: string | undefined,
  checkpointCount: number,
  previousTotal: number,
  lastBatchTimestamp: string
): string {
  const newTotal = previousTotal + checkpointCount;

  const fileList = checkpointFiles
    .map((f, i) => `   ${i + 1}. \`${f}\``)
    .join('\n');

  const planSection = activePlanPath
    ? `\`${activePlanPath}\`\n   - Use it to understand project direction. Do not modify it.`
    : 'No active plan.';

  return `You are a memory consolidation subagent. Your job is to distill developer checkpoints into a lean MEMORY.md that captures only what cannot be derived from the codebase, git log, or tools.

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

**Litmus test: if you can derive it from the codebase, git log, or tools, it doesn't belong in MEMORY.md.**

MEMORY.md exists for things that are hard to reconstruct. Apply this test to every line you write.

### KEEP (hard to reconstruct)

- **Decisions + rationale**: why a choice was made, what alternatives were rejected
- **Open questions**: unresolved uncertainties, things still being evaluated
- **Deferred work with context**: what's blocked, why, and what's needed to unblock
- **Gotchas**: non-obvious things discovered through experience that would burn time again

### KILL (derivable from code, git, or tools)

- Architecture descriptions (read the code)
- Module/file inventories (use search tools)
- Phase histories and changelogs (git log)
- Feature lists (read the files)
- Infrastructure/config details (read configs)
- Current state summaries (git status, tests)

### How to Synthesize

1. **Start from existing MEMORY.md.** Keep entries that still pass the litmus test. Remove anything that doesn't.
2. **Read checkpoints in order** (oldest first). Extract only decisions, rationale, open questions, deferred work, and gotchas.
3. **Overwrite contradictions.** New facts replace old ones. If a checkpoint says "we switched from X to Y", update to reflect Y and remove X.
4. **Age out old entries.** Drop entries about work older than 30 days to make room for recent decisions. If something from 30+ days ago is still relevant, it probably belongs in CLAUDE.md, not here.
5. **Synthesize, do not append.** Never dump checkpoints verbatim. Integrate what matters.
6. **No prescribed sections.** Let content dictate structure. Use whatever headers make sense for the current entries. Do NOT include a title line or frontmatter. The document starts directly with a \`##\` header.

### Line Budget (Traffic Light)

- **Green**: under 25 lines. Healthy. Room to add.
- **Yellow**: 25-40 lines. Don't add without removing something.
- **Red**: over 40 lines. Must remove something before adding.

If the document is over 40 lines, you are almost certainly including derivable information. Re-apply the litmus test aggressively.

## Output: Write Two Files

**File 1:** Write the updated MEMORY.md to:
\`${memoryPath}\`

- No frontmatter, no title. Pure markdown starting with a \`##\` header.
- Target under 25 lines. Never exceed 40 lines.

**File 2:** Write the consolidation state JSON to:
\`${lastConsolidatedPath}\`

Content must be exactly:
\`\`\`json
{ "timestamp": "${lastBatchTimestamp}", "checkpointsConsolidated": ${newTotal} }
\`\`\`

## Constraints

- Do NOT modify or delete any checkpoint files.
- Do NOT touch plan files.
- Do NOT create any files other than the two listed above.
- If you are uncertain about a fact from the checkpoints, omit it rather than guess.`;
}
