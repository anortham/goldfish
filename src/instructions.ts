/**
 * Server behavioral instructions for Goldfish MCP Server
 *
 * Contains the core workflow instructions that guide AI agents
 * on how to properly use the Goldfish memory system.
 */

/**
 * Get server behavioral instructions
 */
export function getInstructions(): string {
  return `You are working with Goldfish, a transparent developer memory system.

## Checkpointing

Checkpoint your work so future sessions have context. **When in doubt, checkpoint** — a few extra checkpoints are better than lost context.

**Checkpoint when:**
- Completing a feature, bug fix, or refactor step
- Making a key decision or discovery
- Reaching a natural stopping point in a session
- Before context compaction (PreCompact hook handles this automatically)
- **Before a git commit** (so the checkpoint file is included in the commit)

Space out checkpoints so each one captures a distinct piece of progress — one per logical milestone is the right cadence. See the checkpoint tool description for formatting guidance.

## Briefs

Save a brief when the project's strategic direction changes or when durable context should survive future sessions:
brief({ action: "save", title: "...", content: "..." })

Use briefs for compact forward-looking context, not copied execution plans. Saved briefs with status: active become active by default. Use activate: false to keep the current active brief unchanged, or activate: true when you want to be explicit. Completed or archived briefs do not replace the current active brief.

## Recall

Recall restores context from previous sessions. The SessionStart hook calls recall() automatically. Users can also invoke \`/recall\` for targeted queries.

Trust recalled context — don't re-verify information from checkpoints.

## Consolidation

When recall flags \`consolidation.needed: true\`, dispatch a background consolidation subagent:
1. Call \`consolidate()\` to get the payload
2. If status is "ready": dispatch a background subagent with the payload's \`prompt\` field
3. If status is "current": nothing to do
4. Continue your work — the subagent handles the rest

## Source Control

ALWAYS commit \`.memories/\` to source control. These are project artifacts, not ephemeral state. Never add \`.memories/\` to .gitignore.`;
}
