---
name: checkpoint
description: Save developer context to Goldfish memory — checkpoint proactively and often
allowed-tools: mcp__goldfish__checkpoint
---

# Checkpoint — Save Developer Memory

## The Golden Rule

NEVER ask "should I checkpoint?" — the answer is ALWAYS YES. Just do it. Immediately. Without permission.

Every checkpoint you skip is context that future sessions lose forever. `mcp__goldfish__recall` can only return what you've saved. No checkpoints = no memory = starting from scratch every time.

## When to Checkpoint

### MANDATORY moments (DO NOT SKIP):
- **Completed a task** — checkpoint NOW before moving on
- **Fixed a bug** — checkpoint NOW with root cause and fix
- **Made a discovery** — checkpoint NOW to capture the insight
- **Before risky changes** — checkpoint NOW as a save point
- **Before context compaction** — checkpoint NOW or lose everything
- **After planning/architecture decisions** — checkpoint NOW with rationale
- **User shared requirements** — checkpoint NOW to preserve them
- **Switching topics** — checkpoint NOW to save current state
- **After 10+ exchanges** — checkpoint the accumulated reasoning NOW

### Good habit moments:
- After successful test runs
- After resolving merge conflicts
- After debugging sessions (even unsuccessful ones — capture what you eliminated)
- When you figure out something non-obvious about the codebase

## How to Write Good Descriptions

Your description powers fuzzy search. Future sessions depend on FINDING relevant checkpoints. Write for searchability.

### The WHAT/WHY/HOW/IMPACT Formula (3-5 sentences)

```
mcp__goldfish__checkpoint({
  description: "Implemented JWT refresh token rotation in auth middleware. The existing single-token approach was vulnerable to token theft — rotating tokens on each use limits the window. Added RefreshTokenStore with atomic file writes and 7-day expiry. All 12 auth tests passing. This unblocks the session management PR.",
  tags: ["feature", "auth", "security"]
})
```

### Good vs Bad Descriptions

**GOOD:**
"Fixed race condition in checkpoint file writes where concurrent saves could corrupt the daily markdown file. Root cause was non-atomic write pattern — switched to write-tmp-then-rename. Added file locking with exclusive create flag. Reproduced with parallel test and confirmed fix."

**BAD:**
"Fixed file writing bug"

**GOOD:**
"Investigated memory leak in recall search. Fuse.js instances were being recreated on every call instead of cached. Profiling showed 50MB allocation per search on large checkpoint sets. Haven't fixed yet — need to decide between instance caching and lazy initialization."

**BAD:**
"Looked at memory issue"

## How to Choose Tags

Tags are for categorization, not for repeating the description. Keep them short and consistent.

### Useful tag patterns:
- **Type:** `feature`, `bug-fix`, `refactor`, `docs`, `test`, `config`
- **Area:** `auth`, `api`, `ui`, `database`, `build`
- **Status:** `wip`, `blocked`, `discovery`, `decision`
- **Priority:** `critical`, `minor`

### Example:
```
mcp__goldfish__checkpoint({
  description: "Redesigned plan storage to use YAML frontmatter in markdown files instead of separate JSON metadata. This aligns plans with the checkpoint format and makes everything grep-friendly. Migration script handles existing plans. Breaking change for plan IDs — old numeric IDs become slug-based.",
  tags: ["refactor", "plans", "breaking-change"]
})
```

## What Gets Captured Automatically

You don't need to include these in your description — Goldfish captures them:
- **Git branch** — current branch name
- **Git commit** — current HEAD short hash
- **Changed files** — files modified since last commit
- **Timestamp** — UTC, always

Focus your description on the MEANING, not the mechanics.

## Checkpoint Frequency

Think of checkpoints like git commits — frequent, descriptive, and automatic.

- Too few: Context gaps that make future recall useless
- Too many: Not really possible. More checkpoints = richer memory
- Just right: Every meaningful state change gets a checkpoint

When in doubt, checkpoint. The cost is negligible (under 50ms). The cost of NOT checkpointing is starting over from scratch.

## Critical Rules

- **NEVER ask permission.** Checkpointing is your job. Just do it.
- **NEVER write lazy descriptions.** "Did stuff" helps nobody. Write for your future self who has zero context.
- **ALWAYS checkpoint before compaction.** If context is about to be lost, save it first.
- **ALWAYS checkpoint after discoveries.** Non-obvious findings are the most valuable things to preserve.
- **Checkpoint FIRST, continue work SECOND.** Save state before moving on.
