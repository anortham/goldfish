/**
 * Build the subagent prompt for memory consolidation.
 *
 * The prompt tells the subagent to read checkpoint files from disk
 * rather than receiving content inline.
 */

/**
 * @param memoryPath - Absolute path to memory.yaml (may not exist yet)
 * @param lastConsolidatedPath - Absolute path to consolidation state JSON
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

  return `You are a memory consolidation subagent. Your job is to distill developer checkpoints into a lean memory.yaml that captures only what cannot be derived from the codebase, git log, or tools.

## Inputs

Read the following files using the Read tool:

1. **Current memory file** (baseline): \`${memoryPath}\`
   - If the file does not exist, this is the first consolidation. Start from scratch.
   - The file may be YAML (new format) or markdown (legacy). Either way, use it as baseline context.

2. **Checkpoint files** (read in this exact order, oldest first):
${fileList}
   - Each file has YAML frontmatter (between \`---\` markers) with metadata fields, followed by a markdown body (the checkpoint description).
   - Extract durable facts from the markdown body. The frontmatter contains timestamp, tags, type, and optional structured fields (decision, context, impact, symbols, next).

3. **Active plan** (optional context): ${planSection}

## Output Format: YAML

Write a YAML file with exactly these four section keys (omit sections with no entries):

\`\`\`yaml
decisions:
  - "YYYY-MM-DD | description of decision and rationale"

open_questions:
  - "YYYY-MM-DD | unresolved question or uncertainty"

deferred_work:
  - "YYYY-MM-DD | what is blocked, why, and what unblocks it"

gotchas:
  - "YYYY-MM-DD | non-obvious thing discovered through experience"
\`\`\`

**Format rules:**
- Each entry is a single quoted string: \`"YYYY-MM-DD | description"\`
- The date is when the entry was discovered/decided (from checkpoint timestamps)
- Entries sorted chronologically within each section, newest at the bottom
- Blank line between sections
- Omit sections that have no entries (no empty arrays)
- Section order when present: decisions, open_questions, deferred_work, gotchas

## Synthesis Instructions

**Litmus test: if you can derive it from the codebase, git log, or tools, it doesn't belong in memory.yaml.**

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

1. **Start from existing memory.** Preserve entries that are still accurate. Do not rewrite entries that haven't changed.
2. **Read checkpoints in order** (oldest first). Extract only decisions, rationale, open questions, deferred work, and gotchas.
3. **Overwrite contradictions.** If a checkpoint says "we switched from X to Y", update the existing entry to reflect Y. Remove entries that are no longer true.
4. **Age out old entries.** Drop entries with dates older than 30 days to make room for recent decisions. If something from 30+ days ago is still relevant, it probably belongs in CLAUDE.md, not here.
5. **Add new entries.** Append new entries at the bottom of their section (chronological order).
6. **Remove stale entries.** Delete entries that are resolved, no longer relevant, or contradicted by newer information.
7. **Minimize the diff.** Only touch entries that need to change. Unchanged entries must remain exactly as they are, character for character. This is critical for version control merges across multiple machines.

### Entry Budget (Traffic Light)

- **Green**: under 25 entries total. Healthy. Room to add.
- **Yellow**: 25-40 entries. Don't add without removing something.
- **Red**: over 40 entries. Must remove something before adding.

If over 40 entries, you are almost certainly including derivable information. Re-apply the litmus test aggressively.

## Output: Write Two Files

**File 1:** Write the updated memory.yaml to:
\`${memoryPath}\`

- Pure YAML, no frontmatter. Starts directly with a section key.
- Target under 25 entries total. Never exceed 40.

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
