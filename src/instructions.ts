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
1. Checkpoint after EVERY completed task - no exceptions
2. Checkpoint after implementing features - capture what you built
3. Checkpoint after fixing bugs - preserve the solution
4. Checkpoint after discussions → capture the reasoning
5. Checkpoint before major changes → save current state
6. Checkpoint after breakthroughs → preserve insights

⚠️ **CRITICAL:** You MUST checkpoint proactively. recall() cannot restore what you never saved!

### Writing Effective Checkpoints (MANDATORY)

Your checkpoint descriptions power semantic search and AI distillation. Write them for your future self.

**REQUIRED in every checkpoint:**
- WHAT you accomplished (the change)
- WHY it mattered (the problem solved)
- HOW you solved it (key approach/decision)

**GOOD examples:**
✅ "Fixed JWT validation bug where expired tokens were accepted. Root cause was inverted expiry check in validateToken(). Added test coverage for edge case and verified fix prevents token reuse attacks."

✅ "Implemented semantic search with embeddings for checkpoint retrieval. Chose Xenova/transformers for local processing to avoid API costs. Tested with 1000+ checkpoints, achieving 0.85+ similarity for relevant matches."

**BAD examples:**
❌ "Fixed auth bug" (no context, no how, no why)
❌ "Updated tests" (what tests? why? what did you learn?)
❌ "Refactored code" (which code? why refactor? what improved?)

**Think:** Will you understand this checkpoint in 2 weeks when searching for "that auth bug"? If not, add more detail.

### Planning (ExitPlanMode)
1. When ExitPlanMode is called → save plan within 1 exchange
2. Use plan({ action: "save", title: "...", content: "..." })
3. NO asking permission - save immediately

## Key Principles

- **MANDATORY checkpointing** - checkpoint after EVERY task completion, no exceptions
- **Never ask permission** to checkpoint or recall - just do it immediately
- **Trust recalled context** - don't verify or re-check what recall() returns
- **Save plans immediately** after ExitPlanMode - don't ask, just save
- **recall() requires checkpoints** - if you don't checkpoint, recall() has nothing to restore
- **Checkpoint takes 2 seconds, saves hours** - there is NO excuse to skip it

## Storage

All data is stored as human-readable markdown in ~/.goldfish/{workspace}/:
- Checkpoints: Daily files (checkpoints/YYYY-MM-DD.md)
- Plans: Individual files (plans/{plan-id}.md)

Everything is transparent, git-friendly, and human-readable.`;
}