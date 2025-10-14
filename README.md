# Goldfish 🐠

> **Your AI coding session's persistent memory** - transparent, crash-safe, radically simple

Goldfish is a developer memory system for AI agents (like Claude Code). It provides persistent memory that survives context window limits, crashes, and session restarts. Everything is stored as human-readable markdown - no database, no complexity.

**Version 4.0** - Back to basics after learning hard lessons from three previous iterations.

---

## Why Goldfish?

AI coding sessions have a memory problem:

- ❌ Context windows get compacted, losing your work history
- ❌ Sessions crash, losing planning and decisions
- ❌ Switching workspaces loses context
- ❌ No way to recall "what was I working on yesterday?"

Goldfish solves this by giving AI agents **transparent persistent memory**:

- ✅ **Checkpoints** - Save progress automatically throughout the session
- ✅ **Recall** - Restore context at session start (across all projects!)
- ✅ **Plans** - Manage long-running work that survives crashes
- ✅ **Standup Reports** - Aggregate work across all workspaces

All stored as **human-readable markdown** in `~/.goldfish/`.

---

## Quick Start

### Installation

**Prerequisites:** [Bun](https://bun.sh) runtime

```bash
# Clone the repository
git clone https://github.com/anortham/goldfish.git
cd goldfish

# Install dependencies
bun install

# Run tests (115 tests, all passing!)
bun test
```

### Configure Claude Code

Add to your Claude Code settings (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "goldfish": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/goldfish/src/server.ts"]
    }
  }
}
```

Replace `/absolute/path/to/goldfish` with your actual path.

**Restart Claude Code** and you're ready!

### Optional: Install Slash Commands

For quick access to standup reports:

```bash
# Install global slash commands
cd goldfish
./scripts/install-commands.sh
```

This adds:
- `/standup [days]` - Cross-workspace standup report
- `/checkpoint` - Manual checkpoint save
- `/recall [days]` - Recall recent work
- `/plan-status` - Show active plan

---

## How It Works

### 1. Checkpoints - Automatic Progress Saves

Claude automatically saves progress throughout your session:

```
You: "Fix the authentication timeout bug"

Claude: [works on the bug]
Claude: [checkpoints: "Fixed JWT timeout by implementing refresh token rotation"]

[Session crashes]

You: "Continue where we left off" [new session]

Claude: [recalls checkpoint]
Claude: "I see we fixed the JWT timeout bug. Let me verify the implementation..."
```

**Checkpoints are saved to:** `~/.goldfish/{workspace}/checkpoints/2025-10-14.md`

### 2. Recall - Session Start Context Restoration

Every session starts with Claude recalling recent work:

```typescript
// Claude's first action in every session (automatic)
recall({
  workspace: "current",
  days: 2
})

// Returns:
// - Active plan (if exists)
// - Recent checkpoints (last 2 days)
// - Git context (branch, commits)
```

**Cross-workspace recall** for standup reports:

```typescript
recall({ workspace: "all", days: 1 })
// Returns work from ALL projects, not just the current one
```

### 3. Plans - Long-Running Work Management

Plans are strategic documents that appear at the top of every recall:

```markdown
---
id: auth-system-redesign
title: Auth System Redesign
status: active
created: 2025-10-13T10:00:00.000Z
updated: 2025-10-14T14:30:00.000Z
tags: [auth, architecture, security]
---

## Goals
- Implement JWT refresh tokens
- Add OAuth2 support
- Migrate existing sessions

## Progress
- ✅ Designed token rotation strategy
- ✅ Updated auth middleware
- 🔄 Adding OAuth2 providers (in progress)
- ⏳ Session migration (pending)
```

**Saved to:** `~/.goldfish/{workspace}/plans/auth-system-redesign.md`

### 4. Standup Reports

Generate reports across all your projects:

```bash
/standup 1    # Yesterday's work across all workspaces
/standup 7    # Last week's summary
```

**Output:**
```
📊 Standup Report - Last 1 days

🎯 goldfish (2 checkpoints)
  - Fixed critical race conditions in checkpoint storage
  - Improved cross-workspace recall performance

🎯 codesearch (4 checkpoints)
  - Implemented fuzzy file search
  - Added symbol navigation
  - Fixed TypeScript indexing bug
  - Completed test coverage for search module
```

---

## Storage Structure

Everything is **human-readable markdown**. No database, no binary files:

```
~/.goldfish/
  goldfish/                           # Workspace (normalized from path)
    checkpoints/
      2025-10-13.md                  # Daily checkpoint files
      2025-10-14.md
    plans/
      auth-system-redesign.md        # Individual plans (YAML frontmatter)
      api-v2-migration.md
    .active-plan                     # Contains active plan ID

  codesearch/                         # Another workspace
    checkpoints/
      2025-10-14.md
    plans/...
```

**You can read, edit, or delete these files directly.** They're yours.

---

## Features

### ✅ **Crash-Safe**

Atomic file operations prevent corruption:
- Write to temp file → atomic rename
- No partial writes
- No corruption on crashes

### ✅ **Git-Aware**

Automatically captures git context:
- Current branch
- Latest commit hash
- Changed files

### ✅ **Fuzzy Search**

Search across all checkpoints:

```typescript
recall({
  workspace: "all",
  days: 30,
  search: "redis cache bug"
})
```

Powered by [fuse.js](https://fusejs.io/) - the same search engine from original Goldfish.

### ✅ **Cross-Workspace Aggregation**

See work across ALL projects:
- Standup reports
- Cross-project recall
- Unified work history

### ✅ **Human-Readable**

Everything is markdown:
- Edit in any text editor
- Git-friendly
- Transparent storage
- No vendor lock-in

---

## Architecture Decisions

This is **iteration #4** of a developer memory system. We've learned from mistakes:

| Decision | Why |
|----------|-----|
| **Markdown storage** | Human-readable, git-friendly, transparent (no database) |
| **Fuse.js search** | Fast fuzzy search, proven from original Goldfish |
| **Aggressive behavioral language** | Makes agents use tools proactively without asking permission |
| **No hooks initially** | Validate behavioral language works before adding complexity |
| **Atomic file operations** | Prevents corruption on crashes (write temp → rename) |
| **UTC timestamps everywhere** | No timezone bugs (learned from v1) |
| **No deduplication** | Let Claude be smart, keep storage simple |
| **Evidence-based features** | Only add complexity when proven necessary |

### Previous Iterations

1. **Original Goldfish (TypeScript)** - Good concepts, critical bugs (race conditions, date handling)
2. **Tusk (Bun + SQLite)** - Fixed bugs, added features, became too complex, hook spam disaster
3. **.NET rewrite** - Over-engineered, never finished
4. **Goldfish 4.0** - Modular architecture, comprehensive testing, evidence-based development

---

## Development

**This is a TDD project.** Every feature has tests. Currently: **115 tests, all passing.**

```bash
# Run all tests
bun test

# Run tests in watch mode (recommended during development)
bun test --watch

# Run specific test file
bun test tests/checkpoints.test.ts

# Run with coverage
bun test --coverage
```

**Test-Driven Development workflow:**

1. Write test first (watch it fail)
2. Implement minimum code to pass
3. Refactor if needed
4. Commit test + implementation together

See `CONTRIBUTING.md` for detailed development guidelines.

---

## Performance

Simple doesn't mean slow:

| Operation | Target | Reality |
|-----------|--------|---------|
| Checkpoint save | < 50ms | ~10ms |
| Recall (7 days, single workspace) | < 100ms | ~30ms |
| Recall (7 days, all workspaces) | < 500ms | ~150ms |
| Search (100 checkpoints) | < 50ms | ~15ms |

Benchmarked on Apple Silicon (M1).

---

## Success Metrics

We're building this right if:

- ✅ Agents checkpoint proactively without being asked
- ✅ Agents recall at session start automatically
- ✅ All data is readable in any text editor
- ✅ Standup reports work across all workspaces
- ✅ Code is well-structured and maintainable
- ✅ Every feature has tests (TDD)

**Current status:** All metrics met ✅

---

## Documentation

- **`README.md`** (this file) - User-facing documentation
- **`CLAUDE.md`** - AI agent usage guide (how to use Goldfish effectively)
- **`AGENTS.md`** - Pointer to CLAUDE.md for AI agents
- **`CONTRIBUTING.md`** - Development guide (TDD workflow, patterns, principles)
- **`docs/IMPLEMENTATION.md`** - Detailed technical specification
- **`INSTALL.md`** - Installation instructions for slash commands

---

## Philosophy

**Radical simplicity.**

We only add complexity when we have EVIDENCE it's needed. No premature optimization. No "nice to have" features. No database "because it's better."

Let markdown be your database. Let Claude be the intelligence. Keep Goldfish as transparent storage.

---

## Troubleshooting

### Claude isn't checkpointing or recalling

1. Verify MCP server is running: Check Claude Code logs
2. Check server path: Ensure `~/.claude/settings.json` has correct absolute path
3. Restart Claude Code: MCP servers load at startup
4. Test manually: Run `bun run src/server.ts` and check for errors

### Checkpoints aren't saving

1. Check permissions: Ensure `~/.goldfish/` is writable
2. Check disk space: Goldfish needs minimal space (~1KB per checkpoint)
3. Check logs: Run server with `bun run src/server.ts` to see errors

### Recall returns old data

1. Workspaces are separate: Each project has its own workspace
2. Check workspace name: Run `/recall` to see current workspace
3. Increase days: Try `recall({ days: 7 })` for more history

### Cross-workspace recall is slow

1. This is normal for many workspaces (still < 500ms target)
2. Reduce days: Try `recall({ workspace: "all", days: 1 })`
3. Use specific workspace: `recall({ workspace: "goldfish" })`

---

## Contributing

We welcome contributions! But we're **very selective about new features**.

Before adding anything, ask:

1. **Do we have EVIDENCE this is needed?** (from real usage)
2. **Can the agent handle this with existing tools?** (let Claude be smart)
3. **Does this add significant complexity?** (keep it simple)
4. **Have we written the test first?** (TDD mandatory)

See `CONTRIBUTING.md` for development workflow and guidelines.

---

## License

MIT - see `LICENSE` file

---

## Credits

Built by [murphy](https://github.com/anortham) after three previous iterations and many lessons learned.

Inspired by the original Goldfish concept and the realization that **radical simplicity** beats clever complexity.

---

## Status

**Production ready.** Version 4.0.0

- 115 tests, all passing
- All critical bugs fixed (race conditions, empty workspace names, date handling)
- Cross-workspace recall optimized with parallelization
- File locking implemented for safety
- Full test coverage for edge cases

Ready for real-world use! 🚀
