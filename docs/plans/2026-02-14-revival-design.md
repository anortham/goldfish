# Goldfish Revival Design

**Date:** 2026-02-14
**Status:** Approved

## Context

Goldfish is being revived as the work management / memory layer, separated from Julie (which focuses purely on code intelligence as of v3.0.0). This design captures decisions made during brainstorming and defines the implementation approach.

## Architecture: Dumb Storage + Smart Skills

```
+--------------------------------------------------+
|  Claude Code Plugin: goldfish                     |
|                                                   |
|  +------------------+  +----------------------+  |
|  |  MCP Server       |  |  Skills + Hooks      |  |
|  |  (dumb storage)   |  |  (smart behavior)    |  |
|  |                   |  |                      |  |
|  |  - checkpoint     |  |  - goldfish:recall   |  |
|  |  - recall         |  |  - goldfish:checkpoint|  |
|  |  - plan           |  |  - goldfish:standup  |  |
|  |                   |  |  - goldfish:plan-status|  |
|  |  3 tools, ~800 LOC|  |                      |  |
|  +------------------+  |  Hooks:              |  |
|                         |  - PreCompact        |  |
|                         |  - SessionStart      |  |
|                         |  - PostToolUse       |  |
|                         |    (ExitPlanMode)    |  |
|                         +----------------------+  |
+--------------------------------------------------+
```

## Key Decisions

1. **Strip embeddings** — remove all vector search infra, keep fuse.js, leave extension point for future
2. **Adopt Julie's checkpoint format** — YAML frontmatter + markdown, one-file-per-checkpoint
3. **Project-level storage + registry** — memories in `{project}/.memories/`, `~/.goldfish/registry.json` tracks projects for cross-project ops
4. **Keep plan tool** — forward-looking context ("what's next") complements backward-looking checkpoints ("what happened")
5. **Strip distillation** — replace with a skill that instructs the agent how to distill
6. **Standup as a skill** — not a tool; calls recall cross-project, agent synthesizes narrative
7. **Plugin format** — `.claude-plugin/`, `.mcp.json`, `skills/`, `hooks/` for one-command install
8. **Standardize on skills** — no commands, skills only (agent-invocable)

## Storage Format

```
{project}/.memories/
  2026-02-14/
    093042_a1b2.md          # Individual checkpoint (YAML frontmatter)
    143015_f4e1.md
  plans/
    auth-system.md          # Plan (YAML frontmatter + markdown)
  .active-plan              # Current plan ID

~/.goldfish/
  registry.json             # List of registered project paths
```

**Checkpoint format:**
```markdown
---
id: checkpoint_a1b2c3d4
timestamp: 2026-02-14T09:30:42.123Z
tags:
  - bug-fix
  - auth
git:
  branch: feature/jwt-fix
  commit: a1b2c3d
  files:
    - src/auth/jwt.ts
---

## Fixed JWT validation bug

- **Root cause**: Expiry check was inverted
- **Fix**: Flipped comparison operator
- **Tests**: Added 3 edge-case tests
```

## Dependencies (After Cleanup)

- `@modelcontextprotocol/sdk` ^1.26.0
- `fuse.js` ^7.0.0
- `yaml` ^2.8.2

## Hooks

| Hook Event | Matcher | Action |
|---|---|---|
| PreCompact | — | Prompt: checkpoint before compaction |
| SessionStart | — | Prompt: recall recent context |
| PostToolUse | ExitPlanMode | Prompt: save plan to Goldfish |

## Implementation Phases

Each phase is documented in its own file:

1. [Phase 1: Strip & Stabilize](./2026-02-14-revival-phase1.md)
2. [Phase 2: New Checkpoint Format](./2026-02-14-revival-phase2.md)
3. [Phase 3: Registry](./2026-02-14-revival-phase3.md)
4. [Phase 4: Plugin Structure](./2026-02-14-revival-phase4.md)
5. [Phase 5: Update Docs & Clean Up](./2026-02-14-revival-phase5.md)

Each phase ends with all tests green and a commit.
