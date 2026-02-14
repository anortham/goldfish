# Phase 2: New Checkpoint Format

**Goal:** Rewrite checkpoint storage to use Julie's per-file YAML frontmatter format. Update workspace to use project-level `.memories/` directory.

**Risk:** Medium — this is the most significant rewrite. Touches checkpoints, workspace, recall, and their tests. TDD mandatory.

## New Storage Layout

```
{project}/.memories/
  2026-02-14/
    093042_a1b2.md       # HHMMSS_shortId.md
    143015_f4e1.md
  2026-02-15/
    101500_b2a4.md
  plans/
    auth-system.md
  .active-plan
```

Replaces the current `~/.goldfish/{workspace}/checkpoints/` with `{project}/.memories/`.

## New Checkpoint File Format

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
    - tests/auth.test.ts
---

## Fixed JWT validation bug

- **Root cause**: Expiry check was inverted
- **Fix**: Flipped comparison operator
- **Tests**: Added 3 edge-case tests
```

### Format decisions
- **Timestamps:** ISO 8601 UTC (keeping Goldfish convention)
- **ID format:** `checkpoint_{8-char-hash}` — hash derived from timestamp + description
- **File naming:** `{HHMMSS}_{4-char-hex}.md` — the 4-char hex is the first 4 chars of the ID hash for uniqueness
- **Body:** Free-form markdown (the description from the checkpoint call)

## Changes to `src/workspace.ts`

### Current behavior
- `getWorkspacePath(workspace)` → `~/.goldfish/{normalized-name}`
- `ensureWorkspaceDir()` → creates `checkpoints/` and `plans/` under `~/.goldfish/{workspace}/`

### New behavior
- `getMemoriesDir(projectPath?)` → `{projectPath || cwd}/.memories/`
- `ensureMemoriesDir(projectPath?)` → creates `.memories/` and `.memories/plans/`
- `getCheckpointsDir(projectPath?)` → `{projectPath}/.memories/` (checkpoints live at root of .memories)
- `getPlansDir(projectPath?)` → `{projectPath}/.memories/plans/`
- Keep `normalizeWorkspace()` — still needed for registry and display
- Keep `getCurrentWorkspace()` — still useful for identification
- Remove `listWorkspaces()` — replaced by registry in Phase 3

### TDD steps
1. Write tests for `getMemoriesDir()` — returns correct path
2. Write tests for `ensureMemoriesDir()` — creates directory structure
3. Implement and verify green
4. Update existing workspace tests for new paths

## Changes to `src/checkpoints.ts`

### Functions to rewrite

**`formatCheckpoint(checkpoint)` → `formatCheckpointFile(checkpoint)`**
- Current: `## HH:MM - Description` with HTML comment metadata
- New: YAML frontmatter + markdown body
- Generate ID from hash of timestamp + description
- Structure git context as nested YAML object

**`parseCheckpointFile(content)` → `parseCheckpointFromFile(content)`**
- Current: splits by `## HH:MM` headers, extracts HTML comments
- New: parse YAML frontmatter with `yaml` package, body is everything after `---`
- Return Checkpoint object

**`saveCheckpoint(options)` — updated flow**
- Current: append to daily aggregate file with lock
- New: write individual file to `.memories/{date}/{HHMMSS}_{hash}.md`
- Ensure date directory exists
- Atomic write (temp file + rename)
- File locking still needed (for the date directory)
- Return checkpoint with ID, timestamp, git context

**`getCheckpointsForDay(date, memoriesDir)` — updated**
- Current: read single `{date}.md` file, parse multiple checkpoints
- New: scan `{date}/` directory, parse each `.md` file
- Return array of Checkpoint sorted by timestamp

**`getCheckpointsForDateRange(from, to, memoriesDir)` — updated**
- Current: iterate date-named `.md` files
- New: iterate date-named directories, scan each for `.md` files
- Filter by actual timestamp (not just directory date)
- Sort chronologically

### TDD steps
1. Write test for `formatCheckpointFile()` — produces valid YAML frontmatter + body
2. Write test for `parseCheckpointFromFile()` — round-trips correctly
3. Write test for `saveCheckpoint()` — creates file in correct location with correct format
4. Write test for `getCheckpointsForDay()` — reads directory of individual files
5. Write test for `getCheckpointsForDateRange()` — scans date directories
6. Implement each, verify green

## Changes to `src/types.ts`

Update `Checkpoint` type:
```typescript
interface Checkpoint {
  id: string;              // NEW: checkpoint_{hash}
  timestamp: string;       // ISO 8601 UTC
  description: string;     // Markdown body
  tags?: string[];
  git?: {                  // Restructured as nested object
    branch?: string;
    commit?: string;
    files?: string[];
  };
  summary?: string;        // Keep for recall display
}
```

## Changes to `src/plans.ts`

- Update `getPlansDir()` calls to use new `.memories/plans/` path
- Update `getActivePlanPath()` to use `.memories/.active-plan`
- Minimal changes — plan format is already YAML frontmatter

## Changes to `src/recall.ts`

- Update to read from `.memories/` instead of `~/.goldfish/{workspace}/checkpoints/`
- Update `recallFromWorkspace()` to accept a project path
- Cross-project scanning deferred to Phase 3 (registry)

## Test Updates

### `tests/checkpoints.test.ts` — major rewrite
- All tests updated for new format and file structure
- Test YAML frontmatter generation and parsing
- Test individual file creation (not daily aggregate)
- Test date directory scanning
- Test atomic writes still work
- Test concurrent writes still safe

### `tests/workspace.test.ts` — updated paths
- Test `getMemoriesDir()` returns project-level path
- Test `ensureMemoriesDir()` creates correct structure
- Remove tests for `~/.goldfish/` paths

### `tests/recall.test.ts` — updated
- Remove semantic/distill test cases (should already be gone from Phase 1)
- Update to use new checkpoint format in test fixtures
- Update workspace paths

### `tests/plans.test.ts` — minor updates
- Update paths to `.memories/plans/`
- Verify plans still work with new directory structure

### `tests/handlers.test.ts` — updated
- Remove store handler tests
- Update checkpoint/recall handler tests for new format

## Verification

1. All tests pass
2. Can save a checkpoint → file appears at `.memories/{date}/{time}_{hash}.md`
3. Can recall checkpoints → reads from `.memories/` correctly
4. Can save/recall plans → works from `.memories/plans/`
5. Round-trip: save checkpoint → recall → data matches

## Exit Criteria

- All tests green
- Checkpoints stored as individual YAML frontmatter markdown files
- Storage at project-level `.memories/` not `~/.goldfish/`
- Plans work from `.memories/plans/`
- No references to old daily aggregate format
- No references to `~/.goldfish/{workspace}/checkpoints/`
