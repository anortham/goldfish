# Goldfish Revival TODO

## Context

Goldfish is being revived as the **work management / memory layer**, separated from Julie which will focus purely on code intelligence. This decision was made after evaluating the overlap between Julie's memory tools, Claude Code's native plan mode, and superpowers planning skills.

### The Split
- **Julie** (6 tools): `fast_search`, `get_symbols`, `deep_dive`, `fast_refs`, `rename_symbol`, `manage_workspace` — pure code intelligence, project-scoped
- **Goldfish** (revived): `checkpoint`, `recall`, `plan`, `store`, standup — work management, user-scoped, cross-project

### Why Goldfish Over Julie for Memories
- Julie's memory tools were shoehorned in when semantic embedding infrastructure existed — that's been removed
- Memory/planning is CRUD on markdown files, not code intelligence
- Julie is project-scoped; work management needs to be user-scoped and cross-project
- Goldfish v4 already exists with 252 passing tests and learned lessons from 3 prior iterations
- Superpowers planning skills handle the planning workflow; Goldfish handles persistence

## Phase 1: Does It Still Run?

- [ ] Verify Bun is installed and working on Windows
- [ ] `bun install` — check dependencies resolve
- [ ] `bun test` — see if 252 tests still pass
- [ ] Start MCP server manually, verify it responds to tool calls
- [ ] Check MCP protocol compatibility with current Claude Code

## Phase 2: Adopt Julie's Checkpoint Format

Julie converged on YAML frontmatter + markdown body for memories. It's cleaner than Goldfish's current daily-aggregate markdown with HTML comment metadata. Standardize on Julie's format.

### Julie's format (adopt this):
```markdown
---
git:
  branch: main
  commit: 0998059
  dirty: true
  files_changed:
  - src/auth/jwt.ts
id: checkpoint_69892c9f_32f40c
tags:
- bug-fix
- auth
timestamp: 1770597535
type: checkpoint
---

## Fixed JWT validation bug

- **Root cause**: Expiry check was inverted
- **Fix**: Flipped comparison operator
- **Tests**: Added 3 edge-case tests
```

### Changes needed:
- [ ] Replace daily aggregate markdown files with one-file-per-checkpoint
- [ ] Use YAML frontmatter instead of HTML comments for metadata
- [ ] File naming: `{YYYY-MM-DD}/{HHMMSS}_{suffix}.md` (Julie's convention)
- [ ] Decide on timestamp format: Julie uses Unix seconds, Goldfish uses ISO 8601 — pick one
- [ ] Update checkpoint parser to read/write new format
- [ ] Update recall to search individual files instead of parsing daily aggregates
- [ ] Keep plan format as-is (already YAML frontmatter + markdown)

## Phase 3: Migration Support

- [ ] Write importer that reads Julie `.memories/*.md` files (frontmatter format)
- [ ] Handle timestamp conversion if formats differ
- [ ] Copy into Goldfish's `~/.goldfish/{workspace}/` structure
- [ ] Test with existing Julie memories from `c:\source\julie\.memories\`

## Phase 4: Standup

The standup was a Julie skill — it needs to become a Goldfish capability (tool or built into recall).

- [ ] Port standup logic: recall global memories, synthesize narrative
- [ ] Cross-project aggregation (scan all `~/.goldfish/*/` directories)
- [ ] Time range support: default yesterday, `3d`, `7d`, specific dates
- [ ] Output as natural narrative, not raw memory dumps

## Phase 5: Plan Tool Decisions

Superpowers has planning skills (brainstorming, writing-plans, executing-plans). Goldfish also has a plan tool. Evaluate overlap:

- [ ] Test superpowers planning skills to understand what they persist and where
- [ ] Decide if Goldfish plan tool is redundant or complementary
- [ ] If keeping: plan tool provides cross-session persistence that superpowers doesn't
- [ ] If removing: ensure forward-looking context can live in checkpoints

## Phase 6: Claude Code Integration

- [ ] Add to Claude Code MCP config (`~/.claude/settings.json` or project-level)
- [ ] Write JULIE_AGENT_INSTRUCTIONS.md equivalent for Goldfish (behavioral adoption)
- [ ] Add PreCompact hook for checkpoint reminders
- [ ] Test alongside Julie — both MCP servers running simultaneously
- [ ] Verify no tool name conflicts between Julie and Goldfish

## Reference: Three Goldfish Versions

| | v1 (TS archive) | v2 (.NET) | v4 (Bun) — THIS ONE |
|---|---|---|---|
| **Location** | `c:\source\coa-goldfish-mcp\archive` | `c:\source\coa-goldfish-mcp` | `c:\source\goldfish` |
| **Stack** | TypeScript/Node | C#/.NET 9, EF Core | TypeScript/Bun |
| **Storage** | JSON files | SQLite (full ORM) | Markdown + JSONL + SQLite-vec |
| **Tools** | ~5 | 7 (enterprise) | 4 (radical simplicity) |
| **Tests** | Few | 87% pass | 252 passing |
| **Lesson** | Good concepts, bugs | Over-engineered | Keep it simple |

## Notes

- Julie's memory tools are being removed in parallel (separate workstream in `c:\source\julie`)
- Existing Julie `.memories/` directories will remain as historical archives
- The `.memories/plans/*.json` files in Julie are old JSON format (pre-frontmatter migration) — low value, all archived
- Goldfish's `store` tool (project-level, git-committable JSONL) is a unique capability worth keeping
