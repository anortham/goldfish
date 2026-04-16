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
5. **Goldfish 5.x-6.x** - Claude Code plugin, project-local `.memories/`, cross-project registry, hybrid semantic recall, consolidation, skills & hooks
6. **Goldfish 7.0** - Subtract sprint: removed semantic stack, hooks, consolidation, and the plan tool in favor of Orama BM25 search and brief-first storage

**Core principle:** We only add complexity when we have EVIDENCE we need it.

---

## Architecture Overview

### Storage: Project-Local Markdown Files (No Database)

```
{project}/.memories/
  {date}/
    {HHMMSS}_{hash}.md    # Individual checkpoint files (YAML frontmatter)
  briefs/
    {brief-id}.md          # Individual briefs (YAML frontmatter)
  .active-brief            # Contains active brief ID

~/.goldfish/
  registry.json            # Cross-project registry (auto-populated)
```

**Checkpoint and brief markdown in `.memories/` is the source of truth.** No derived caches or model files; search runs over the markdown corpus on demand.

### Claude Code Plugin

Goldfish is a **Claude Code plugin** with:

- **`.claude-plugin/plugin.json`** - Plugin manifest (auto-discovery + MCP server registration)
- **`skills/`** - Claude Code skills (slash commands)

### Core Modules

| Module | Purpose | Test File |
|--------|---------|-----------|
| `src/workspace.ts` | Workspace normalization plus `.memories/` paths | `tests/workspace.test.ts` |
| `src/checkpoints.ts` | Checkpoint storage and brief affinity | `tests/checkpoints.test.ts` |
| `src/briefs.ts` | Brief storage and activation | `tests/briefs.test.ts` |
| `src/recall.ts` | Recall aggregation across date ranges and workspaces | `tests/recall.test.ts` |
| `src/ranking.ts` | Orama BM25 search ranking | `tests/ranking.test.ts` |
| `src/digests.ts` | Compact retrieval digests and compact search descriptions | `tests/digests.test.ts` |
| `src/registry.ts` | Cross-project registry | `tests/registry.test.ts` |
| `src/git.ts` | Git context capture | `tests/git.test.ts` |
| `src/lock.ts` | File locking utilities | `tests/lock.test.ts` |
| `src/file-io.ts` | Atomic write helpers | `tests/file-io.test.ts` |
| `src/logger.ts` | Structured logging | `tests/logger.test.ts` |
| `src/server.ts` | MCP server | `tests/server.test.ts` |
| `src/handlers/` | Tool handlers (checkpoint, recall, brief) | `tests/handlers.test.ts` |
| `src/tools.ts` | Tool definitions | - |
| `src/instructions.ts` | Server instructions | - |
| `src/types.ts` | Type definitions | - |
| `src/emoji.ts` | Fish emoji helper | - |
| `src/summary.ts` | Auto-summary generation | - |

### Key Types

```typescript
interface Checkpoint {
  id: string;             // checkpoint_{hash} unique identifier
  timestamp: string;      // ISO 8601 UTC (ALWAYS UTC!)
  description: string;    // Markdown body
  workspace?: string;     // Workspace label added in cross-workspace recall results
  tags?: string[];
  git?: GitContext;        // Nested git context
  summary?: string;       // Auto-generated concise summary
  briefId?: string;       // ID of active brief when checkpoint was created
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[];
  impact?: string;
  evidence?: string[];
  symbols?: string[];
  next?: string;
  confidence?: number;
  unknowns?: string[];
}

interface GitContext {
  branch?: string;
  commit?: string;
  files?: string[];
}

interface Brief {
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
  search?: string;        // BM25 search query (Orama)
  full?: boolean;         // Include full descriptions + git metadata (default: false)
  briefId?: string;       // Filter to checkpoints associated with this brief
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

Keep documentation honest: do not hardcode stale test counts or module line counts. Verify with `bun test` / `tsc --noEmit` when you need exact numbers.

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
- Always commit `.memories/` — checkpoints are source-controlled project artifacts, never leave them untracked

### DON'T

- Write code before tests (TDD violation)
- Add database (we're staying simple)
- Mix local dates with UTC (caused bugs in v1)
- Add "intelligence" to storage layer (Goldfish is dumb storage, Claude is smart)
- Add features without evidence from real usage
- Add aggressive frequency-pushing language back to tool descriptions (we tuned this down deliberately)

---

## Behavioral Language Pattern

MCP tool descriptions are **directive about quality, encouraging about frequency**.

- **Quality guidance stays strong**: checkpoint descriptions must be structured markdown with WHAT/WHY/HOW/IMPACT. Lazy descriptions are unacceptable.
- **Frequency guidance is positive**: "when in doubt, checkpoint" with concrete triggers (after committing, at stopping points). No "Do NOT" lists.
- **Recall is invoked manually**: agents call `recall()` at session start or when context is missing; users can also invoke `/recall` for targeted queries.
- **Briefs keep strong language**: brief persistence genuinely matters and the directive tone is warranted there.

Recalibrated twice (first overuse, then underuse) before landing here. The lesson: positive triggers drive adoption better than prohibitions.

### Character Limits (Claude Code MCP Cap)

Claude Code enforces a **2,000 character cap** on both server instructions (`getInstructions()`) and individual tool descriptions. Content beyond 2k is silently truncated. A test in `server.test.ts` enforces this.

- **Server instructions** carry behavioral framing (when/why to use tools). Detailed "how to use" guidance belongs in tool descriptions.
- **Tool descriptions** carry usage details, parameter tips, and examples for their specific tool.
- Don't duplicate content between instructions and tool descriptions. If instructions reference a tool's quality guidance, point to the tool description ("see the checkpoint tool description") rather than repeating it.

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
# Run all tests (final check only, ~8s)
bun test

# Watch mode (use during development)
bun test --watch

# Single test file
bun test tests/workspace.test.ts

# Single test by name pattern
bun test tests/workspace.test.ts -t "normalizes full path"

# Coverage
bun test --coverage
```

### Targeted Test Groups

Run the group matching your change instead of the full suite. Use the full suite as a final check.

| Group | Command | Covers |
|-------|---------|--------|
| Storage & utils | `bun test workspace lock git summary digests file-io logger` | Paths, file ops, utilities |
| Checkpoints | `bun test checkpoints` | Checkpoint CRUD, formatting, parsing |
| Briefs | `bun test briefs` | Brief CRUD, activation |
| Search & ranking | `bun test ranking search` | BM25 search via Orama |
| Recall | `bun test recall` | Aggregation, filtering, date windows |
| Handlers | `bun test handlers` | MCP tool handler responses |
| Server & registry | `bun test server registry` | Server startup, cross-project registry |

These work because bun matches filenames containing the given substring.

**Every feature MUST have tests. No exceptions.**

---

## Version Bumping

The version must be updated in three files (a test enforces they stay in sync):

1. `package.json` (`version` field)
2. `.claude-plugin/plugin.json` (`version` field)
3. `src/server.ts` (`SERVER_VERSION` constant)

---

## Tech Stack

- **Runtime:** Bun (for speed + built-in test runner)
- **MCP SDK:** `@modelcontextprotocol/sdk` (^1.26.0)
- **Search:** `@orama/orama` (BM25 ranking over checkpoint markdown)
- **YAML:** `yaml` package (for brief frontmatter)
- **Language:** TypeScript

---

## Documentation Structure

- **`README.md`** - User-facing documentation (humans using Goldfish)
- **`CONTRIBUTING.md`** - Detailed development guide (comprehensive patterns)
- **`docs/IMPLEMENTATION.md`** - Technical specification
- **`skills/`** - Claude Code plugin skills (slash commands)

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
