# Goldfish v5.7.0 - Implementation Specification

## Design Philosophy

**Radical Simplicity**: Everything is markdown. No database. Let the agent's intelligence handle complexity, we just provide transparent storage and retrieval.

**Test-Driven Development**: Write tests first. Every feature starts with a failing test.

**Lessons Learned**: This is iteration #5. We're taking the best from each previous attempt:
- Original Goldfish: Workspace normalization, fuse.js search, transparency
- Tusk: Directive behavioral language (recalibrated for quality over frequency)
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
~/.goldfish/cache/semantic/    # Derived semantic manifest + JSONL records
~/.goldfish/models/transformers/ # Local embedding model cache
```

### Core Principles
1. **One file per checkpoint** (YAML frontmatter + markdown body)
2. **One file per plan** (already YAML frontmatter)
3. **Project-local storage** (git-committable)
4. **Cross-project via registry** (~/.goldfish/registry.json)
5. **Atomic writes** (write-then-rename with locking)
6. **Derived semantic cache stays rebuildable** (JSON/JSONL outside `.memories/`)

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
| `src/digests.ts` | Compact retrieval digests for lexical search and compact result presentation |
| `src/semantic-cache.ts` | Derived semantic manifest/records storage under `~/.goldfish/cache/semantic/` |
| `src/semantic.ts` | Hybrid ranking and bounded semantic maintenance helpers |
| `src/transformers-embedder.ts` | Lazy local embedding runtime backed by `@huggingface/transformers` |
| `src/registry.ts` | `~/.goldfish/registry.json` management, auto-registration, stale filtering |
| `src/git.ts` | Git context capture (branch, commit, files) |
| `src/lock.ts` | File locking for concurrent writes |
| `src/summary.ts` | Auto-summary generation for long descriptions |
| `src/emoji.ts` | Fish emoji helper |
| `src/server.ts` | MCP server setup |
| `src/handlers/` | Tool handlers (checkpoint, recall, plan) |
| `src/tools.ts` | Tool definitions |
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
│   ├── plan/SKILL.md
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

Tool descriptions are **directive about quality, restrained about frequency**.

This is a deliberate recalibration. The original aggressive language (from Tusk patterns) solved under-checkpointing but caused severe over-checkpointing in practice: 100+ checkpoints/day, rapid-fire duplicates, bloated files.

### Checkpoint Tool
- Describes when to checkpoint (milestones, decisions, discoveries) and when NOT to (every small step, routine test runs, rapid-fire)
- Strong on description quality: structured markdown, WHAT/WHY/HOW/IMPACT
- No guilt-tripping or "MANDATORY" language about frequency

### Recall Tool

**Dual-mode recall (v5.0.6+):**
- **Last-N mode** (default): When no date parameters are provided, returns the last `limit` checkpoints (default: 5) regardless of age. No date window.
- **Date-window mode**: When `days`, `since`, `from`, or `to` is provided, filters checkpoints to that date range.

**Phase 1 hybrid recall flow:**
1. Load markdown checkpoints from `.memories/` and build compact retrieval digests.
2. Run Fuse lexical search over those digests so default search stays fast and token-efficient.
3. If the semantic runtime is already warm, load ready embeddings from the derived cache and blend lexical, semantic, metadata, and recency signals into a hybrid ranking.
4. Present compact search descriptions by default; `full: true` returns the original markdown body and metadata.
5. After search, do bounded semantic maintenance only while time budget remains: at most 3 records and ~150ms per recall pass.

**Bounded maintenance details:**
- Pending semantic work is queued on checkpoint save.
- Search-triggered maintenance is best-effort only; recall still succeeds if embedding work fails.
- Model-version invalidation marks derived records stale without touching checkpoint markdown.
- Semantic cache and model downloads live under `~/.goldfish/`, outside `.memories/`, and can be rebuilt from source markdown.

Recall runs **automatically at session start** via the SessionStart hook. Users can also invoke `/recall` manually for targeted queries (search, cross-project, time ranges).

### Plan Tool
- Keeps strong directive language — plan persistence genuinely represents hours of strategic work
- Still instructs: save immediately after ExitPlanMode, never ask permission, always activate

---

## Anti-Patterns to Avoid

Based on lessons from previous iterations:

- **Don't mix local dates with UTC ISO strings** (caused timeline bug in original)
- **Don't use direct file writes** (use atomic write-then-rename pattern)
- **Don't scan directories repeatedly** (cache workspace list, invalidate on write)
- **Don't add database** (we're going simpler this time)
- **Don't try to be smart about deduplication** (let Claude handle that)
- **Don't add redundant scoring fields without evidence** (confidence is already part of the checkpoint schema; avoid piling on more metadata)

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

### Complete - v5.7.0

**ALL MODULES IMPLEMENTED AND TESTED**

1. **Workspace utilities** - Detection, normalization, `.memories/` directory management
2. **Git context** - Branch, commit, files capture
3. **Checkpoint storage** - YAML frontmatter individual files, atomic writes, concurrent safety
4. **Plan storage** - YAML frontmatter, CRUD, active plan tracking, lifecycle management
5. **Recall with fuse.js** - Fuzzy search, cross-workspace aggregation, date range filtering
6. **Cross-project registry** - `~/.goldfish/registry.json`, auto-registration, stale filtering
7. **MCP server** - Tools (checkpoint, recall, plan), behavioral guidance
8. **Claude Code plugin** - Skills, hooks, `.mcp.json`
9. **Auto-summary** - Summary generation for long descriptions
10. **File locking** - Concurrent write safety

**Current architecture:** markdown source data in-project, derived semantic cache in `~/.goldfish/cache/semantic/`, and 4 runtime dependencies (`@huggingface/transformers`, `@modelcontextprotocol/sdk`, `fuse.js`, `yaml`).

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
