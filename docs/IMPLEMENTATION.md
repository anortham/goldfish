# Goldfish Memory System - Implementation Specification

## Design Philosophy

**Radical Simplicity**: Everything is markdown. No database. No hooks initially. Let the agent's intelligence handle complexity, we just provide transparent storage and retrieval.

**Test-Driven Development**: Write tests first. Every feature starts with a failing test.

**Lessons Learned**: This is iteration #4. We're taking the best from each previous attempt:
- Original Goldfish: Workspace normalization, fuse.js search, transparency
- Tusk: Aggressive behavioral language that works, SQLite integrity (but we're going simpler)
- .NET attempt: Behavioral adoption patterns, tool priorities
- Fixing: Race conditions, date bugs, cross-workspace issues, hook spam

---

## Architecture Overview

```
~/.goldfish/
  codesearch/
    checkpoints/
      2025-10-13.md          # Daily checkpoint files
      2025-10-14.md
    plans/
      auth-system.md         # Individual plan files (YAML frontmatter)
      api-redesign.md
    .active-plan             # Contains: "auth-system"
  goldfish/
    checkpoints/...
    plans/...
    .active-plan
```

### Core Principles
1. **One file per day** for checkpoints (append-only, no race conditions)
2. **One file per plan** (individual plans, easy to manage)
3. **Text-based tracking** (.active-plan is just a text file)
4. **Cross-workspace by default** (standup aggregates all workspaces)

---

## Data Formats

### Checkpoint File Format

**File**: `~/.goldfish/{workspace}/checkpoints/2025-10-13.md`

```markdown
# Checkpoints for 2025-10-13

## 09:30 - Fixed authentication timeout bug
Implemented JWT refresh tokens to extend session duration from 30min to 60min.

- **Tags**: bug-fix, auth, critical
- **Branch**: feature/jwt-refresh
- **Commit**: a1b2c3d
- **Files**: src/auth/jwt.ts, src/auth/refresh.ts

## 14:45 - Discussed memory architecture
Analyzed three previous implementations and identified key architectural decisions.

- **Tags**: planning, goldfish, architecture
- **Session**: plan-mode-20251013

## 16:30 - Completed checkpoint storage implementation
Built markdown-based checkpoint storage with atomic append operations.

- **Tags**: implementation, goldfish
- **Branch**: main
```

### Plan File Format

**File**: `~/.goldfish/{workspace}/plans/auth-system.md`

```markdown
---
id: auth-system
status: active
created: 2025-10-13T09:00:00Z
updated: 2025-10-13T16:45:00Z
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
2025-10-13: JWT refresh working, tested with 60min expiry.
```

### Active Plan Tracker

**File**: `~/.goldfish/{workspace}/.active-plan`

```
auth-system
```

That's it. Just the plan ID. Simple.

---

## TDD Implementation Order

### Phase 1: Workspace Utilities (TDD)

**Test**: `tests/workspace.test.ts`
```typescript
describe('Workspace normalization', () => {
  it('normalizes full path to simple name', () => {
    expect(normalizeWorkspace('/Users/murphy/source/goldfish'))
      .toBe('goldfish');
  });

  it('handles Windows paths', () => {
    expect(normalizeWorkspace('C:\\source\\goldfish'))
      .toBe('goldfish');
  });

  it('handles package names', () => {
    expect(normalizeWorkspace('@coa/goldfish-mcp'))
      .toBe('coa-goldfish-mcp');
  });

  it('detects current workspace from cwd', () => {
    const workspace = getCurrentWorkspace();
    expect(workspace).toBeTruthy();
    expect(workspace).toMatch(/^[a-z0-9-]+$/);
  });
});
```

**Implementation**: `src/workspace.ts`
- `normalizeWorkspace(path: string): string`
- `getCurrentWorkspace(): string`
- `getWorkspacePath(workspace: string): string`
- `listWorkspaces(): string[]`

### Phase 2: Checkpoint Storage (TDD)

**Test**: `tests/checkpoints.test.ts`
```typescript
describe('Checkpoint storage', () => {
  it('saves checkpoint to daily file', async () => {
    await saveCheckpoint({
      description: 'Test checkpoint',
      tags: ['test'],
      workspace: 'test-workspace'
    });

    const content = await readCheckpointFile('test-workspace', '2025-10-13');
    expect(content).toContain('Test checkpoint');
  });

  it('appends to existing daily file', async () => {
    await saveCheckpoint({ description: 'First', workspace: 'test' });
    await saveCheckpoint({ description: 'Second', workspace: 'test' });

    const checkpoints = await getCheckpointsForDay('test', '2025-10-13');
    expect(checkpoints).toHaveLength(2);
  });

  it('captures git context automatically', async () => {
    await saveCheckpoint({ description: 'Test', workspace: 'test' });
    const checkpoints = await getCheckpointsForDay('test', '2025-10-13');

    expect(checkpoints[0].gitBranch).toBeTruthy();
    expect(checkpoints[0].gitCommit).toBeTruthy();
  });

  it('handles concurrent writes safely', async () => {
    const writes = Array(10).fill(null).map((_, i) =>
      saveCheckpoint({ description: `Checkpoint ${i}`, workspace: 'test' })
    );

    await Promise.all(writes);
    const checkpoints = await getCheckpointsForDay('test', '2025-10-13');
    expect(checkpoints).toHaveLength(10);
  });
});
```

**Implementation**: `src/checkpoints.ts`
- `saveCheckpoint(checkpoint: CheckpointInput): Promise<void>`
- `getCheckpointsForDay(workspace: string, date: string): Promise<Checkpoint[]>`
- `parseCheckpointFile(content: string): Checkpoint[]`
- `formatCheckpoint(checkpoint: Checkpoint): string`

### Phase 3: Plan Storage (TDD)

**Test**: `tests/plans.test.ts`
```typescript
describe('Plan storage', () => {
  it('saves plan with YAML frontmatter', async () => {
    await savePlan({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Plan content',
      workspace: 'test'
    });

    const plan = await getPlan('test', 'test-plan');
    expect(plan.title).toBe('Test Plan');
    expect(plan.content).toBe('Plan content');
  });

  it('tracks active plan per workspace', async () => {
    await savePlan({ id: 'plan-1', workspace: 'test', activate: true });
    await savePlan({ id: 'plan-2', workspace: 'test', activate: true });

    const active = await getActivePlan('test');
    expect(active?.id).toBe('plan-2');
  });

  it('lists all plans for workspace', async () => {
    await savePlan({ id: 'plan-1', workspace: 'test' });
    await savePlan({ id: 'plan-2', workspace: 'test' });

    const plans = await listPlans('test');
    expect(plans).toHaveLength(2);
  });

  it('updates plan status', async () => {
    await savePlan({ id: 'test', workspace: 'test', status: 'active' });
    await updatePlan('test', 'test', { status: 'completed' });

    const plan = await getPlan('test', 'test');
    expect(plan.status).toBe('completed');
  });
});
```

**Implementation**: `src/plans.ts`
- `savePlan(plan: PlanInput): Promise<void>`
- `getPlan(workspace: string, id: string): Promise<Plan | null>`
- `getActivePlan(workspace: string): Promise<Plan | null>`
- `setActivePlan(workspace: string, id: string): Promise<void>`
- `listPlans(workspace: string): Promise<Plan[]>`
- `updatePlan(workspace: string, id: string, updates: PlanUpdate): Promise<void>`

### Phase 4: Search & Recall (TDD)

**Test**: `tests/recall.test.ts`
```typescript
describe('Recall with fuse.js search', () => {
  beforeEach(async () => {
    await saveCheckpoint({ description: 'Fixed auth bug', tags: ['bug-fix', 'auth'] });
    await saveCheckpoint({ description: 'Added OAuth2 support', tags: ['feature', 'auth'] });
    await saveCheckpoint({ description: 'Refactored database queries', tags: ['refactor', 'database'] });
  });

  it('returns checkpoints from last N days', async () => {
    const results = await recall({ days: 7, workspace: 'test' });
    expect(results.checkpoints).toHaveLength(3);
  });

  it('searches with fuzzy matching', async () => {
    const results = await recall({ search: 'authentication', workspace: 'test' });
    expect(results.checkpoints.length).toBeGreaterThan(0);
    expect(results.checkpoints[0].description).toContain('auth');
  });

  it('aggregates across all workspaces', async () => {
    await saveCheckpoint({ description: 'Work A', workspace: 'project-a' });
    await saveCheckpoint({ description: 'Work B', workspace: 'project-b' });

    const results = await recall({ workspace: 'all', days: 1 });
    expect(results.workspaces).toHaveLength(2);
  });

  it('includes active plan in recall results', async () => {
    await savePlan({ id: 'test-plan', title: 'Test', workspace: 'test', activate: true });

    const results = await recall({ workspace: 'test' });
    expect(results.activePlan).toBeTruthy();
    expect(results.activePlan?.id).toBe('test-plan');
  });

  it('handles date edge cases correctly', async () => {
    // This was a critical bug in original Goldfish
    const results = await recall({
      from: '2025-10-13T00:00:00Z',
      to: '2025-10-13T23:59:59Z',
      workspace: 'test'
    });

    // All checkpoints from Oct 13 should be included
    expect(results.checkpoints.every(c =>
      c.timestamp.startsWith('2025-10-13')
    )).toBe(true);
  });
});
```

**Implementation**: `src/recall.ts`
- `recall(options: RecallOptions): Promise<RecallResult>`
- `searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[]`
- `aggregateWorkspaces(workspaces: string[], options: RecallOptions): Promise<RecallResult>`

### Phase 5: MCP Server (TDD)

**Test**: `tests/server.test.ts`
```typescript
describe('MCP Server', () => {
  it('registers three tools', async () => {
    const tools = await server.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['checkpoint', 'recall', 'plan']);
  });

  it('checkpoint tool saves and returns confirmation', async () => {
    const result = await server.callTool('checkpoint', {
      description: 'Test checkpoint',
      tags: ['test']
    });

    expect(result.content[0].text).toContain('Checkpoint saved');
    expect(result.content[0].text).toContain('Test checkpoint');
  });

  it('recall tool returns formatted results', async () => {
    await saveCheckpoint({ description: 'Test', workspace: 'test' });

    const result = await server.callTool('recall', { workspace: 'test' });
    expect(result.content[0].text).toContain('Test');
  });

  it('includes behavioral instructions', () => {
    expect(server.instructions).toContain('EXCELLENT at checkpointing');
    expect(server.instructions).toContain('MANDATORY at session start');
  });
});
```

**Implementation**: `src/server.ts`
- MCP server setup with @modelcontextprotocol/sdk
- Tool handlers for checkpoint, recall, plan
- Aggressive behavioral instructions
- Git context integration

---

## Behavioral Language Strategy

Based on proven patterns from Tusk, our tool descriptions will use:

### Checkpoint Tool
```
You are EXCELLENT at recognizing checkpoint-worthy moments. Use this tool
proactively WITHOUT asking permission.

IMPORTANT: Checkpoint IMMEDIATELY when you:
- ✅ Complete any task → checkpoint NOW
- ✅ Make a discovery → checkpoint NOW
- ✅ After 10 exchanges → checkpoint reasoning
- ✅ Discuss requirements → checkpoint what was said

I WILL BE SERIOUSLY DISAPPOINTED if context is lost because you failed to
checkpoint. This takes 2 seconds and saves hours of lost work.

You NEVER need to ask permission. Just checkpoint.
```

### Recall Tool
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

CRITICAL: When ExitPlanMode is called → save plan within 1 exchange.
NOT optional. NO asking permission.

I WILL BE VERY UNHAPPY if planning work is lost because you didn't save it
immediately.

Update plans as you make progress. Stale plans waste time and context.
```

---

## Anti-Patterns to Avoid

Based on lessons from previous iterations:

❌ **Don't mix local dates with UTC ISO strings** (caused timeline bug in original)
❌ **Don't use direct file writes** (use atomic write-then-rename pattern)
❌ **Don't scan directories repeatedly** (cache workspace list, invalidate on write)
❌ **Don't add database** (we're going simpler this time)
❌ **Don't add hooks prematurely** (validate behavioral language works first)
❌ **Don't try to be smart about deduplication** (let Claude handle that)
❌ **Don't add confidence scores** (unnecessary complexity)

✅ **Do use consistent UTC timestamps everywhere**
✅ **Do use atomic file operations**
✅ **Do keep workspace detection fast**
✅ **Do keep data human-readable**
✅ **Do trust agents to be smart**

---

## Performance Targets

- Checkpoint save: < 50ms
- Recall (7 days, single workspace): < 100ms
- Recall (7 days, all workspaces): < 500ms
- Search (fuzzy, 100 checkpoints): < 50ms
- Workspace detection: < 10ms

We achieve this through:
- Append-only writes (no file locking needed)
- Smart caching of workspace list
- Efficient markdown parsing (split on headers)
- Fuse.js for fast fuzzy search

---

## Migration from Tusk

Script to convert existing Tusk SQLite data to markdown format:

```typescript
async function migrateTuskData(tuskDbPath: string) {
  // 1. Read all checkpoints from SQLite
  // 2. Group by workspace and date
  // 3. Write to daily markdown files
  // 4. Convert plans to markdown with frontmatter
  // 5. Validate migration (compare counts)
}
```

---

## Success Metrics

After implementation, we validate:

1. ✅ Agents checkpoint proactively without being asked (observe in real sessions)
2. ✅ Agents recall at session start (observe behavior)
3. ✅ Standup reports work across all workspaces (manual test)
4. ✅ All data is readable in any text editor (manual inspection)
5. ✅ No race conditions on concurrent writes (stress test)
6. ✅ Date handling is correct (timezone test)
7. ✅ Search finds relevant results (accuracy test)
8. ✅ Performance targets met (benchmark)

---

## Project Structure

```
goldfish/
├── src/
│   ├── workspace.ts          # Workspace detection/normalization
│   ├── checkpoints.ts         # Checkpoint storage/retrieval
│   ├── plans.ts               # Plan storage/management
│   ├── recall.ts              # Search and aggregation
│   ├── git.ts                 # Git context capture
│   ├── server.ts              # MCP server
│   └── types.ts               # TypeScript types
├── tests/
│   ├── workspace.test.ts
│   ├── checkpoints.test.ts
│   ├── plans.test.ts
│   ├── recall.test.ts
│   ├── server.test.ts
│   └── integration.test.ts
├── plugin/
│   ├── .claude/
│   │   └── commands/          # Slash commands
│   │       ├── recall.md
│   │       ├── checkpoint.md
│   │       ├── standup.md
│   │       └── plan-status.md
│   └── marketplace.json       # Plugin manifest
├── docs/
│   ├── IMPLEMENTATION.md      # This file
│   └── ARCHITECTURE.md        # High-level design
├── package.json
├── tsconfig.json
├── CLAUDE.md                  # Development guide
└── README.md
```

---

## Development Workflow

1. **Write test** for new feature (TDD)
2. **Run test** (watch it fail)
3. **Implement** minimum code to pass
4. **Refactor** if needed
5. **Commit** with test + implementation together
6. **Repeat**

Every commit should have tests. No feature without tests.

---

## Implementation Progress

### ✅ Completed (TDD Green)

1. **Project structure** - package.json, tsconfig.json, dependencies installed
2. **Workspace utilities** - 15 tests passing
   - Normalization (paths, package names, special chars)
   - Current workspace detection
   - Workspace directory management
   - Cross-workspace listing
3. **Git context** - Branch, commit, files capture
4. **Checkpoint storage** - 16 tests passing
   - Atomic write-then-rename (no corruption)
   - Daily markdown files with structured format
   - Concurrent write safety
   - Parse/format checkpoints
   - Date range retrieval

**Total: 31 tests passing | ~350 lines of code**

### 🔄 In Progress

5. **Plan storage** - Writing tests now
   - YAML frontmatter with markdown body
   - Active plan tracking per workspace
   - CRUD operations
   - Plan lifecycle management

### 📋 Next Steps

6. Write recall tests → implement search/aggregation (fuse.js)
7. Write server tests → implement MCP server (3 tools)
8. Create plugin package (slash commands, no hooks initially)
9. Manual testing with Claude Code
10. Migration script from Tusk
11. Documentation polish
