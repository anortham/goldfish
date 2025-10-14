# Goldfish Development Guide for AI Agents

**Target: AI agents contributing to Goldfish development**

## 🚨 MANDATORY: Test-Driven Development

**THIS IS A TDD PROJECT. NO EXCEPTIONS.**

1. **Write test FIRST** (watch it fail)
2. **Implement** minimum code to pass
3. **Refactor** if needed
4. **Commit** test + implementation together

**If you write production code before tests, STOP. Delete it. Start over with the test.**

---

## Project Context: Iteration #4

This is the **fourth iteration** of a developer memory system. We've learned hard lessons:

1. **Original Goldfish (TypeScript)** - Good concepts, critical bugs (race conditions, date handling)
2. **Tusk (Bun + SQLite)** - Fixed bugs, became too complex, hook spam disaster
3. **.NET rewrite** - Over-engineered, never finished
4. **Goldfish 4.0** - **Radical simplicity**, markdown storage, evidence-based features

**Core principle:** We only add complexity when we have EVIDENCE we need it.

---

## Architecture Overview

### Storage: Markdown Files (No Database)

```
~/.goldfish/
  {workspace}/
    checkpoints/
      2025-10-14.md       # Daily checkpoint files
    plans/
      auth-system.md      # Individual plans (YAML frontmatter)
    .active-plan          # Contains active plan ID
```

**Everything is human-readable markdown.** No database. No binary formats. Git-friendly.

### Core Modules

| Module | Purpose | Test File | Lines |
|--------|---------|-----------|-------|
| `src/workspace.ts` | Workspace detection/normalization | `tests/workspace.test.ts` | ~80 |
| `src/checkpoints.ts` | Checkpoint storage/retrieval | `tests/checkpoints.test.ts` | ~120 |
| `src/plans.ts` | Plan management | `tests/plans.test.ts` | ~150 |
| `src/recall.ts` | Search and aggregation | `tests/recall.test.ts` | ~140 |
| `src/git.ts` | Git context capture | `tests/git.test.ts` | ~50 |
| `src/server.ts` | MCP server | `tests/server.test.ts` | ~200 |

**Total core code: ~740 lines. Keep it under 1000.**

### Key Types

```typescript
interface Checkpoint {
  timestamp: string;      // ISO 8601 UTC (ALWAYS UTC!)
  description: string;
  tags?: string[];
  gitBranch?: string;
  gitCommit?: string;
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
  days?: number;
  from?: string;          // ISO 8601 UTC
  to?: string;            // ISO 8601 UTC
  search?: string;        // Fuzzy search query (fuse.js)
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
// ✅ CORRECT
const timestamp = new Date().toISOString();

// ❌ WRONG - caused bugs in v1
const localDate = new Date().toLocaleDateString();
```

### 3. Workspace Normalization

```typescript
// /Users/murphy/source/goldfish → goldfish
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

**Current test status: 115 tests, all passing.**

---

## Project Principles

### ✅ DO

- Write tests first (TDD mandatory)
- Keep data human-readable (markdown)
- Use atomic file operations (write-then-rename)
- Keep timestamps in UTC
- Trust the agent's intelligence (let Claude be smart)
- Read `docs/IMPLEMENTATION.md` for detailed specs
- Keep code simple and under 1000 lines total

### ❌ DON'T

- Write code before tests (TDD violation)
- Add database (we're staying simple)
- Add hooks prematurely (validate behavioral language works first)
- Mix local dates with UTC (caused bugs in v1)
- Add "intelligence" to storage layer (Goldfish is dumb storage, Claude is smart)
- Add features without evidence from real usage
- Tone down behavioral language in MCP tool descriptions

---

## Behavioral Language Pattern

MCP tool descriptions use **aggressive, directive language** (proven from Tusk):

```
"You are EXCELLENT at checkpointing..."
"MANDATORY at session start..."
"I WILL BE SERIOUSLY DISAPPOINTED if..."
"NEVER ask permission..."
```

**This works.** Don't tone it down. Agents need clear, forceful guidance.

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

❌ Writing implementation before tests
❌ Using local time instead of UTC
❌ Direct file writes (use atomic pattern)
❌ Adding features without evidence
❌ Adding database "because it's better"
❌ Premature optimization
❌ Skipping file locking for concurrent writes

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
- **MCP SDK:** `@modelcontextprotocol/sdk` (v1.0.4+)
- **Search:** `fuse.js` (fuzzy search, proven from v1)
- **YAML:** `yaml` package (for plan frontmatter)
- **Language:** TypeScript

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
- **`INSTALL.md`** - Slash commands installation

---

## Success Criteria

You're doing it right when:

✅ Every commit has tests
✅ Tests are written BEFORE implementation
✅ Data is readable in any text editor
✅ Code stays under 1000 lines total
✅ No features added without evidence
✅ Performance stays under target thresholds

---

## Remember

**Radical simplicity.** Evidence-based features. TDD mandatory. Trust Claude's intelligence.

Let markdown be your database. Keep Goldfish as transparent, dumb storage. ~150ms.

**For detailed patterns and debugging, see `CONTRIBUTING.md`.**
