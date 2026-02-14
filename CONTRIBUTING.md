# Goldfish Development Guide

## MANDATORY: Test-Driven Development (TDD)

**THIS IS A TDD PROJECT. NO EXCEPTIONS.**

Every feature MUST be developed using TDD:
1. **Write test FIRST** (watch it fail)
2. **Implement** minimum code to pass
3. **Refactor** if needed
4. **Commit** test + implementation together

**DO NOT write production code without a failing test.**

If you find yourself writing implementation code before tests, STOP. Delete it and start over with the test.

---

## Core Philosophy

This is **iteration #4** of a developer memory system, now at **v5.0.0**. We've learned hard lessons:

### What We've Tried Before
1. **Original Goldfish (TS)**: JSON files, good concepts, critical bugs (race conditions, date handling)
2. **Tusk (Bun + SQLite)**: Fixed bugs, added features, became too complex, hook spam disaster
3. **.NET rewrite**: Over-engineered, never finished

### What We're Building Now
**Radical simplicity**: Markdown storage, fuse.js search, aggressive behavioral language. No database. ~2,094 lines of well-structured production code.

**Goldfish is a Claude Code plugin** with skills, hooks, and an MCP server.

**We only add complexity when we have EVIDENCE we need it.**

---

## Project Principles

### DO
- Write tests first (mandatory TDD)
- Keep data human-readable (markdown)
- Trust the agent's intelligence
- Use atomic file operations
- Keep timestamps in UTC
- Validate with real Claude Code sessions
- Read `docs/IMPLEMENTATION.md` for detailed specs

### DON'T
- Write code before tests (TDD violation)
- Add database (we're going simpler)
- Mix local dates with UTC (caused bugs in original)
- Add "intelligence" to storage layer (let Claude be smart)
- Add features without evidence of need
- Tone down behavioral language in MCP tool descriptions

---

## TDD Workflow

### Starting a New Feature

```bash
# 1. Write failing test
bun test tests/checkpoints.test.ts --watch

# 2. Implement minimum code to pass
# Edit src/checkpoints.ts

# 3. Watch test pass
# (Tests run automatically in watch mode)

# 4. Refactor if needed
# Keep tests green

# 5. Commit
git add tests/checkpoints.test.ts src/checkpoints.ts
git commit -m "Add checkpoint storage with atomic writes"
```

### Test Structure

```typescript
describe('Feature name', () => {
  // Setup/teardown
  beforeEach(async () => {
    // Clean test environment
  });

  afterEach(async () => {
    // Cleanup
  });

  it('does specific thing', async () => {
    // Arrange
    const input = createTestInput();

    // Act
    const result = await functionUnderTest(input);

    // Assert
    expect(result).toEqual(expectedOutput);
  });

  it('handles edge case', async () => {
    // Test edge cases explicitly
  });

  it('handles errors gracefully', async () => {
    // Test error conditions
  });
});
```

### Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/workspace.test.ts

# Run in watch mode (recommended during development)
bun test --watch

# Run with coverage
bun test --coverage
```

---

## Architecture Quick Reference

### Storage Structure
```
{project}/.memories/
  {date}/
    {HHMMSS}_{hash}.md    # Individual YAML frontmatter checkpoints
  plans/
    {plan-id}.md
  .active-plan

~/.goldfish/
  registry.json            # Cross-project registry
```

### Core Modules

| Module | Purpose | Test File |
|--------|---------|-----------|
| `src/workspace.ts` | Workspace detection/normalization | `tests/workspace.test.ts` |
| `src/checkpoints.ts` | Checkpoint storage/retrieval | `tests/checkpoints.test.ts` |
| `src/plans.ts` | Plan management | `tests/plans.test.ts` |
| `src/recall.ts` | Search and aggregation | `tests/recall.test.ts` |
| `src/registry.ts` | Cross-project registry | `tests/registry.test.ts` |
| `src/git.ts` | Git context capture | `tests/git.test.ts` |
| `src/lock.ts` | File locking utilities | `tests/lock.test.ts` |
| `src/summary.ts` | Auto-summary generation | `tests/summary.test.ts` |
| `src/emoji.ts` | Fish emoji helper | - |
| `src/server.ts` | MCP server | `tests/server.test.ts` |
| `src/handlers/` | Tool handlers (checkpoint, recall, plan) | various |
| `src/tools.ts` | Tool definitions | - |
| `src/instructions.ts` | Server behavioral instructions | - |
| `src/types.ts` | TypeScript interfaces | - |

### Key Types

```typescript
interface Checkpoint {
  id: string;
  timestamp: string;      // ISO 8601 UTC
  description: string;
  tags?: string[];
  git?: GitContext;        // Nested: { branch, commit, files }
  summary?: string;
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
  search?: string;        // Fuzzy search query
  since?: string;         // ISO 8601 UTC
  full?: boolean;         // Include full checkpoint bodies
}
```

---

## Common Patterns

### Atomic File Writes

**ALWAYS use write-then-rename pattern** (prevents corruption):

```typescript
import { writeFile, rename } from 'fs/promises';
import { join } from 'path';

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.tmp`;

  // Write to temp file
  await writeFile(tmpPath, content, 'utf-8');

  // Atomic rename
  await rename(tmpPath, filePath);
}
```

### Git Context Capture

```typescript
import { spawnSync } from 'bun';

function getGitContext(): GitContext {
  const branch = spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = spawnSync(['git', 'rev-parse', '--short', 'HEAD']);

  return {
    branch: branch.success ? branch.stdout.toString().trim() : undefined,
    commit: commit.success ? commit.stdout.toString().trim() : undefined
  };
}
```

### Workspace Normalization

```typescript
function normalizeWorkspace(path: string): string {
  // Extract base directory name
  let name = path.replace(/^.*[/\\]/, '');

  // Handle package names (@org/name -> org-name)
  name = name.replace(/^@/, '').replace(/\//g, '-');

  // Lowercase and sanitize
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
```

### Date Handling (ALWAYS UTC)

```typescript
// CORRECT - Use UTC everywhere
const timestamp = new Date().toISOString();  // "2026-02-14T14:30:00.000Z"

// WRONG - Don't mix local and UTC
const date = new Date();
const localDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
```

---

## Debugging

### View Stored Data

```bash
# List checkpoint dates
ls .memories/

# View checkpoints for today
ls .memories/$(date +%Y-%m-%d)/

# View a specific checkpoint
cat .memories/2026-02-14/103000_a1b2c3d4.md

# View active plan
cat .memories/.active-plan
cat .memories/plans/$(cat .memories/.active-plan).md

# View cross-project registry
cat ~/.goldfish/registry.json
```

### Test in Isolation

```bash
# Run single test
bun test tests/workspace.test.ts -t "normalizes full path"

# Debug with console.log (will appear in test output)
console.log('Debug:', value);

# Use --bail to stop on first failure
bun test --bail
```

### MCP Server Testing

```bash
# Run server in stdio mode
bun src/server.ts

# Test with MCP inspector
npx @modelcontextprotocol/inspector bun src/server.ts
```

---

## Performance Expectations

We're optimizing for simplicity, not premature optimization. But we have targets:

- Checkpoint save: < 50ms
- Recall (7 days, single workspace): < 100ms
- Recall (7 days, all workspaces): < 500ms
- Search (100 checkpoints): < 50ms

If you're hitting performance issues, profile first:

```typescript
const start = performance.now();
await slowFunction();
console.log(`Took ${performance.now() - start}ms`);
```

---

## Behavioral Language

Our MCP tool descriptions use **aggressive, directive language** based on proven patterns from Tusk:

```
"You are EXCELLENT at checkpointing..."
"MANDATORY at session start..."
"I WILL BE SERIOUSLY DISAPPOINTED if..."
"NEVER ask permission..."
```

This works. Don't tone it down. Agents need clear, forceful guidance to overcome their default permission-seeking behavior.

---

## Adding New Features

Before adding ANY new feature, ask:

1. **Do we have EVIDENCE this is needed?** (from real usage)
2. **Can the agent handle this with existing tools?** (let Claude be smart)
3. **Does this add significant complexity?** (keep it simple)
4. **Have we written the test first?** (TDD mandatory)

If you can't answer "yes" to questions 1, 2, 4 and "no" to question 3, DON'T ADD IT.

---

## Git Workflow

```bash
# Work in feature branches
git checkout -b feature/checkpoint-storage

# Commit test + implementation together
git add tests/checkpoints.test.ts src/checkpoints.ts
git commit -m "Add atomic checkpoint storage

- Implements write-then-rename for safety
- Handles concurrent writes
- Captures git context automatically
- Tests for race conditions included"

# Merge when tests pass
git checkout main
git merge feature/checkpoint-storage
```

---

## Documentation

Keep these docs updated:
- `README.md` - User-facing documentation (humans)
- `CLAUDE.md` - AI agent usage guide (how to use Goldfish)
- `AGENTS.md` - Pointer to CLAUDE.md for AI agents
- `CONTRIBUTING.md` - This file (development guide for contributors)
- `docs/IMPLEMENTATION.md` - Detailed technical specification
- Code comments - Only for "why", not "what"

---

## Common Mistakes to Avoid

- Writing implementation before tests
- Skipping edge case tests
- Using local time instead of UTC
- Direct file writes (use atomic pattern)
- Adding features without evidence
- Toning down behavioral language
- Adding database "because it's better"
- Premature optimization

---

## Success Criteria

You're doing it right when:

- Every PR has tests
- Tests are written before implementation
- Data is readable in any text editor
- Agents checkpoint proactively in real sessions
- Agents recall at session start without prompting
- Code is well-structured and maintainable
- No complexity for complexity's sake

---

## Getting Help

1. Read `docs/IMPLEMENTATION.md` for technical details
2. Look at test files for usage examples
3. Ask questions (but TDD is non-negotiable)

---

## Remember

**This is iteration #4, now at v5.0.0. We've made mistakes before.**

The difference this time: **radical simplicity** and **evidence-based feature development**.

Write tests first. Keep it simple. Trust the agent's intelligence. Let markdown be your database.

And for the love of all that is good: **FOLLOW TDD.**
