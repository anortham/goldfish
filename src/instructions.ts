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

## Workspace binding

User-level MCP registrations must pass the conversation's host-native absolute project root as workspace on every checkpoint, brief, and current-project recall call. Project-level servers may omit workspace with fixed absolute GOLDFISH_WORKSPACE or supported legacy Roots. In a git worktree, pass the worktree path, not the main checkout. recall({ workspace: "all" }) is explicit cross-project search, not a fallback; invalid for checkpoint or brief. Cwd, registry, and parent-walk candidates are suggestions only. If unbound, retry with {"workspace":"<absolute-project-root>"}.

## Checkpointing

Checkpoint what a future session will need. Don't ask permission, do it.

**Checkpoint when:**
- A consequential decision (note the rejected option)
- A surprising failure (with evidence)
- Stopping with unfinished work, or before compaction (set \`next\`)

Routine edits and commits need none. If a commit follows, checkpoint **BEFORE the commit** so it ships to other machines.

See the checkpoint tool description.

## Briefs

Save a brief when direction or context must survive:
brief({ workspace: "/absolute/path/to/project", action: "save", title: "...", content: "..." })

Keep the brief honest: update it when goals or constraints shift, complete it when the work lands, archive it when superseded. activate: true makes a brief active; activate: false keeps the current brief.

Use briefs for direction, not copied plans. Completed or archived briefs do not replace it.

## Recall

Call recall({ workspace: "/absolute/path/to/project" }) when resuming prior work, after context loss, when asked, or when decisions matter.

Treat recalled context as historical evidence. Preserve decisions; verify current or drift-prone facts against live sources.

## Source Control

ALWAYS commit \`.memories/\` to source control. These are project artifacts, not ephemeral state. Never add \`.memories/\` to .gitignore.`;
}
