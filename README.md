# Goldfish 🐠

> Your development session's transparent memory - markdown-based, git-friendly, radically simple

Goldfish is a **crash-safe developer's work journal** that acts like persistent memory for AI coding sessions. Version 4.0 - back to basics.

## What Makes Goldfish Different

This is iteration #4. We've tried databases, complex hooks, and sophisticated deduplication. We learned:

**Radical simplicity wins.** Everything is markdown. No database. No hooks (initially). Let Claude be the intelligence, Goldfish just provides transparent storage.

## Quick Start

```bash
# Install dependencies
bun install

# Run tests (TDD project - tests required!)
bun test --watch

# Run MCP server
bun run dev
```

## Core Features

### 1. Checkpoints
Save work progress to markdown files that survive crashes and context compaction:

```typescript
checkpoint({
  description: "Fixed JWT timeout bug with refresh tokens",
  tags: ["bug-fix", "auth", "critical"]
})
```

Stored in: `~/.goldfish/{workspace}/checkpoints/2025-10-13.md`

### 2. Recall
Restore context from previous sessions with fuzzy search:

```typescript
recall({
  workspace: "all",  // or "current" or specific path
  days: 7,
  search: "authentication"
})
```

### 3. Plans
Manage long-running work with markdown plans (YAML frontmatter):

```typescript
plan({
  action: "save",
  title: "Auth System Redesign",
  content: "## Goals\n- JWT refresh\n- OAuth2..."
})
```

### 4. Cross-Workspace Standups
Aggregate work across ALL projects:

```bash
/standup 1  # Yesterday's work across all workspaces
```

## Storage Structure

Everything is human-readable markdown:

```
~/.goldfish/
  codesearch/
    checkpoints/
      2025-10-13.md       # Daily checkpoint files
    plans/
      auth-system.md      # Individual plans
    .active-plan          # Just contains: "auth-system"
  goldfish/
    checkpoints/...
    plans/...
```

## Development

**This is a TDD project. Tests are mandatory.**

```bash
# Write test first
bun test tests/checkpoints.test.ts --watch

# Implement
# Edit src/checkpoints.ts

# Commit
git commit -m "Add checkpoint storage with tests"
```

See `CLAUDE.md` for detailed development guidelines.

## Architecture Decisions

✅ **Markdown storage** - Human-readable, git-friendly, transparent
✅ **Fuse.js search** - Fast fuzzy search, proven from original Goldfish
✅ **Aggressive behavioral language** - Makes agents use tools proactively
✅ **No hooks initially** - Validate behavioral language works first
✅ **Atomic file operations** - Prevent corruption on crashes
✅ **UTC timestamps everywhere** - No date/timezone bugs

❌ **No database** - Keeping it simple
❌ **No complex deduplication** - Let Claude handle intelligence
❌ **No confidence scores** - Unnecessary complexity
❌ **No premature optimization** - Evidence-based feature development

## Lessons from Previous Iterations

1. **Original Goldfish (TS)**: Good concepts, critical bugs (race conditions, dates)
2. **Tusk (Bun + SQLite)**: Fixed bugs, became too complex, hook spam
3. **.NET rewrite**: Over-engineered, never finished
4. **Goldfish 4.0**: Back to basics, radically simple, evidence-based

## Success Metrics

We're building this right if:
- ✅ Agents checkpoint proactively without being asked
- ✅ Agents recall at session start automatically
- ✅ All data readable in any text editor
- ✅ Standup reports work across all workspaces
- ✅ Core code stays under 500 lines
- ✅ Every feature has tests (TDD)

## Documentation

- `CLAUDE.md` - Development guide (TDD workflow, patterns, principles)
- `docs/IMPLEMENTATION.md` - Detailed technical specification
- `README.md` - This file (user-facing documentation)

## License

MIT
