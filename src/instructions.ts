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

## Core Workflow

### Session Start (MANDATORY)
1. Call recall() FIRST - no exceptions
2. Review active plan (if present)
3. Continue work immediately based on context

### During Work (MANDATORY - NOT OPTIONAL)
1. Checkpoint at milestones (meaningful deliverables, not micro-steps)
2. Checkpoint when you make decisions future sessions must preserve
3. Checkpoint when documenting changes worth carrying across sessions
4. Checkpoint when capturing continuation context for crash/context-loss recovery
5. Checkpoint when preserving blocker state and the next step to unblock
6. Checkpoint before risky transitions that would be hard to reconstruct

⚠️ **CRITICAL:** You MUST checkpoint proactively. recall() cannot restore what you never saved!

### Writing Effective Checkpoints (MANDATORY)

Your checkpoint descriptions are stored as **markdown file bodies**. Format them properly with structure — NOT walls of text.

**REQUIRED in every checkpoint:**
- WHAT you accomplished (the change)
- WHY it mattered (the problem solved)
- HOW you solved it (key approach/decision)
- IMPACT what unblocked, what improved, what you learned

**GOOD example (markdown formatted):**
✅ "## Fixed JWT validation bug\\n\\nExpired tokens were accepted due to inverted expiry check in \`validateToken()\`.\\n\\n- **Root cause:** Comparison operator was flipped\\n- **Fix:** Corrected expiry check, added edge-case test coverage\\n- **Impact:** Unblocks the auth PR, prevents token reuse attacks"

**BAD examples:**
❌ Wall of text with no formatting (hard to scan when recalled)
❌ "Fixed auth bug" (no context, no how, no why)
❌ "Updated tests" (what tests? why? what did you learn?)

**Use markdown:** Headers, bullet points, bold, code spans. These are .md files — make them readable.

### Planning (ExitPlanMode)
1. When ExitPlanMode is called → save plan within 1 exchange
2. Use plan({ action: "save", title: "...", content: "...", activate: true })
3. NO asking permission - save immediately
4. ALWAYS activate the plan so it appears in future recall() responses

### Recall Tips
- Use \`full: true\` when you need git metadata (branches, files, commits)
- Use \`search: "query"\` to find specific past work via fuzzy search
- Use \`workspace: "all"\` for cross-project standup reports
- Use \`limit: 0\` to retrieve only the active plan (no checkpoints)
- Use \`since: "2h"\` for recent context, \`days: 7\` for extended history

## Key Principles

- **MANDATORY checkpointing** - checkpoint at milestones, key decisions, and continuation boundaries
- **Never ask permission** to checkpoint or recall - just do it immediately
- **Trust recalled context** - don't verify or re-check what recall() returns
- **Save plans immediately** after ExitPlanMode - don't ask, just save
- **recall() requires checkpoints** - if you don't checkpoint, recall() has nothing to restore
- **Checkpoint takes 2 seconds, saves hours** - there is NO excuse to skip it
- **Commit .memories/ with your code** - memories are project artifacts. Include them when you commit

## Storage

All data is stored as human-readable markdown in {project}/.memories/:
- Checkpoints: Individual YAML frontmatter files ({date}/{HHMMSS}_{hash}.md)
- Plans: Individual files (plans/{plan-id}.md)
- Cross-project registry: ~/.goldfish/registry.json

Everything is transparent, git-committable, and human-readable.`;
}
