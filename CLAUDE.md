# Goldfish Development Guide for AI Agents

**Target: AI agents contributing to Goldfish development**

## MANDATORY: Test-Driven Development

**THIS IS A TDD PROJECT. NO EXCEPTIONS.**

1. **Write test FIRST** (watch it fail)
2. **Implement** minimum code to pass
3. **Refactor** if needed
4. **Commit** test + implementation together

**If you write production code before tests, STOP. Delete it. Start over with the test.**

---

## Project Context: Iteration #5

This is the **fifth iteration** of a developer memory system. We've learned hard lessons:

1. **Original Goldfish (TypeScript)** - Good concepts, critical bugs (race conditions, date handling)
2. **Tusk (Bun + SQLite)** - Fixed bugs, became too complex, hook spam disaster
3. **.NET rewrite** - Over-engineered, never finished
4. **Goldfish 4.0** - Radical simplicity, markdown storage, evidence-based features
5. **Goldfish 5.0** - **Claude Code plugin**, project-local `.memories/`, cross-project registry, skills & hooks

**Core principle:** We only add complexity when we have EVIDENCE we need it.

---

## Architecture Overview

### Storage: Project-Local Markdown Files (No Database)

```
{project}/.memories/
  {date}/
    {HHMMSS}_{hash}.md    # Individual checkpoint files (YAML frontmatter)
  plans/
    {plan-id}.md           # Individual plans (YAML frontmatter)
  .active-plan             # Contains active plan ID

~/.goldfish/
  registry.json            # Cross-project registry (auto-populated)
```

**Everything is human-readable markdown.** No database. No binary formats. Git-friendly. Memories live with the project.

### Claude Code Plugin

Goldfish is a **Claude Code plugin** with:

- **`.claude-plugin/plugin.json`** - Plugin manifest for auto-discovery
- **`.mcp.json`** - MCP server auto-registration
- **`skills/`** - 5 Claude Code skills (slash commands)
- **`hooks/`** - 3 Claude Code hooks (lifecycle automation)

### Core Modules

| Module | Purpose | Test File | Lines |
|--------|---------|-----------|-------|
| `src/workspace.ts` | Workspace normalization, .memories/ paths | `tests/workspace.test.ts` | ~78 |
| `src/checkpoints.ts` | Checkpoint storage (YAML frontmatter individual files) | `tests/checkpoints.test.ts` | ~285 |
| `src/plans.ts` | Plan management | `tests/plans.test.ts` | ~285 |
| `src/recall.ts` | Search, aggregation, cross-project recall | `tests/recall.test.ts` | ~269 |
| `src/registry.ts` | Cross-project registry | `tests/registry.test.ts` | ~145 |
| `src/git.ts` | Git context capture | `tests/git.test.ts` | ~84 |
| `src/lock.ts` | File locking utilities | `tests/lock.test.ts` | ~95 |
| `src/server.ts` | MCP server | `tests/server.test.ts` | ~83 |
| `src/handlers/` | Tool handlers (checkpoint, recall, plan) | `tests/handlers.test.ts` | ~275 |
| `src/tools.ts` | Tool definitions | - | ~241 |
| `src/instructions.ts` | Server instructions | - | ~81 |
| `src/types.ts` | Type definitions | - | ~96 |
| `src/emoji.ts` | Fish emoji helper | - | ~12 |
| `src/summary.ts` | Auto-summary generation | - | ~34 |

**Total production code: ~2,070 lines. Well-structured and maintainable.**

### Key Types

```typescript
interface Checkpoint {
  id: string;             // checkpoint_{hash} unique identifier
  timestamp: string;      // ISO 8601 UTC (ALWAYS UTC!)
  description: string;    // Markdown body
  tags?: string[];
  git?: GitContext;        // Nested git context
  summary?: string;       // Auto-generated concise summary
  planId?: string;        // ID of active plan when checkpoint was created
}

interface GitContext {
  branch?: string;
  commit?: string;
  files?: string[];
}

interface Plan {
  id: string;
  title: string;
  content: string;        // Markdown body
  status: 'active' | 'completed' | 'archived';
  created: string;        // ISO 8601 UTC
  updated: string;        // ISO 8601 UTC
  tags: string[];
}

interface RecallOptions {
  workspace?: string;     // 'current' | 'all' | specific path
  limit?: number;         // Max checkpoints (default: 5). When no date params, uses last-N mode
  days?: number;          // Look back N days (enables date-window mode)
  from?: string;          // ISO 8601 UTC
  to?: string;            // ISO 8601 UTC
  since?: string;         // Human-friendly ("2h", "30m", "3d") or ISO 8601 UTC
  search?: string;        // Fuzzy search query (fuse.js)
  full?: boolean;         // Include full descriptions + git metadata (default: false)
  planId?: string;        // Filter to checkpoints associated with this plan
}

interface RegisteredProject {
  path: string;           // Absolute path to project
  name: string;           // Normalized workspace name
  registered: string;     // ISO 8601 UTC
}

interface Registry {
  projects: RegisteredProject[];
}
```

---

## Critical Patterns (ALWAYS Follow)

### 1. Atomic File Writes

**ALWAYS use write-then-rename pattern** (prevents corruption on crashes):

```typescript
const tmpPath = `${filePath}.tmp`;
await writeFile(tmpPath, content, 'utf-8');
await rename(tmpPath, filePath);  // Atomic!
```

### 2. UTC Timestamps Everywhere

```typescript
// CORRECT
const timestamp = new Date().toISOString();

// WRONG - caused bugs in v1
const localDate = new Date().toLocaleDateString();
```

### 3. Workspace Normalization

```typescript
// /Users/user/source/goldfish → goldfish
// /home/dev/@org/project → org-project
function normalizeWorkspace(path: string): string {
  let name = path.replace(/^.*[/\\]/, '');
  name = name.replace(/^@/, '').replace(/\//g, '-');
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
```

### 4. File Locking for Concurrent Writes

```typescript
import { open } from 'fs/promises';

const fd = await open(lockPath, 'wx');  // Exclusive create
try {
  // Critical section
} finally {
  await fd.close();
  await unlink(lockPath);
}
```

---

## TDD Workflow (Mandatory)

```bash
# 1. Write failing test
bun test tests/checkpoints.test.ts --watch

# 2. Implement minimum code to pass
# Edit src/checkpoints.ts

# 3. Watch test pass (automatic in watch mode)

# 4. Refactor if needed (keep tests green)

# 5. Commit test + implementation together
git add tests/checkpoints.test.ts src/checkpoints.ts
git commit -m "Add checkpoint storage with atomic writes"
```

**Current test status: 265 tests, all passing.**

---

## Project Principles

### DO

- Write tests first (TDD mandatory)
- Keep data human-readable (markdown)
- Use atomic file operations (write-then-rename)
- Keep timestamps in UTC
- Trust the agent's intelligence (let Claude be smart)
- Read `docs/IMPLEMENTATION.md` for detailed specs
- Keep code well-structured and maintainable
- Store memories with the project (`.memories/` directory)

### DON'T

- Write code before tests (TDD violation)
- Add database (we're staying simple)
- Mix local dates with UTC (caused bugs in v1)
- Add "intelligence" to storage layer (Goldfish is dumb storage, Claude is smart)
- Add features without evidence from real usage
- Add aggressive frequency-pushing language back to tool descriptions (we tuned this down deliberately)

---

## Behavioral Language Pattern

MCP tool descriptions are **directive about quality, restrained about frequency**.

- **Quality guidance stays strong**: checkpoint descriptions must be structured markdown with WHAT/WHY/HOW/IMPACT. Lazy descriptions are unacceptable.
- **Frequency guidance is deliberately calm**: checkpoint at milestones, not after every action. No "MANDATORY" or "I WILL BE DISAPPOINTED" language pushing agents to checkpoint constantly.
- **Recall runs automatically at session start** via the SessionStart hook. Users can also invoke `/recall` for targeted queries.
- **Plans keep strong language**: plan persistence genuinely matters and the directive tone is warranted there.

This was recalibrated after observing real-world overuse: 100+ checkpoints/day, rapid-fire duplicates, 20KB checkpoint files with 376 `.memories/` entries.

---

## Adding New Features

Before adding ANY feature, ask:

1. **Do we have EVIDENCE this is needed?** (from real usage)
2. **Can the agent handle this with existing tools?** (let Claude be smart)
3. **Does this add significant complexity?** (keep it simple)
4. **Have we written the test first?** (TDD mandatory)

If you can't answer "yes" to 1, 2, 4 and "no" to 3, **DON'T ADD IT.**

---

## Common Mistakes to Avoid

- Writing implementation before tests
- Using local time instead of UTC
- Direct file writes (use atomic pattern)
- Adding features without evidence
- Adding database "because it's better"
- Premature optimization
- Skipping file locking for concurrent writes

---

## Performance Expectations

- Checkpoint save: < 50ms (currently ~10ms)
- Recall (7 days, single workspace): < 100ms (currently ~30ms)
- Recall (7 days, all workspaces): < 500ms (currently ~150ms)
- Search (100 checkpoints): < 50ms (currently ~15ms)

**Don't optimize prematurely.** Profile first if hitting issues.

---

## Testing

```bash
# Run all tests
bun test

# Watch mode (use during development)
bun test --watch

# Single test
bun test tests/workspace.test.ts -t "normalizes full path"

# Coverage
bun test --coverage
```

**Every feature MUST have tests. No exceptions.**

---

## Tech Stack

- **Runtime:** Bun (for speed + built-in test runner)
- **MCP SDK:** `@modelcontextprotocol/sdk` (^1.26.0)
- **Search:** `fuse.js` (fuzzy search, proven from v1)
- **YAML:** `yaml` package (for plan frontmatter)
- **Language:** TypeScript
- **Version:** 5.3.0

---

## Quick Reference

### File Operations
```typescript
// Atomic write
const tmp = `${path}.tmp`;
await writeFile(tmp, content, 'utf-8');
await rename(tmp, path);

// File locking
const fd = await open(lockPath, 'wx');
try { /* ... */ } finally { await fd.close(); await unlink(lockPath); }
```

### Timestamps
```typescript
const now = new Date().toISOString();  // Always UTC!
const dateKey = now.split('T')[0];     // 2025-10-14
```

### Git Context
```typescript
const branch = spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
const commit = spawnSync(['git', 'rev-parse', '--short', 'HEAD']);
```

---

## Documentation Structure

- **`README.md`** - User-facing documentation (humans using Goldfish)
- **`CLAUDE.md`** - This file (AI agents developing Goldfish)
- **`AGENTS.md`** - Pointer for AI agents (directs to appropriate doc)
- **`CONTRIBUTING.md`** - Detailed development guide (comprehensive patterns)
- **`docs/IMPLEMENTATION.md`** - Technical specification
- **`skills/`** - Claude Code plugin skills (slash commands)
- **`hooks/`** - Claude Code plugin hooks (lifecycle automation)

---

## Success Criteria

You're doing it right when:

- Every commit has tests
- Tests are written BEFORE implementation
- Data is readable in any text editor
- Code stays well-structured and maintainable
- No features added without evidence
- Performance stays under target thresholds

---

## Remember

**Radical simplicity.** Evidence-based features. TDD mandatory. Trust Claude's intelligence.

Let markdown be your database. Keep Goldfish as transparent, dumb storage. ~150ms.

**For detailed patterns and debugging, see `CONTRIBUTING.md`.**
