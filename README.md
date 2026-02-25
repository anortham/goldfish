# Goldfish 🐠

Persistent developer memory for Claude Code. Checkpoints, recall, plans, and standup reports -- stored as human-readable markdown, right in your project.

Goldfish gives AI coding sessions memory that survives context compaction, crashes, and session restarts. Data lives in `.memories/` (git-committable) with a lightweight cross-project registry at `~/.goldfish/registry.json`.

**Version 5.3.0** -- Fifth iteration, built on hard lessons from four previous attempts.

---

## Why Goldfish?

AI coding sessions have a memory problem:

- Context windows get compacted, losing work history
- Sessions crash, losing planning and decisions
- Switching projects loses context
- No way to answer "what was I working on yesterday?"

Goldfish solves this with three MCP tools (checkpoint, recall, plan), five skills, and three hooks that make memory automatic and transparent.

---

## Quick Start

**Prerequisites:** [Bun](https://bun.sh) runtime (v1.0+)

### Option 1: Install from GitHub (Recommended)

This gives you the full experience: MCP tools + skills (`/checkpoint`, `/recall`, `/plan`, `/standup`, `/plan-status`) + hooks (auto-recall on session start, auto-checkpoint before compaction, auto-save plans).

```bash
# Add the Goldfish repository as a plugin marketplace
/plugin marketplace add anortham/goldfish

# Install the plugin (user scope, available across all projects)
/plugin install goldfish@goldfish
```

You can also scope the installation to a specific project:

```bash
# Project scope (shared with team via version control)
/plugin install goldfish@goldfish --scope project
```

### Option 2: Install from a Local Clone

If you prefer to clone the repo yourself (useful for development or contributing):

```bash
# Clone the repository
git clone https://github.com/anortham/goldfish.git

# Install dependencies
cd goldfish && bun install

# Install as a Claude Code plugin
claude plugin install /path/to/goldfish
```

**For development (loads plugin from local directory each time):**

```bash
claude --plugin-dir /path/to/goldfish
```

Once the plugin is loaded, Goldfish works automatically:

1. **Session starts** -- the `SessionStart` hook fires, calling `recall()` to restore recent context
2. **You work** -- checkpoint manually with `/checkpoint`, or let the `PreCompact` hook auto-checkpoint before context compaction
3. **Plans persist** -- the `ExitPlanMode` hook auto-saves plans to `.memories/plans/`
4. **Next session** -- everything is recalled automatically

No configuration needed beyond plugin installation.

### Option 3: Use as a Standalone MCP Server (Any MCP Client)

Goldfish is a standard [MCP](https://modelcontextprotocol.io/) server. It works with any MCP-compatible client -- not just Claude Code.

```bash
# Clone and install
git clone https://github.com/anortham/goldfish.git
cd goldfish && bun install
```

**Add to your MCP client's configuration** (the exact format depends on your client):

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

For Claude Code specifically, add this to your project's `.mcp.json` or `~/.claude/settings.json`:

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

**What you get with standalone MCP:** The 3 core tools (`checkpoint`, `recall`, `plan`) and the server instructions that guide agent behavior. **What you don't get:** Skills (`/checkpoint`, `/recall`, `/plan`, `/standup`, `/plan-status`) and hooks (auto-recall, auto-checkpoint, auto-plan-save) -- those are Claude Code plugin features.

For standalone MCP usage, you'll want to instruct your agent to:
- Call `recall()` at session start
- Call `checkpoint()` after completing work
- Call `plan()` to save and manage long-running plans

### VS Code with GitHub Copilot

Create a `.vscode/mcp.json` file in your project root:

```json
{
  "servers": {
    "Goldfish": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/goldfish/src/server.ts"],
      "env": {
        "GOLDFISH_WORKSPACE": "${workspaceFolder}"
      }
    }
  }
}
```

The `GOLDFISH_WORKSPACE` environment variable tells Goldfish where your project root is. VS Code automatically substitutes `${workspaceFolder}` with the actual path.

Without this, Goldfish may create its `.memories/` directory in the wrong location since VS Code's MCP integration doesn't pass `cwd` the way Claude Code does.

---

## How It Works

### Checkpoint -- Save Progress

Checkpoints capture what you did, why, and how. They're saved as individual markdown files with YAML frontmatter.

```
You: "Fix the authentication timeout bug"

Claude: [works on the bug]
Claude: [checkpoints: "Fixed JWT timeout by implementing refresh token rotation.
         Root cause was single-use token with no renewal path. Added
         RefreshTokenStore with 7-day expiry. Auth tests passing."]

[Session crashes or compacts]

You: [new session]
Claude: [auto-recalls checkpoint, picks up where it left off]
```

**Saved to:** `{project}/.memories/2026-02-14/143022_a1b2.md`

### Recall -- Restore Context

Every session starts with recall (automatic via `SessionStart` hook). Returns recent checkpoints, active plan, and optional cross-project summaries.

```
recall()                                    # Last 5 checkpoints, no date window
recall({ since: "2h" })                     # Last 2 hours
recall({ search: "auth bug" })              # Fuzzy search
recall({ days: 7, limit: 20, full: true })  # Extended history with metadata
recall({ workspace: "all", days: 1 })       # Cross-project (for standups)
recall({ limit: 0 })                        # Active plan only
```

### Plan -- Track Long-Running Work

Plans are strategic markdown documents that survive across sessions. They appear at the top of every `recall()` response.

```markdown
---
id: auth-system-redesign
title: Auth System Redesign
status: active
created: 2026-02-10T10:00:00.000Z
updated: 2026-02-14T14:30:00.000Z
tags: [auth, architecture, security]
---

## Goals
- Implement JWT refresh tokens
- Add OAuth2 support
- Migrate existing sessions

## Progress
- [x] Designed token rotation strategy
- [x] Updated auth middleware
- [ ] Adding OAuth2 providers (in progress)
- [ ] Session migration (pending)
```

**Saved to:** `{project}/.memories/plans/auth-system-redesign.md`

---

## Skills

Skills are invocable via `/skill-name` in Claude Code. They provide guided workflows on top of the MCP tools.

| Skill | What It Does |
|-------|-------------|
| `/checkpoint` | Save a checkpoint with rich description and tags |
| `/recall` | Restore context from recent checkpoints and active plan |
| `/standup` | Generate a cross-project standup report |
| `/plan` | Create and manage persistent plans for multi-session work |
| `/plan-status` | Assess progress against the active plan |

Skills live in the `skills/` directory, each with a `SKILL.md` file containing behavioral instructions.

---

## Hooks

Hooks fire automatically at key moments. No manual trigger needed.

| Hook | Trigger | Action |
|------|---------|--------|
| `PreCompact` | Context window compaction | Auto-checkpoint current progress before memory is lost |
| `SessionStart` | New session begins | Auto-recall recent work to restore context |
| `PostToolUse` (ExitPlanMode) | Plan mode exits | Auto-save the plan to `.memories/plans/` |

Hook definitions live in `hooks/hooks.json`.

---

## Storage Format

Everything is human-readable markdown. No database. No binary formats.

### Project-Level Storage

```
your-project/
  .memories/
    2026-02-13/
      091500_a1b2.md          # Individual checkpoint (YAML frontmatter + markdown)
      143022_c3d4.md
    2026-02-14/
      101530_e5f6.md
    plans/
      auth-system-redesign.md  # Plan (YAML frontmatter + markdown body)
      api-v2-migration.md
    .active-plan               # Contains the active plan ID
```

### Checkpoint File Format

```markdown
---
id: checkpoint_a1b2c3d4
timestamp: 2026-02-14T14:30:22.000Z
tags:
  - bug-fix
  - auth
git:
  branch: fix/jwt-timeout
  commit: abc1234
  files:
    - src/auth/jwt.ts
    - tests/auth.test.ts
summary: Fixed JWT timeout bug with refresh token rotation
---

Fixed JWT validation bug where expired tokens were accepted. Root cause
was inverted expiry check in validateToken(). Added test coverage for
the edge case and verified the fix prevents token reuse attacks.
```

### Cross-Project Registry

```
~/.goldfish/
  registry.json    # Auto-populated list of projects using Goldfish
```

The registry tracks which projects have `.memories/` directories. It is populated automatically on checkpoint save and used by cross-project recall for standup reports.

---

## Cross-Project Features

### Standup Reports

The `/standup` skill aggregates work across all registered projects:

```
## Standup -- February 14, 2026

### goldfish
- Rewrote README for v5.0.0, added skill and hook documentation
- Added 4 skills and 3 hooks for Claude Code plugin

> **Next:** Test plugin installation flow end-to-end

### api-gateway
- Fixed rate limiter race condition in Redis cluster mode

> **Blocked:** Waiting on DevOps for staging Redis cluster provisioning
```

Cross-project recall uses `~/.goldfish/registry.json` to discover projects, then reads each project's `.memories/` directory.

---

## Architecture Decisions

This is **iteration #5** of a developer memory system. Each iteration taught something:

1. **Original Goldfish (TypeScript)** -- Good concepts, critical bugs: race conditions, date handling
2. **Tusk (Bun + SQLite)** -- Fixed bugs, added complexity, hook spam disaster
3. **.NET rewrite** -- Over-engineered, never finished
4. **Goldfish 4.0 (Bun + Markdown)** -- Radical simplicity, centralized `~/.goldfish/` storage, proved the markdown-only approach

Key decisions for v5.0.0:

| Decision | Rationale |
|----------|-----------|
| Markdown storage, no database | Human-readable, git-friendly, transparent |
| Project-local `.memories/` | Git-committable, travels with the codebase |
| Individual checkpoint files | No merge conflicts, no corruption from concurrent writes |
| Atomic file operations | Write-to-temp then rename prevents corruption on crash |
| UTC timestamps everywhere | No timezone bugs (learned the hard way in v1) |
| Aggressive behavioral language | Proven from Tusk: agents need forceful, directive guidance |
| 3 tools, not more | Checkpoint, recall, plan cover all use cases without bloat |
| Skills over slash commands | Plugin-native, no manual `bun setup` step |
| Evidence-based features only | Complexity is added only when real usage demands it |

---

## Plugin Structure

```
goldfish/
  .claude-plugin/
    plugin.json           # Claude Code plugin manifest (auto-discovery)
  .mcp.json              # MCP server configuration (for standalone/dev use)
  hooks/
    hooks.json            # Hook definitions (PreCompact, SessionStart, ExitPlanMode)
  skills/
    checkpoint/SKILL.md   # /checkpoint skill
    recall/SKILL.md       # /recall skill
    standup/SKILL.md      # /standup skill
    plan/SKILL.md         # /plan skill
    plan-status/SKILL.md  # /plan-status skill
  src/
    server.ts             # MCP server entry point
    tools.ts              # Tool definitions (checkpoint, recall, plan)
    instructions.ts       # Server behavioral instructions
    types.ts              # TypeScript interfaces
    checkpoints.ts        # Checkpoint storage and retrieval
    plans.ts              # Plan management
    recall.ts             # Search and aggregation
    registry.ts           # Cross-project registry (~/.goldfish/registry.json)
    workspace.ts          # Workspace detection and normalization
    git.ts                # Git context capture
    lock.ts               # File locking for concurrent writes
    summary.ts            # Auto-summary generation
    emoji.ts              # Emoji utilities
    handlers/             # Tool handler implementations
  tests/                  # Test files (265 tests)
```

---

## Development

**This is a TDD project. Tests are written before implementation. No exceptions.**

```bash
# Run all tests (265 tests)
bun test

# Watch mode (recommended during development)
bun test --watch

# Run a specific test file
bun test tests/checkpoints.test.ts

# Run with coverage
bun test --coverage

# Type check
bun run typecheck
```

### Stats

- **265 tests**, all passing
- **~2,070 lines** of production code
- **3 dependencies:** `@modelcontextprotocol/sdk`, `fuse.js`, `yaml`

### TDD Workflow

1. Write test first (watch it fail)
2. Implement minimum code to pass
3. Refactor if needed (keep tests green)
4. Commit test + implementation together

See `CONTRIBUTING.md` for detailed development patterns.

---

## Performance

| Operation | Target | Actual |
|-----------|--------|--------|
| Checkpoint save | < 50ms | ~10ms |
| Recall (7 days, single project) | < 100ms | ~30ms |
| Recall (7 days, all projects) | < 500ms | ~150ms |
| Fuzzy search (100 checkpoints) | < 50ms | ~15ms |

Benchmarked on Apple Silicon (M-series).

---

## Troubleshooting

### Plugin not loading

1. Verify the plugin is installed: `claude plugin list`
2. Check that `.mcp.json` exists in the goldfish root directory
3. Ensure Bun is installed and available in your PATH
4. Restart Claude Code (plugins load at startup)

### Checkpoints not saving

1. Check that `.memories/` is writable in your project directory
2. Run `bun run src/server.ts` directly to see error output
3. Each checkpoint is ~1KB -- disk space is rarely an issue

### Recall returns nothing

1. Checkpoints are per-project: each project has its own `.memories/` directory
2. Default recall returns last 5 checkpoints regardless of age -- try `recall({ days: 7 })` for date-windowed history
3. Verify checkpoints exist: `ls .memories/` in your project root

### Cross-project recall is empty

1. The registry at `~/.goldfish/registry.json` must have entries
2. Projects are auto-registered on first checkpoint save
3. Check that listed projects still have `.memories/` directories

### Hooks not firing

1. Hooks require Claude Code plugin support -- ensure your Claude Code version supports hooks
2. Check `hooks/hooks.json` for syntax errors
3. The `SessionStart` hook only fires once per session

---

## Documentation

| File | Audience | Content |
|------|----------|---------|
| `README.md` | Users | This file -- overview, installation, usage |
| `CLAUDE.md` | AI agents (developing Goldfish) | TDD rules, architecture, coding patterns |
| `CONTRIBUTING.md` | Contributors | Detailed development guide |
| `docs/IMPLEMENTATION.md` | Contributors | Technical specification |

---

## License

MIT

---

Fifth time's the charm.
