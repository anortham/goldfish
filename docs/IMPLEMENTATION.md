# Goldfish v6.6.0 - Implementation Specification

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
  briefs/{brief-id}.md         # Briefs (YAML frontmatter)
  .active-brief                # Active brief ID
  memory.yaml                  # Consolidated memory (YAML, merge-friendly)

~/.goldfish/
  registry.json                # Cross-project registry
  consolidation-state/         # Per-workspace consolidation cursors
    {workspace}_{hash}.json
  cache/semantic/              # Derived semantic manifest + JSONL records
  models/transformers/         # Local embedding model cache
```

Legacy `.memories/plans/` and `.active-plan` paths are still read during the compatibility window, but new writes land in the brief paths above.

### Core Principles
1. **One file per checkpoint** (YAML frontmatter + markdown body)
2. **One file per brief** (already YAML frontmatter)
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

### Brief Format

**File**: `{project}/.memories/briefs/auth-system.md`

```markdown
---
id: auth-system
status: active
created: 2026-02-14T09:00:00Z
updated: 2026-02-14T16:45:00Z
tags: [backend, security, high-priority]
---

# Authentication System Redesign

## Goal

Redesign auth around durable refresh-token sessions.

## Why Now

Timeout bugs and session drift keep burning time across sessions.

## Constraints

- Keep one-release compatibility for existing auth clients
- Do not break admin SSO

## Success Criteria

- Recall and checkpoint evidence line up with the new auth direction
- `docs/plans/` contains the execution breakdown

## References

- docs/plans/2026-02-14-auth-system-redesign.md
```

### Active Brief Tracker

**File**: `{project}/.memories/.active-brief`

```
auth-system
```

That's it. Just the brief ID. Simple.

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
| `src/workspace.ts` | Workspace detection, `getMemoriesDir()`, `getBriefsDir()`, `getPlansDir()`, `ensureMemoriesDir()` |
| `src/checkpoints.ts` | YAML frontmatter individual files, `generateCheckpointId()`, `saveCheckpoint()`, `getCheckpointsForDay()`, `getCheckpointsForDateRange()` |
| `src/plans.ts` | Brief CRUD with legacy plan compatibility, active brief tracking |
| `src/recall.ts` | Search (fuse.js), aggregation, cross-project recall via registry |
| `src/digests.ts` | Compact retrieval digests for lexical search and compact result presentation |
| `src/semantic-cache.ts` | Derived semantic manifest/records storage under `~/.goldfish/cache/semantic/` |
| `src/semantic.ts` | Embedding runtime and pending semantic work processing |
| `src/ranking.ts` | Hybrid ranking and scoring helpers |
| `src/transformers-embedder.ts` | Lazy local embedding runtime backed by `@huggingface/transformers` |
| `src/memory.ts` | Memory file I/O (memory.yaml), consolidation state I/O |
| `src/consolidation-prompt.ts` | Consolidation subagent prompt builder |
| `src/logger.ts` | File-based logging |
| `src/registry.ts` | `~/.goldfish/registry.json` management, auto-registration, stale filtering |
| `src/git.ts` | Git context capture (branch, commit, files) |
| `src/lock.ts` | File locking for concurrent writes |
| `src/summary.ts` | Auto-summary generation for long descriptions |
| `src/emoji.ts` | Fish emoji helper |
| `src/server.ts` | MCP server setup |
| `src/handlers/` | Tool handlers (checkpoint, recall, brief, consolidate) |
| `src/tools.ts` | Tool definitions |
| `src/instructions.ts` | Server behavioral instructions |
| `src/types.ts` | TypeScript interfaces |

---

## Plugin Structure

```
goldfish/
├── .claude-plugin/plugin.json
├── skills/
│   ├── recall/SKILL.md
│   ├── checkpoint/SKILL.md
│   ├── consolidate/SKILL.md
│   ├── brief/SKILL.md
│   ├── brief-status/SKILL.md
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

**Hybrid recall flow:**
1. Load markdown checkpoints from `.memories/` and build compact retrieval digests.
2. Run Fuse lexical search over those digests so search always has a fast fallback path.
3. Start query embedding opportunistically with a short timeout. If it resolves in budget, blend lexical, semantic, metadata, and recency signals into a hybrid ranking.
4. If semantic work times out, fails, or the derived cache is broken, return lexical results and recover semantic state lazily.
5. Present compact search descriptions by default; `full: true` returns the original markdown body and metadata.
6. After search, process a bounded amount of pending semantic work so indexing debt amortizes across searches instead of blocking one request.

**Semantic maintenance details:**
- Pending semantic work is queued on checkpoint save.
- Search-triggered maintenance is best-effort and bounded by per-search item/time budgets; recall always succeeds even if embedding work fails.
- Model-version invalidation marks derived records stale without touching checkpoint markdown.
- Corrupted or inconsistent derived cache state is detected, warned, and reset to empty; backfill recreates it from source markdown.
- Semantic cache and model downloads live under `~/.goldfish/`, outside `.memories/`, and can be rebuilt from source markdown.
- Pruning orphaned semantic caches acquires the cache lock before deletion, skipping caches with active operations.

Recall runs **automatically at session start** via the SessionStart hook. Users can also invoke `/recall` manually for targeted queries (search, cross-project, time ranges).

### Brief Tool
- Keeps strong guidance around maintaining durable strategic direction
- Does not mirror harness plan mode or copy execution checklists into Goldfish

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

### Complete - v6.6.0

**ALL MODULES IMPLEMENTED AND TESTED**

1. **Workspace utilities** - Detection, normalization, `.memories/` directory management
2. **Git context** - Branch, commit, files capture
3. **Checkpoint storage** - YAML frontmatter individual files, atomic writes, concurrent safety
4. **Brief storage** - YAML frontmatter, CRUD, active brief tracking, legacy plan compatibility
5. **Recall with fuse.js** - Fuzzy search, cross-workspace aggregation, date range filtering
6. **Cross-project registry** - `~/.goldfish/registry.json`, auto-registration, stale filtering
7. **MCP server** - Tools (checkpoint, recall, brief, consolidate), behavioral guidance
8. **Claude Code plugin** - Skills, hooks, plugin.json
9. **Auto-summary** - Summary generation for long descriptions
10. **File locking** - Concurrent write safety
11. **Semantic recall** - Hybrid ranking, embedding runtime, derived cache
12. **Memory consolidation** - memory.yaml, consolidation state, subagent prompt builder

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
