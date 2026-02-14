# Phase 3: Registry

**Goal:** Implement `~/.goldfish/registry.json` for cross-project discovery. Enable cross-project recall and auto-registration.

**Risk:** Low — additive feature, new module, no existing code modified (except recall for cross-project scanning).

## Registry Design

### File: `~/.goldfish/registry.json`

```json
{
  "projects": [
    {
      "path": "/Users/murphy/source/goldfish",
      "name": "goldfish",
      "registered": "2026-02-14T09:30:42.123Z"
    },
    {
      "path": "/Users/murphy/source/julie",
      "name": "julie",
      "registered": "2026-02-14T10:15:00.000Z"
    },
    {
      "path": "/Users/murphy/source/miller",
      "name": "miller",
      "registered": "2026-02-14T11:00:00.000Z"
    }
  ]
}
```

### Behavior
- **Auto-register:** When `saveCheckpoint()` is called, register the current project if not already registered
- **Name derivation:** Use `normalizeWorkspace(path)` for the display name
- **Stale detection:** When scanning for standup/cross-project recall, skip projects whose `.memories/` directory doesn't exist (project may have moved)
- **Manual management:** Provide register/unregister functions (exposed via plan tool or a lightweight mechanism)

## New File: `src/registry.ts`

### Functions

```typescript
interface RegisteredProject {
  path: string;       // Absolute path to project root
  name: string;       // Normalized workspace name
  registered: string; // ISO 8601 UTC
}

interface Registry {
  projects: RegisteredProject[];
}

// Read registry (returns empty if file doesn't exist)
function getRegistry(): Promise<Registry>

// Add a project to registry (idempotent — no-op if already registered)
function registerProject(projectPath: string): Promise<void>

// Remove a project from registry
function unregisterProject(projectPath: string): Promise<void>

// List all registered projects (filters out stale entries whose .memories/ doesn't exist)
function listRegisteredProjects(): Promise<RegisteredProject[]>

// Get the registry file path (~/.goldfish/registry.json)
function getRegistryPath(): string
```

### Implementation details
- Atomic writes (write to temp, rename)
- File locking (same pattern as checkpoints)
- Create `~/.goldfish/` directory if it doesn't exist
- `listRegisteredProjects()` checks each path exists and has `.memories/` — filters out stale entries but doesn't auto-remove them

## Changes to `src/checkpoints.ts`

- In `saveCheckpoint()`, after successful write, call `registerProject(cwd)` (fire-and-forget, don't block on it)

## Changes to `src/recall.ts`

### Cross-project recall flow
When `workspace === 'all'`:
1. Call `listRegisteredProjects()`
2. For each project, call `recallFromWorkspace(project.path, options)`
3. Merge results, sort by timestamp (newest first)
4. Apply limit across all projects
5. Tag each checkpoint with its project name for display

### Updated `RecallResult`
```typescript
interface RecallResult {
  checkpoints: (Checkpoint & { workspace?: string })[];
  activePlan?: Plan;
  // workspaces field now populated from registry
  workspaces?: string[];
}
```

## Tests: `tests/registry.test.ts`

### TDD steps
1. Test `getRegistryPath()` returns `~/.goldfish/registry.json`
2. Test `getRegistry()` returns empty when file doesn't exist
3. Test `registerProject()` adds entry, is idempotent
4. Test `unregisterProject()` removes entry
5. Test `listRegisteredProjects()` filters stale paths
6. Test concurrent registration (file locking)
7. Test auto-registration from `saveCheckpoint()`

### TDD steps for cross-project recall
1. Set up temp registry with 2-3 project paths, each with `.memories/` and checkpoints
2. Test `recall({ workspace: 'all' })` returns checkpoints from all projects
3. Test results are sorted by timestamp globally
4. Test limit applies across all projects
5. Test each checkpoint tagged with workspace name

## Verification

1. All tests pass
2. Save checkpoint → project auto-registered in `~/.goldfish/registry.json`
3. `recall({ workspace: 'all' })` returns checkpoints across registered projects
4. Stale projects (deleted `.memories/`) are filtered from results

## Exit Criteria

- Registry module complete with tests
- Auto-registration on checkpoint save
- Cross-project recall works via registry
- Stale project filtering works
- All tests green
