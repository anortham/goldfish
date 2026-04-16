# Goldfish - Implementation Specification

## Design Philosophy

**Radical Simplicity**: Everything is markdown. No database, no derived caches. Let the agent's intelligence handle complexity, we just provide transparent storage and retrieval.

**Test-Driven Development**: Write tests first. Every feature starts with a failing test.

**Lessons Learned**: This is iteration #5. We're taking the best from each previous attempt:
- Original Goldfish: Workspace normalization, transparency
- Tusk: Directive behavioral language (recalibrated for quality over frequency)
- .NET attempt: Behavioral adoption patterns, tool priorities
- Goldfish 4.0: Markdown-only storage, radical simplicity, centralized ~/.goldfish/
- Fixing: Race conditions, date bugs, cross-workspace issues, hook spam
- Goldfish 7.0 subtract sprint: removed semantic stack, hooks, consolidation, and the plan tool; settled on Orama BM25 over the markdown corpus

---

## Architecture

```
{project}/.memories/
  {date}/{HHMMSS}_{hash}.md   # Individual checkpoints (YAML frontmatter)
  briefs/{brief-id}.md         # Briefs (YAML frontmatter)
  .active-brief                # Active brief ID

~/.goldfish/
  registry.json                # Cross-project registry
```

Legacy `.memories/plans/` and `.active-plan` paths are still read so older repos keep working, but new writes land in the brief paths above.

### Core Principles
1. **One file per checkpoint** (YAML frontmatter + markdown body)
2. **One file per brief** (already YAML frontmatter)
3. **Project-local storage** (git-committable)
4. **Cross-project via registry** (~/.goldfish/registry.json)
5. **Atomic writes** (write-then-rename with locking)
6. **No derived caches** -- search runs over the markdown corpus on demand

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
| `src/workspace.ts` | Workspace detection, `getMemoriesDir()`, `getBriefsDir()`, `ensureMemoriesDir()` (legacy `getPlansDir()` is retained internally for reading old plan files) |
| `src/checkpoints.ts` | YAML frontmatter individual files, `generateCheckpointId()`, `saveCheckpoint()`, `getCheckpointsForDay()`, `getCheckpointsForDateRange()` |
| `src/briefs.ts` | Brief CRUD, active brief tracking, legacy plan-path reads |
| `src/recall.ts` | Aggregation across date ranges and workspaces, cross-project recall via registry |
| `src/ranking.ts` | Orama BM25 search ranking |
| `src/digests.ts` | Compact retrieval digests and compact result presentation |
| `src/file-io.ts` | Atomic write helpers |
| `src/logger.ts` | File-based logging |
| `src/registry.ts` | `~/.goldfish/registry.json` management, auto-registration, stale filtering |
| `src/git.ts` | Git context capture (branch, commit, files) |
| `src/lock.ts` | File locking for concurrent writes |
| `src/summary.ts` | Auto-summary generation for long descriptions |
| `src/emoji.ts` | Fish emoji helper |
| `src/server.ts` | MCP server setup |
| `src/handlers/` | Tool handlers (checkpoint, recall, brief) |
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
│   ├── brief/SKILL.md
│   ├── brief-status/SKILL.md
│   └── standup/SKILL.md
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

**Dual-mode recall:**
- **Last-N mode** (default): When no date parameters are provided, returns the last `limit` checkpoints (default: 5) regardless of age. No date window.
- **Date-window mode**: When `days`, `since`, `from`, or `to` is provided, filters checkpoints to that date range.

**Recall flow:**
1. Load markdown checkpoints from `.memories/` and build compact retrieval digests.
2. When `search` is supplied, run an Orama BM25 query over those digests with field-weighted ranking (description body, summary, tags, git metadata).
3. Present compact search descriptions by default; `full: true` returns the original markdown body and metadata.
4. Aggregate the active brief and (when `workspace: "all"`) results from peer projects discovered through the registry.

Agents call `recall()` at session start. Users can also invoke `/recall` for targeted queries (search, cross-project, time ranges).

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
- Search (BM25, 100 checkpoints): < 50ms
- Workspace detection: < 10ms

We achieve this through:
- Individual file writes (no append locking needed)
- Smart caching of workspace list
- Efficient YAML frontmatter parsing
- Orama BM25 ranking built fresh per query over compact digests

---

## Implementation Status

### Complete

1. **Workspace utilities** - Detection, normalization, `.memories/` directory management
2. **Git context** - Branch, commit, files capture
3. **Checkpoint storage** - YAML frontmatter individual files, atomic writes, concurrent safety
4. **Brief storage** - YAML frontmatter, CRUD, active brief tracking, legacy plan-path reads
5. **Recall** - BM25 search via Orama, cross-workspace aggregation, date range filtering
6. **Cross-project registry** - `~/.goldfish/registry.json`, auto-registration, stale filtering
7. **MCP server** - Tools (checkpoint, recall, brief), behavioral guidance
8. **Claude Code plugin** - Skills, plugin.json
9. **Auto-summary** - Summary generation for long descriptions
10. **File locking** - Concurrent write safety

**Current architecture:** markdown source of truth in `.memories/`, registry under `~/.goldfish/`, runtime dependencies `@modelcontextprotocol/sdk`, `@orama/orama`, `yaml`.

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
