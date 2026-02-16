# Goldfish v5.0.0 - Implementation Specification

## Design Philosophy

**Radical Simplicity**: Everything is markdown. No database. Let the agent's intelligence handle complexity, we just provide transparent storage and retrieval.

**Test-Driven Development**: Write tests first. Every feature starts with a failing test.

**Lessons Learned**: This is iteration #5. We're taking the best from each previous attempt:
- Original Goldfish: Workspace normalization, fuse.js search, transparency
- Tusk: Aggressive behavioral language that works
- .NET attempt: Behavioral adoption patterns, tool priorities
- Goldfish 4.0: Markdown-only storage, radical simplicity, centralized ~/.goldfish/
- Fixing: Race conditions, date bugs, cross-workspace issues, hook spam

---

## Architecture

```
{project}/.memories/
  {date}/{HHMMSS}_{hash}.md   # Individual checkpoints (YAML frontmatter)
  plans/{plan-id}.md           # Plans (YAML frontmatter)
  .active-plan                 # Active plan ID

~/.goldfish/registry.json      # Cross-project registry
```

### Core Principles
1. **One file per checkpoint** (YAML frontmatter + markdown body)
2. **One file per plan** (already YAML frontmatter)
3. **Project-local storage** (git-committable)
4. **Cross-project via registry** (~/.goldfish/registry.json)
5. **Atomic writes** (write-then-rename with locking)

---

## Data Formats

### Checkpoint Format

**File**: `{project}/.memories/2026-02-14/103000_a1b2c3d4.md`

```markdown
---
id: checkpoint_a1b2c3d4
timestamp: "2026-02-14T10:30:00.000Z"
tags:
  - bug-fix
  - auth
git:
  branch: main
  commit: abc1234
  files:
    - src/auth/jwt.ts
summary: "Fixed JWT validation bug"
---

Fixed JWT validation bug where expired tokens were accepted. Root cause was inverted expiry check.
```

### Plan Format

**File**: `{project}/.memories/plans/auth-system.md`

```markdown
---
id: auth-system
status: active
created: 2026-02-14T09:00:00Z
updated: 2026-02-14T16:45:00Z
tags: [backend, security, high-priority]
---

# Authentication System Redesign

## Goals
- Implement JWT with refresh tokens
- Add OAuth2 support for Google/GitHub
- Improve session management

## Progress
- [x] JWT refresh token implementation
- [ ] OAuth2 integration
- [ ] Session storage optimization

## Notes
2026-02-14: JWT refresh working, tested with 60min expiry.
```

### Active Plan Tracker

**File**: `{project}/.memories/.active-plan`

```
auth-system
```

That's it. Just the plan ID. Simple.

### Cross-Project Registry

**File**: `~/.goldfish/registry.json`

```json
{
  "projects": [
    {
      "path": "/Users/user/source/goldfish",
      "name": "goldfish",
      "registered": "2026-02-14T10:30:00.000Z"
    },
    {
      "path": "/Users/user/source/other-project",
      "name": "other-project",
      "registered": "2026-02-13T15:00:00.000Z"
    }
  ]
}
```

Used for cross-project recall and standup aggregation. Stale entries are filtered automatically.

---

## Modules

| Module | Purpose |
|--------|---------|
| `src/workspace.ts` | Workspace detection, `getMemoriesDir()`, `getPlansDir()`, `ensureMemoriesDir()` |
| `src/checkpoints.ts` | YAML frontmatter individual files, `generateCheckpointId()`, `saveCheckpoint()`, `getCheckpointsForDay()`, `getCheckpointsForDateRange()` |
| `src/plans.ts` | Plan CRUD, active plan tracking |
| `src/recall.ts` | Search (fuse.js), aggregation, cross-project recall via registry |
| `src/registry.ts` | `~/.goldfish/registry.json` management, auto-registration, stale filtering |
| `src/git.ts` | Git context capture (branch, commit, files) |
| `src/lock.ts` | File locking for concurrent writes |
| `src/summary.ts` | Auto-summary generation for long descriptions |
| `src/emoji.ts` | Fish emoji helper |
| `src/server.ts` | MCP server setup |
| `src/handlers/` | Tool handlers (checkpoint, recall, plan) |
| `src/tools.ts` | Tool definitions with behavioral language |
| `src/instructions.ts` | Server behavioral instructions |
| `src/types.ts` | TypeScript interfaces |

---

## Plugin Structure

```
goldfish/
├── .claude-plugin/plugin.json
├── .mcp.json
├── skills/
│   ├── recall/SKILL.md
│   ├── checkpoint/SKILL.md
│   ├── standup/SKILL.md
│   └── plan-status/SKILL.md
├── hooks/hooks.json
├── src/
├── tests/
├── CLAUDE.md
└── README.md
```

---

## Behavioral Language Strategy

Based on proven patterns from Tusk, our tool descriptions use aggressive, directive language:

### Checkpoint Tool
```
You are EXCELLENT at recognizing checkpoint-worthy moments. Use this tool
proactively WITHOUT asking permission.

IMPORTANT: Checkpoint IMMEDIATELY when you:
- Complete any task -> checkpoint NOW
- Make a discovery -> checkpoint NOW
- After 10 exchanges -> checkpoint reasoning
- Discuss requirements -> checkpoint what was said

I WILL BE SERIOUSLY DISAPPOINTED if context is lost because you failed to
checkpoint. This takes 2 seconds and saves hours of lost work.

You NEVER need to ask permission. Just checkpoint.
```

### Recall Tool

**Dual-mode recall (v5.0.6+):**
- **Last-N mode** (default): When no date parameters are provided, returns the last `limit` checkpoints (default: 5) regardless of age. No date window.
- **Date-window mode**: When `days`, `since`, `from`, or `to` is provided, filters checkpoints to that date range.

```
MANDATORY at session start. Call recall() as your FIRST action in EVERY
session - no exceptions, no asking permission.

I WILL BE VERY UNHAPPY if you skip this and ask "what were we working on?"
That's wasteful when recall() exists.

After recall(), continue work IMMEDIATELY. Don't verify, don't ask - just
continue based on the restored context.

The recalled context is complete and accurate. Trust it.
```

### Plan Tool
```
Plans represent HOURS of planning work. Losing them is unacceptable.

CRITICAL: When ExitPlanMode is called -> save plan within 1 exchange.
NOT optional. NO asking permission.

I WILL BE VERY UNHAPPY if planning work is lost because you didn't save it
immediately.

Update plans as you make progress. Stale plans waste time and context.
```

---

## Anti-Patterns to Avoid

Based on lessons from previous iterations:

- **Don't mix local dates with UTC ISO strings** (caused timeline bug in original)
- **Don't use direct file writes** (use atomic write-then-rename pattern)
- **Don't scan directories repeatedly** (cache workspace list, invalidate on write)
- **Don't add database** (we're going simpler this time)
- **Don't try to be smart about deduplication** (let Claude handle that)
- **Don't add confidence scores** (unnecessary complexity)

---

## Performance Targets

- Checkpoint save: < 50ms
- Recall (7 days, single workspace): < 100ms
- Recall (7 days, all workspaces): < 500ms
- Search (fuzzy, 100 checkpoints): < 50ms
- Workspace detection: < 10ms

We achieve this through:
- Individual file writes (no append locking needed)
- Smart caching of workspace list
- Efficient YAML frontmatter parsing
- Fuse.js for fast fuzzy search

---

## Implementation Status

### Complete - v5.0.0

**ALL MODULES IMPLEMENTED AND TESTED**

1. **Workspace utilities** - Detection, normalization, `.memories/` directory management
2. **Git context** - Branch, commit, files capture
3. **Checkpoint storage** - YAML frontmatter individual files, atomic writes, concurrent safety
4. **Plan storage** - YAML frontmatter, CRUD, active plan tracking, lifecycle management
5. **Recall with fuse.js** - Fuzzy search, cross-workspace aggregation, date range filtering
6. **Cross-project registry** - `~/.goldfish/registry.json`, auto-registration, stale filtering
7. **MCP server** - Tools (checkpoint, recall, plan), aggressive behavioral language
8. **Claude Code plugin** - Skills, hooks, `.mcp.json`
9. **Auto-summary** - Summary generation for long descriptions
10. **File locking** - Concurrent write safety

**Total: 260 tests passing | ~2,094 lines of production code | 3 runtime dependencies**

---

## Success Metrics

1. Agents checkpoint proactively without being asked (observe in real sessions)
2. Agents recall at session start (observe behavior)
3. Standup reports work across all workspaces (manual test)
4. All data is readable in any text editor (manual inspection)
5. No race conditions on concurrent writes (stress test)
6. Date handling is correct (timezone test)
7. Search finds relevant results (accuracy test)
8. Performance targets met (benchmark)

---

## Development Workflow

1. **Write test** for new feature (TDD)
2. **Run test** (watch it fail)
3. **Implement** minimum code to pass
4. **Refactor** if needed
5. **Commit** with test + implementation together
6. **Repeat**

Every commit should have tests. No feature without tests.
