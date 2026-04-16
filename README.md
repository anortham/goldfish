# Goldfish 🐠

Persistent developer memory for MCP-compatible coding clients. Checkpoints, recall, briefs, standup reports, and built-in semantic recall, stored as human-readable markdown right in your project.

Goldfish is a cross-client MCP memory system. Claude Code gets the fullest adapter today, with plugin installation, slash-command skills, and lifecycle hooks. Codex Desktop and OpenCode can discover repo-local Goldfish skills from `.agents/skills`, and VS Code with GitHub Copilot can use the MCP server plus repo instructions.

Goldfish gives AI coding sessions memory that survives context compaction, crashes, and session restarts. Markdown in `.memories/` stays the source of truth, while Goldfish keeps a lightweight cross-project registry at `~/.goldfish/registry.json` plus derived semantic cache data under `~/.goldfish/cache/semantic/` and model files under `~/.goldfish/models/transformers/`.

**Version 6.7.0** -- Fifth iteration, built on hard lessons from four previous attempts.

---

## Why Goldfish?

AI coding sessions have a memory problem:

- Context windows get compacted, losing work history
- Sessions crash, losing planning and decisions
- Switching projects loses context
- No way to answer "what was I working on yesterday?"

Goldfish solves this with four MCP tools (checkpoint, recall, brief, consolidate), 8 skills including compatibility aliases, repo-local skill discovery for compatible clients, and client hooks where the harness supports them.

---

## Client Setup

**Prerequisites:** [Bun](https://bun.sh) runtime (v1.0+)

Start by cloning the repository and installing dependencies:

```bash
git clone https://github.com/anortham/goldfish.git
cd goldfish
bun install
```

### Claude Code

Claude Code is the fullest adapter today. You get MCP tools, slash-command skills (`/checkpoint`, `/recall`, `/consolidate`, `/brief`, `/brief-status`, `/standup`, plus compatibility aliases `/plan` and `/plan-status`), and the SessionStart/PreCompact hooks.

Install from the marketplace:

```bash
# Add the Goldfish repository as a plugin marketplace
/plugin marketplace add anortham/goldfish

# Install the plugin for your user
/plugin install goldfish@goldfish

# Or scope it to the current project
/plugin install goldfish@goldfish --scope project
```

Install from a local clone:

```bash
claude plugin install /path/to/goldfish
```

For development, load the plugin from the local directory each time:

```bash
claude --plugin-dir /path/to/goldfish
```

Once the plugin is loaded, Goldfish works automatically:

1. **Session starts** -- the `SessionStart` hook fires and calls `recall()`
2. **You work** -- checkpoint manually with `/checkpoint`, or let the `PreCompact` hook auto-checkpoint before compaction
3. **Direction persists** -- save a brief with `/brief` when goals, constraints, or success criteria should survive the session
4. **Next session** -- recall restores recent checkpoints and the active brief automatically

### Codex Desktop

Codex shares MCP configuration between the CLI and the IDE extension through `~/.codex/config.toml`, and it also discovers repo-local skills from `.agents/skills`.

Add Goldfish to `~/.codex/config.toml` or a trusted project-scoped `.codex/config.toml`:

```toml
[mcp_servers.goldfish]
command = "bun"
args = ["run", "/absolute/path/to/goldfish/src/server.ts"]
cwd = "/absolute/path/to/your/project"
```

Goldfish skills in `.agents/skills` are discovered automatically when you launch Codex inside the repository.

### OpenCode

OpenCode loads local MCP servers from `opencode.json` and can also discover repo-local skills from `.agents/skills`.

Add Goldfish to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "goldfish": {
      "type": "local",
      "command": ["bun", "run", "/absolute/path/to/goldfish/src/server.ts"],
      "enabled": true
    }
  }
}
```

OpenCode walks up the repository and loads matching `.agents/skills/*/SKILL.md`, so the checked-in Goldfish skills are available without extra copying.

### VS Code with GitHub Copilot

VS Code supports project-level MCP config in `.vscode/mcp.json`, supports the full MCP feature set, and can pair Goldfish with repo instructions for better memory habits.

```bash
mkdir -p .vscode
```

Create `.vscode/mcp.json`:

```json
{
  "servers": {
    "Goldfish": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/goldfish/src/server.ts"]
    }
  }
}
```

`GOLDFISH_WORKSPACE` is optional in VS Code now that Goldfish can resolve the active workspace from MCP roots. Keep it as an override if you want to pin Goldfish to a different root or you run in a client that does not provide roots:

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

If you want Copilot to consistently checkpoint and recall with Goldfish, copy `docs/goldfish-checkpoint.instructions-vs-code.md` into your repo's `.github/instructions/` folder (or adapt it to your preferred instructions layout). That file gives VS Code users a ready-made Goldfish + Julie instruction set instead of starting from a blank page.

If you want the closer Claude-style experience, VS Code's agent plugins preview can also load Claude-format plugins. Goldfish already ships `.claude-plugin/plugin.json` and `hooks/hooks.json`, which VS Code can detect for plugin skills and hooks.

Two ways to wire that up:

- Register a local Goldfish clone with the `chat.pluginLocations` setting in `settings.json`
- Add a marketplace with `chat.plugins.marketplaces` if you want shared discovery instead of a direct local path

Use `.vscode/mcp.json` when you only want the MCP tools. Use the plugin path when you want skills and hook automation in VS Code as well.

### Any MCP Client

Goldfish is a standard [MCP](https://modelcontextprotocol.io/) server, so any client that can launch a local stdio server can use the four core tools (`checkpoint`, `recall`, `brief`, `consolidate`) and the server instructions.

What varies by client:

- **Skills** depend on whether the harness reads repo-local skill files such as `.agents/skills`
- **Hooks** depend on whether the harness exposes lifecycle automation
- **Workspace binding** depends on roots support, explicit cwd, or `GOLDFISH_WORKSPACE`

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

Every session starts with recall (automatic via `SessionStart` hook). Returns recent checkpoints, the active brief, and optional cross-project summaries.

```
recall()                                    # Last 5 checkpoints, no date window
recall({ since: "2h" })                     # Last 2 hours
recall({ search: "auth bug" })              # Fuzzy search
recall({ days: 7, limit: 20, full: true })  # Extended history with metadata
recall({ workspace: "all", days: 1 })       # Cross-project (for standups)
recall({ limit: 0 })                        # Active brief only
```

When you search with `recall({ search: "..." })`, results are compact by default so agents get dense, low-token snippets. Pass `full: true` to return full descriptions and metadata instead.

### Brief -- Track Durable Direction

Briefs are compact strategic markdown documents that survive across sessions. They appear at the top of every `recall()` response.

```markdown
---
id: auth-system-redesign
title: Auth System Redesign
status: active
created: 2026-02-10T10:00:00.000Z
updated: 2026-02-14T14:30:00.000Z
tags: [auth, architecture, security]
---

## Goal

Redesign auth around durable refresh-token sessions.

## Why Now

Timeout bugs and session drift keep burning time across sessions.

## Constraints

- Keep one-release compatibility for existing auth clients
- Do not break admin SSO

## Success Criteria

- Recall and checkpoint evidence line up with the new auth direction
- Standup reports stay consistent with the brief and recent checkpoints

## References

- docs/plans/2026-02-14-auth-system-redesign.md
```

**Saved to:** `{project}/.memories/briefs/auth-system-redesign.md`

---

## Skills

Goldfish ships 7 skills. Claude Code exposes them as slash commands, and Codex Desktop plus OpenCode can discover the same skill content from `.agents/skills/`.

| Skill | What It Does |
|-------|-------------|
| `/brief` | Create and manage durable strategic briefs |
| `/brief-status` | Assess progress against the active brief |
| `/checkpoint` | Save a checkpoint with rich description and tags |
| `/plan` | Compatibility alias for `/brief` |
| `/plan-status` | Compatibility alias for `/brief-status` |
| `/recall` | Restore context from recent checkpoints and the active brief |
| `/standup` | Generate a cross-project standup report |

`skills/` is the canonical source. `.agents/skills/` is a checked-in mirror for clients that scan repo-local skills.

---

## Hooks

Claude Code currently gets the Goldfish hook adapter. Other clients still get the same MCP tools and memory model, but hook automation depends on what the harness exposes.

| Hook | Trigger | Action |
|------|---------|--------|
| `PreCompact` | Context window compaction | Auto-checkpoint current progress before memory is lost |
| `SessionStart` | New session begins | Auto-recall recent work to restore context |

Hook definitions live in `hooks/hooks.json`.

---

## Storage Format

Markdown in `.memories/` is still the source of truth. Goldfish also keeps derived JSON/JSONL semantic search artifacts outside `.memories/` so search stays fast without turning your project memory into an opaque database.

### Project-Level Storage

```
your-project/
  .memories/
    2026-02-13/
      091500_a1b2.md          # Individual checkpoint (YAML frontmatter + markdown)
      143022_c3d4.md
    2026-02-14/
      101530_e5f6.md
    briefs/
      auth-system-redesign.md  # Brief (YAML frontmatter + markdown body)
      api-v2-migration.md
    .active-brief              # Contains the active brief ID
    memory.yaml                # Consolidated memory (YAML, merge-friendly)
```

Legacy `.memories/plans/` and `.active-plan` paths are still read during the compatibility window, but new writes land in the brief paths above.

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
  registry.json              # Auto-populated list of projects using Goldfish
  consolidation-state/       # Per-workspace consolidation cursors
    {workspace}_{hash}.json
```

The registry tracks which projects have `.memories/` directories. It is populated automatically on checkpoint save and used by cross-project recall for standup reports.

### Derived Semantic Cache

```
~/.goldfish/
  cache/
    semantic/
      <workspace-hash>/
        manifest.json   # Checkpoint digest/version metadata
        records.jsonl   # Pending/ready embedding records
  models/
    transformers/       # Downloaded model artifacts
```

These files are derived from checkpoint markdown and can be rebuilt. They live outside `.memories/` on purpose: project history stays human-readable and git-friendly, while embeddings and model downloads stay local machine cache.

---

## Cross-Project Features

### Standup Reports

Standup reports are built from briefs and checkpoints, not `docs/plans/`.

The `/standup` skill aggregates work across all registered projects:

```
## Standup -- February 14, 2026

### goldfish
- Brief says the current push is cross-client portability for Goldfish
- Checkpoints show roots support landed and repo-local skill mirroring landed

> **Next:** Finish client docs and keep standup scoped to memory evidence

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
| Quality-focused behavioral language | Directive about checkpoint quality, restrained about frequency |
| 4 tools, not more | Checkpoint, recall, brief, consolidate cover all use cases without bloat |
| Skills over slash commands | Plugin-native, no manual `bun setup` step |
| Evidence-based features only | Complexity is added only when real usage demands it |

---

## Repository Structure

```
goldfish/
  .agents/
    skills/               # Repo-local skill mirror for Codex/OpenCode
  .claude-plugin/
    plugin.json           # Claude Code plugin manifest
  hooks/
    hooks.json            # Claude Code hook definitions
  skills/
    brief/SKILL.md        # Canonical brief skill
    brief-status/SKILL.md # Canonical brief-status skill
    checkpoint/SKILL.md   # Canonical checkpoint skill
    consolidate/SKILL.md  # Canonical consolidate skill
    recall/SKILL.md       # Canonical recall skill
    standup/SKILL.md      # Canonical standup skill
    plan/SKILL.md         # Canonical plan compatibility alias
    plan-status/SKILL.md  # Canonical plan-status alias
  src/
    server.ts             # MCP server entry point
    tools.ts              # Tool definitions (checkpoint, recall, brief, consolidate)
    instructions.ts       # Server behavioral instructions
    types.ts              # TypeScript interfaces
    checkpoints.ts        # Checkpoint storage and retrieval
    plans.ts              # Brief management with legacy plan compatibility
    recall.ts             # Fuzzy + semantic hybrid recall
    digests.ts            # Compact retrieval/search digests
    semantic-cache.ts     # Derived semantic manifest + JSONL records
    semantic.ts           # Embedding runtime and pending semantic work processing
    ranking.ts            # Hybrid ranking and scoring helpers
    transformers-embedder.ts # Local embedding runtime
    memory.ts             # Memory file I/O (memory.yaml)
    consolidation-prompt.ts # Consolidation subagent prompt builder
    logger.ts             # File-based logging
    registry.ts           # Cross-project registry (~/.goldfish/registry.json)
    workspace.ts          # Workspace detection and normalization
    git.ts                # Git context capture
    lock.ts               # File locking for concurrent writes
    summary.ts            # Auto-summary generation
    emoji.ts              # Emoji utilities
    handlers/             # Tool handler implementations (checkpoint, recall, brief, consolidate)
  tests/                  # Test files
```

---

## Development

**This is a TDD project. Tests are written before implementation. No exceptions.**

```bash
# Run all tests
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

- **Storage:** markdown source of truth in `.memories/`, derived semantic cache in `~/.goldfish/cache/semantic/`
- **Model runtime:** `@huggingface/transformers` cache in `~/.goldfish/models/transformers/`
- **Runtime dependencies:** `@huggingface/transformers`, `@modelcontextprotocol/sdk`, `fuse.js`, `yaml`

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
2. Ensure Bun is installed and available in your PATH
3. Restart Claude Code (plugins load at startup)

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
