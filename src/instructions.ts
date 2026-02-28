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

Checkpoint when you complete **meaningful milestones** — not after every action.

**When to checkpoint:**
- Completed a deliverable (feature, bug fix, refactor step)
- Made a decision that future sessions need to know about
- Found a non-obvious discovery or blocker worth preserving
- Before context compaction (the PreCompact hook handles this automatically)

**Do NOT checkpoint:**
- After every small edit or routine step
- After test runs that simply pass
- Multiple times for the same work — if you just checkpointed, you don't need another
- With near-identical descriptions to a recent checkpoint

Think of checkpoints like git commits: one per logical milestone, not one per keystroke.

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

Recall is **user-initiated** via the /recall command. Use it when you need prior context — don't call it automatically at session start.

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

Everything is transparent, git-committable, and human-readable.`;
}
