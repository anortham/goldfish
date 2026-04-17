# Goldfish 🐠

An evidence ledger for AI coding sessions. Checkpoints capture what changed and why; briefs hold durable strategic direction; recall pulls both back when the next session needs context. Everything lives as markdown in your repo, so it travels with the code, diffs in PRs, and outlasts any single harness.

Goldfish is a cross-client MCP memory system. Claude Code gets the fullest adapter today, with plugin installation and slash-command skills. Codex Desktop and OpenCode can discover repo-local Goldfish skills from `.agents/skills`, and VS Code with GitHub Copilot can use the MCP server plus repo instructions.

**Version 7.0.1** -- Patch release: v7 wording cleanup, typecheck fixes, and Codex Desktop workspace setup guidance. See CHANGELOG.md for details.

---

## Why Goldfish?

Coding harnesses already plan, summarize, and recover from compaction. What they don't do is keep a durable record of *why* a project moved the way it did, in a place the next session (or the next harness) can read.

Goldfish is git for intent: a source-controlled, harness-agnostic ledger of decisions, milestones, and direction. Three MCP tools (`checkpoint`, `recall`, `brief`) and six skills, with markdown as the source of truth.

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

Claude Code is the fullest adapter today. You get MCP tools and slash-command skills (`/checkpoint`, `/recall`, `/brief`, `/brief-status`, `/handoff`, `/standup`).

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

Once the plugin is loaded, Goldfish works through manual invocation and agent-driven calls:

1. **Session starts** -- run `/recall` (or let the agent call `recall()`) to restore recent checkpoints and the active brief
2. **You work** -- checkpoint with `/checkpoint` at meaningful milestones
3. **Direction persists** -- save a brief with `/brief` when goals, constraints, or success criteria should survive the session
4. **Next session** -- recall replays the same context

### Codex Desktop

Codex shares MCP configuration between the CLI and the IDE extension through `~/.codex/config.toml`, and it also discovers repo-local skills from `.agents/skills`.

Codex Desktop does not send MCP roots. If you want Goldfish bound to the current repo, the reliable setup is a project-local `.codex/config.toml` in that repo so you can pass `GOLDFISH_WORKSPACE` for that project.

Add Goldfish to a trusted project-local `.codex/config.toml`:

```toml
[mcp_servers.goldfish]
command = "bun"
args = ["run", "/absolute/path/to/goldfish/src/server.ts"]
cwd = "/absolute/path/to/your/project"
env = { GOLDFISH_WORKSPACE = "/absolute/path/to/your/project" }
```

You can put Goldfish in `~/.codex/config.toml` too, but that pins `GOLDFISH_WORKSPACE` to one repo. For Codex Desktop across multiple repos, keep the server entry in each project's `.codex/config.toml`.

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

If you want Copilot to consistently checkpoint and recall with Goldfish, copy `docs/goldfish-checkpoint.instructions-vs-code.md` into your repo's `.github/instructions/` folder (or adapt it to your preferred instructions layout). That file gives VS Code users a ready-made Goldfish instruction set instead of starting from a blank page.

If you want the closer Claude-style experience, VS Code's agent plugins preview can also load Claude-format plugins. Goldfish already ships `.claude-plugin/plugin.json`, which VS Code can detect for plugin skills.

Two ways to wire that up:

- Register a local Goldfish clone with the `chat.pluginLocations` setting in `settings.json`
- Add a marketplace with `chat.plugins.marketplaces` if you want shared discovery instead of a direct local path

Use `.vscode/mcp.json` when you only want the MCP tools. Use the plugin path when you want skills as well.

### Any MCP Client

Goldfish is a standard [MCP](https://modelcontextprotocol.io/) server, so any client that can launch a local stdio server can use the three core tools (`checkpoint`, `recall`, `brief`) and the server instructions.

What varies by client:

- **Skills** depend on whether the harness reads repo-local skill files such as `.agents/skills`
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

Recall returns recent checkpoints, the active brief, and optional cross-project summaries. Agents call it at session start; users can run `/recall` for targeted queries.

```
recall()                                    # Last 5 checkpoints, no date window
recall({ since: "2h" })                     # Last 2 hours
recall({ search: "auth bug" })              # BM25 search across descriptions
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

Goldfish ships 6 skills. Claude Code exposes them as slash commands, and Codex Desktop plus OpenCode can discover the same skill content from `.agents/skills/`.

| Skill | What It Does |
|-------|-------------|
| `/brief` | Create and manage durable strategic briefs |
| `/brief-status` | Assess progress against the active brief |
| `/checkpoint` | Save a checkpoint with rich description and tags |
| `/handoff` | Produce a structured session-resumption summary for a returning or different agent |
| `/recall` | Restore context from recent checkpoints and the active brief |
| `/standup` | Generate a cross-project standup report |

`skills/` is the canonical source. `.agents/skills/` is a checked-in mirror for clients that scan repo-local skills.

---

## Storage Format

Markdown in `.memories/` is the source of truth. Goldfish does not maintain derived caches; search runs over the markdown corpus on demand.

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
```

Legacy `.memories/plans/` and `.active-plan` paths are still read so older repos keep working, but new writes land in the brief paths above.

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
```

The registry tracks which projects have `.memories/` directories. It is populated automatically on checkpoint save and used by cross-project recall for standup reports.

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
5. **Goldfish 5.x-6.x** -- Claude Code plugin, project-local `.memories/`, hybrid semantic recall, consolidation, hooks
6. **Goldfish 7.0** -- Subtract sprint: removed hooks, semantic stack, consolidation, and the plan tool; settled on Orama BM25 over markdown and brief-first storage

Foundational decisions (load-bearing since v5):

| Decision | Rationale |
|----------|-----------|
| Markdown storage, no database | Human-readable, git-friendly, transparent |
| Project-local `.memories/` | Git-committable, travels with the codebase |
| Individual checkpoint files | No merge conflicts, no corruption from concurrent writes |
| Atomic file operations | Write-to-temp then rename prevents corruption on crash |
| UTC timestamps everywhere | No timezone bugs (learned the hard way in v1) |
| Quality-focused behavioral language | Directive about checkpoint quality, restrained about frequency |
| Evidence-based features only | Complexity is added only when real usage demands it |

What v7 subtracted, and why:

| Decision | Rationale |
|----------|-----------|
| Orama BM25 over hybrid fuse + embeddings | LLM-issued queries are well-formed; relevance ranking matters more than typo tolerance, and BM25 is a fraction of the runtime weight |
| No hooks | Behavioral adoption travels with the tool description; hooks tied us to one harness and produced spam |
| No consolidation | Token math was net-negative; reading consolidated digests cost more than reading checkpoints directly |
| Briefs replace plans | Harnesses own session execution planning; Goldfish owns durable strategic context that outlasts a session |
| 3 tools, not more | Checkpoint, recall, brief cover all use cases without bloat |
| Skills over slash commands | Plugin-native, no manual `bun setup` step |

---

## Repository Structure

```
goldfish/
  .agents/
    skills/               # Repo-local skill mirror for Codex/OpenCode
  .claude-plugin/
    plugin.json           # Claude Code plugin manifest
  skills/
    brief/SKILL.md        # Canonical brief skill
    brief-status/SKILL.md # Canonical brief-status skill
    checkpoint/SKILL.md   # Canonical checkpoint skill
    handoff/SKILL.md      # Canonical handoff skill
    recall/SKILL.md       # Canonical recall skill
    standup/SKILL.md      # Canonical standup skill
  src/
    server.ts             # MCP server entry point
    tools.ts              # Tool definitions (checkpoint, recall, brief)
    instructions.ts       # Server behavioral instructions
    types.ts              # TypeScript interfaces
    checkpoints.ts        # Checkpoint storage and retrieval
    briefs.ts             # Brief storage and activation
    recall.ts             # Recall aggregation across date ranges and workspaces
    ranking.ts            # Orama BM25 search ranking
    digests.ts            # Compact retrieval/search digests
    file-io.ts            # Atomic write helpers
    logger.ts             # File-based logging
    registry.ts           # Cross-project registry (~/.goldfish/registry.json)
    workspace.ts          # Workspace detection and normalization
    git.ts                # Git context capture
    lock.ts               # File locking for concurrent writes
    summary.ts            # Auto-summary generation
    emoji.ts              # Emoji utilities
    handlers/             # Tool handler implementations (checkpoint, recall, brief)
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

- **Storage:** markdown source of truth in `.memories/`; cross-project registry at `~/.goldfish/registry.json`
- **Runtime dependencies:** `@modelcontextprotocol/sdk`, `@orama/orama`, `yaml`

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
| BM25 search (100 checkpoints) | < 50ms | ~15ms |

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
