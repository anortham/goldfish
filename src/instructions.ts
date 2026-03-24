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

**Checkpoint after:**
- Completing a feature, bug fix, or refactor step
- Making a key decision or discovery
- Committing or pushing completed work
- Reaching a natural stopping point in a session
- Before context compaction (PreCompact hook handles this automatically)

Space out checkpoints so each one captures a distinct piece of progress — one per logical milestone is the right cadence.

### Writing Good Checkpoints

Descriptions are stored as markdown files. Use structure — headers, bullets, bold. Include:
- **WHAT** — the change or accomplishment
- **WHY** — the problem solved or goal achieved
- **HOW** — key approach, decision, or discovery
- **IMPACT** — what unblocked, improved, or was learned

Use \`type\` to classify: \`"decision"\` (include \`decision\` + \`alternatives\`), \`"incident"\` (include \`context\` + \`evidence\`), \`"learning"\` (include \`impact\`). All types benefit from \`symbols\`, \`next\`, and \`impact\`.

### Planning (ExitPlanMode)
1. When ExitPlanMode is called → save plan within 1 exchange
2. Use plan({ action: "save", title: "...", content: "...", activate: true })
3. Save immediately — don't ask permission
4. Activate the plan so it appears in future recall() responses

## Recall

Recall restores context from previous sessions. The SessionStart hook prompts you to call recall() at the start of each session. Users can also invoke \`/recall\` manually for targeted queries.

**Recall tips:**
- \`full: true\` for git metadata (branches, files, commits)
- \`search: "query"\` for fuzzy search across past work
- \`workspace: "all"\` for cross-project standup reports
- \`limit: 0\` for active plan only, no checkpoints

Trust recalled context — don't re-verify information from checkpoints.

## Storage

All data is stored as human-readable markdown in {project}/.memories/:
- Checkpoints: Individual YAML frontmatter files ({date}/{HHMMSS}_{hash}.md)
- Plans: Individual files (plans/{plan-id}.md)
- Cross-project registry: ~/.goldfish/registry.json

Everything is transparent, git-committable, and human-readable.

## Consolidation

MEMORY.md is the project's consolidated understanding, built from checkpoints. When recall flags \`consolidation.needed: true\`, dispatch a background consolidation subagent:

1. Call \`consolidate()\` to get the payload
2. If status is "ready": dispatch a background subagent with the payload's \`prompt\` field. The prompt contains all file paths and instructions the subagent needs.
3. If status is "current": nothing to do, memory is up to date
4. Continue your work - the subagent handles the rest

Hooks will prompt you to consolidate when needed (e.g., before context compaction), but you can also trigger it manually any time.

## Source Control

ALWAYS commit the \`.memories/\` directory (including MEMORY.md, checkpoints, and plans) to source control. These are project artifacts, not ephemeral state. Never add \`.memories/\` to .gitignore.`;
}
