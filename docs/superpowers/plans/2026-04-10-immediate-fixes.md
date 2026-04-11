# Immediate Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the reviewed "Do Now" work in `TODO.md`, then fix the highest-value trust and correctness gaps in Goldfish without expanding scope.

**Architecture:** Keep the current storage model and tool surface. Make narrow changes to docs/manifests, plan save defaults, shared file-write safety, checkpoint parsing, and recall input validation, with regression tests leading each behavior change.

**Tech Stack:** Bun, TypeScript, MCP server tooling, YAML frontmatter, markdown docs, file locks under `src/lock.ts`

**Spec:** `docs/superpowers/specs/2026-04-10-immediate-fixes-design.md`

---

## File Map

- Modify: `TODO.md`
  Responsibility: top-level live backlog, add `Immediate Fixes` section.
- Modify: `README.md`
  Responsibility: public version string and skill inventory.
- Modify: `.claude-plugin/marketplace.json`
  Responsibility: published plugin version metadata.
- Modify: `tests/server.test.ts`
  Responsibility: manifest and README drift regression coverage.
- Modify: `src/handlers/plan.ts`
  Responsibility: plan save handler default activation behavior.
- Modify: `src/plans.ts`
  Responsibility: storage-layer default activation behavior.
- Modify: `src/tools.ts`
  Responsibility: plan tool description and `activate` schema text.
- Modify: `src/instructions.ts`
  Responsibility: keep plan-save guidance aligned with runtime behavior.
- Create: `src/file-io.ts`
  Responsibility: shared atomic write helpers, plain and lock-backed.
- Modify: `src/registry.ts`
  Responsibility: use shared atomic write helper for registry updates.
- Modify: `src/memory.ts`
  Responsibility: use shared lock-backed atomic write helper for `memory.yaml` and consolidation state.
- Create: `tests/file-io.test.ts`
  Responsibility: regression coverage for shared atomic write helpers.
- Modify: `tests/registry.test.ts`
  Responsibility: registry write-path regression coverage.
- Modify: `tests/memory.test.ts`
  Responsibility: memory/consolidation write-path regression coverage.
- Modify: `src/checkpoints.ts`
  Responsibility: strict current-format checkpoint frontmatter validation.
- Modify: `tests/checkpoints.test.ts`
  Responsibility: malformed checkpoint regression coverage.
- Modify: `src/recall.ts`
  Responsibility: strict `from` / `to` parsing before date-range recall.
- Modify: `tests/recall.test.ts`
  Responsibility: invalid `from` / `to` regression coverage.
- Modify: `tests/handlers.test.ts`
  Responsibility: handler-level default-active plan coverage.
- Modify: `tests/plans.test.ts`
  Responsibility: storage-level default-active plan coverage.
- Modify: `tests/git.test.ts`
  Responsibility: unborn-`HEAD` regression coverage.

## Task 1: Record Immediate Fixes and Close Public Metadata Drift

**Files:**
- Modify: `TODO.md`
- Modify: `README.md`
- Modify: `.claude-plugin/marketplace.json`
- Test: `tests/server.test.ts`

- [ ] **Step 1: Write the failing metadata drift test**

Add a new test to `tests/server.test.ts` near the existing version-sync check:

```typescript
it('keeps marketplace metadata and README inventory aligned with the current release', async () => {
  const { SERVER_VERSION } = await import('../src/server');
  const { readdir } = await import('fs/promises');

  const marketplaceJson = JSON.parse(
    await Bun.file(new URL('../.claude-plugin/marketplace.json', import.meta.url)).text()
  ) as { plugins: Array<{ version: string }> };

  const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
  const skillDirs = (await readdir(new URL('../skills/', import.meta.url), { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  expect(marketplaceJson.plugins[0]!.version).toBe(SERVER_VERSION);
  expect(readme).toContain(`**Version ${SERVER_VERSION}**`);
  expect(readme).toContain(`${skillDirs.length} skills`);
  expect(readme).toContain('/consolidate');
});
```

- [ ] **Step 2: Run the targeted server test and watch it fail**

Run: `bun test tests/server.test.ts -t "marketplace metadata and README inventory aligned"`

Expected: FAIL because `marketplace.json` still says `5.3.0`, `README.md` still says `6.5.0`, and the README does not mention `/consolidate` in the skill inventory.

- [ ] **Step 3: Update `TODO.md`, `README.md`, and `marketplace.json`**

Apply these edits:

```md
# TODO.md
## Immediate Fixes
- [ ] Fix version and skill inventory drift across docs and manifests
- [ ] Align plan save behavior with activation guidance
- [ ] Make registry writes atomic
- [ ] Add locking around memory and consolidation state writes
- [ ] Tighten malformed checkpoint parsing
- [ ] Validate `from` and `to` inputs strictly
- [ ] Add regression coverage for the above, including unborn-`HEAD` git state
```

```md
# README.md
- change `**Version 6.5.0**` to `**Version 6.5.1**`
- change `five skills` to `6 skills`
- add `/consolidate` to the skill lists and plugin structure examples
```

```json
// .claude-plugin/marketplace.json
{
  "plugins": [
    {
      "version": "6.5.1"
    }
  ]
}
```

- [ ] **Step 4: Re-run the server test**

Run: `bun test tests/server.test.ts -t "marketplace metadata and README inventory aligned|keeps runtime and plugin versions in sync"`

Expected: PASS. The new drift test passes and the existing runtime/package/plugin sync test stays green.

- [ ] **Step 5: Commit the metadata and backlog update**

```bash
git add TODO.md README.md .claude-plugin/marketplace.json tests/server.test.ts
git commit -m "docs: add immediate fixes backlog and sync release metadata"
```

## Task 2: Make Saved Plans Active by Default

**Files:**
- Modify: `src/handlers/plan.ts`
- Modify: `src/plans.ts`
- Modify: `src/tools.ts`
- Modify: `src/instructions.ts`
- Test: `tests/handlers.test.ts`
- Test: `tests/plans.test.ts`

- [ ] **Step 1: Write failing tests for default-active saves**

Add one test to `tests/plans.test.ts`:

```typescript
it('auto-activates plan when activate is omitted', async () => {
  await savePlan({
    id: 'default-active',
    title: 'Default Active Plan',
    content: 'Content',
    workspace: TEST_DIR
  });

  const activePlan = await getActivePlan(TEST_DIR);
  expect(activePlan?.id).toBe('default-active');
});
```

Add one test to `tests/handlers.test.ts`:

```typescript
it('saves plan as active when activate is omitted', async () => {
  const result = await handlePlan({
    action: 'save',
    title: 'Implicit Active Plan',
    content: 'Plan content',
    workspace: TEST_DIR
  });

  expect(result.content[0]!.text).toContain('(active)');

  const recallResult = await handleRecall({ workspace: TEST_DIR });
  expect(recallResult.content[0]!.text).toContain('## Active Plan: Implicit Active Plan (active)');
});
```

- [ ] **Step 2: Run the targeted plan tests and watch them fail**

Run: `bun test tests/plans.test.ts tests/handlers.test.ts -t "activate is omitted|omitted"`

Expected: FAIL because plan saves without `activate` remain inactive.

- [ ] **Step 3: Change the default activation behavior in storage and handler code**

Update `src/plans.ts` and `src/handlers/plan.ts` with the same default:

```typescript
// src/plans.ts
const shouldActivate = input.activate ?? true;
if (shouldActivate) {
  await setActivePlan(projectPath, id);
}
```

```typescript
// src/handlers/plan.ts
const shouldActivate = activate ?? true;
const plan = await savePlan({
  title,
  content,
  workspace,
  activate: shouldActivate,
  ...(planId && { id: planId }),
  ...(tags && { tags })
});

const statusText = plan.status === 'active' && shouldActivate ? ' (active)' : '';
```

Then align the text in `src/tools.ts` and `src/instructions.ts`:

```typescript
// src/tools.ts input schema text
description: 'Activate plan after saving (default: true)'
```

- [ ] **Step 4: Re-run the targeted tests**

Run: `bun test tests/plans.test.ts tests/handlers.test.ts -t "activate is omitted|activate flag is false|one-liner confirmation"`

Expected: PASS. Default saves are active, explicit `activate: false` still stays inactive, and the handler response still renders correctly.

- [ ] **Step 5: Commit the plan activation fix**

```bash
git add src/handlers/plan.ts src/plans.ts src/tools.ts src/instructions.ts tests/handlers.test.ts tests/plans.test.ts
git commit -m "fix: activate saved plans by default"
```

## Task 3: Introduce Shared Atomic Write Helpers and Use Them for Registry and Memory

**Files:**
- Create: `src/file-io.ts`
- Modify: `src/registry.ts`
- Modify: `src/memory.ts`
- Create: `tests/file-io.test.ts`
- Modify: `tests/registry.test.ts`
- Modify: `tests/memory.test.ts`

- [ ] **Step 1: Write failing tests for the shared write helpers**

Create `tests/file-io.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteFile, atomicWriteLocked } from '../src/file-io';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'goldfish-file-io-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('atomicWriteFile', () => {
  it('writes content without leaving temp files behind', async () => {
    const filePath = join(tempDir, 'sample.json');
    await atomicWriteFile(filePath, '{"ok":true}\n');

    expect(await readFile(filePath, 'utf-8')).toBe('{"ok":true}\n');
    expect((await readdir(tempDir)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });
});

describe('atomicWriteLocked', () => {
  it('serializes overlapping writes to the same file', async () => {
    const filePath = join(tempDir, 'locked.json');
    await Promise.all([
      atomicWriteLocked(filePath, '{"value":"first"}\n'),
      atomicWriteLocked(filePath, '{"value":"second"}\n')
    ]);

    const finalContent = await readFile(filePath, 'utf-8');
    expect(['{"value":"first"}\n', '{"value":"second"}\n']).toContain(finalContent);
    expect((await readdir(tempDir)).filter(name => name.includes('.tmp.'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new helper tests and watch them fail**

Run: `bun test tests/file-io.test.ts`

Expected: FAIL because `src/file-io.ts` does not exist yet.

- [ ] **Step 3: Implement the shared helper module**

Create `src/file-io.ts`:

```typescript
import { dirname } from 'path';
import { mkdir, rename, unlink, writeFile } from 'fs/promises';
import { withLock } from './lock';

export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tempPath, content, 'utf-8');

  try {
    await rename(tempPath, filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8');
      try { await unlink(tempPath); } catch {}
      return;
    }
    throw error;
  }
}

export async function atomicWriteLocked(filePath: string, content: string): Promise<void> {
  await withLock(filePath, async () => {
    await atomicWriteFile(filePath, content);
  });
}
```

- [ ] **Step 4: Switch registry and memory writes to the new helpers**

Update the call sites:

```typescript
// src/registry.ts
import { atomicWriteFile } from './file-io';

await atomicWriteFile(filePath, JSON.stringify(registry, null, 2));
```

```typescript
// src/memory.ts
import { atomicWriteLocked } from './file-io';

await atomicWriteLocked(filePath, content);
```

Use `atomicWriteLocked` for both `writeMemory()` and `writeConsolidationState()`.

- [ ] **Step 5: Add narrow regression checks to registry and memory tests**

Add one registry test:

```typescript
it('leaves no temp files behind after register and unregister', async () => {
  const projectPath = join(TEST_DIR, 'temp-cleanup-project');
  await mkdir(projectPath, { recursive: true });

  await registerProject(projectPath, GOLDFISH_DIR);
  await unregisterProject(projectPath, GOLDFISH_DIR);

  const files = await readdir(GOLDFISH_DIR);
  expect(files.filter(name => name.includes('.tmp.'))).toEqual([]);
});
```

Add one memory test:

```typescript
it('leaves no lock or temp files behind after writing memory and consolidation state', async () => {
  await writeMemory(tempDir, 'decisions:\n  - Locked write\n');
  await writeConsolidationState(tempDir, {
    timestamp: '2026-04-10T12:00:00.000Z',
    checkpointsConsolidated: 4
  });

  const memoryFiles = await readdir(join(tempDir, '.memories'));
  const stateFiles = await readdir(join(tempGoldfishHome, 'consolidation-state'));
  expect(memoryFiles.filter(name => name.includes('.tmp.') || name.endsWith('.lock'))).toEqual([]);
  expect(stateFiles.filter(name => name.includes('.tmp.') || name.endsWith('.lock'))).toEqual([]);
});
```

- [ ] **Step 6: Run the focused write-path tests**

Run: `bun test tests/file-io.test.ts tests/registry.test.ts tests/memory.test.ts`

Expected: PASS. The new helper tests pass and existing registry/memory coverage stays green.

- [ ] **Step 7: Commit the file-write hardening**

```bash
git add src/file-io.ts src/registry.ts src/memory.ts tests/file-io.test.ts tests/registry.test.ts tests/memory.test.ts
git commit -m "fix: harden shared file writes"
```

## Task 4: Reject Malformed Checkpoints and Invalid Date Inputs

**Files:**
- Modify: `src/checkpoints.ts`
- Modify: `src/recall.ts`
- Modify: `tests/checkpoints.test.ts`
- Modify: `tests/recall.test.ts`

- [ ] **Step 1: Replace permissive checkpoint tests with strict validation tests**

In `tests/checkpoints.test.ts`, replace the current null-timestamp acceptance test with strict validation cases:

```typescript
it('throws when checkpoint frontmatter is missing id', () => {
  const content = `---
timestamp: "2026-02-14T10:00:00.000Z"
---

Missing id.`;

  expect(() => parseCheckpointFile(content)).toThrow(/missing id/i);
});

it('throws when checkpoint frontmatter is missing timestamp', () => {
  const content = `---
id: checkpoint_missingts
---

Missing timestamp.`;

  expect(() => parseCheckpointFile(content)).toThrow(/missing timestamp/i);
});

it('throws when checkpoint timestamp is invalid', () => {
  const content = `---
id: checkpoint_badts
timestamp: "not-a-date"
---

Bad timestamp.`;

  expect(() => parseCheckpointFile(content)).toThrow(/invalid timestamp/i);
});
```

In `tests/recall.test.ts`, add:

```typescript
it('throws for invalid from date', async () => {
  await expect(recall({ workspace: TEST_DIR_A, from: 'garbage-date' })).rejects.toThrow(/Invalid from format/);
});

it('throws for invalid to date', async () => {
  await expect(recall({ workspace: TEST_DIR_A, to: '2026-99-99' })).rejects.toThrow(/Invalid to format/);
});
```

- [ ] **Step 2: Run the targeted parsing tests and watch them fail**

Run: `bun test tests/checkpoints.test.ts tests/recall.test.ts -t "missing id|missing timestamp|invalid timestamp|invalid from|invalid to"`

Expected: FAIL because checkpoint parsing still invents missing metadata and recall still accepts bad `from` / `to` values.

- [ ] **Step 3: Tighten `src/checkpoints.ts` frontmatter validation**

Add explicit validators and use them inside `parseCheckpointFile()`:

```typescript
function parseCheckpointId(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Invalid checkpoint file: missing id');
  }
  return raw;
}

function parseCheckpointTimestamp(raw: unknown): string {
  if (typeof raw === 'number') {
    const ms = raw > 1e10 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Invalid checkpoint file: missing timestamp');
  }

  if (Number.isNaN(new Date(raw).getTime())) {
    throw new Error('Invalid checkpoint file: invalid timestamp');
  }

  return raw;
}
```

Then replace:

```typescript
id: String(frontmatter.id),
timestamp: normalizeTimestamp(frontmatter.timestamp),
```

with:

```typescript
id: parseCheckpointId(frontmatter.id),
timestamp: parseCheckpointTimestamp(frontmatter.timestamp),
```

- [ ] **Step 4: Tighten `src/recall.ts` date parsing before range calculation**

Add a shared parser near `parseSince()`:

```typescript
function parseDateInput(value: string, field: 'from' | 'to'): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} format: ${value}`);
  }
  return date;
}
```

Use it in `getDateRange()`:

```typescript
if (options.from && options.to) {
  parseDateInput(options.from, 'from');
  parseDateInput(options.to, 'to');
  return { from: options.from, to: options.to };
}

if (options.from) {
  parseDateInput(options.from, 'from');
  return { from: options.from, to: now.toISOString() };
}

if (options.to) {
  const toDate = parseDateInput(options.to, 'to');
  const weekBefore = new Date(toDate.getTime() - 7 * 86400000);
  return { from: weekBefore.toISOString(), to: options.to };
}
```

- [ ] **Step 5: Re-run the focused parsing tests**

Run: `bun test tests/checkpoints.test.ts tests/recall.test.ts -t "missing id|missing timestamp|invalid timestamp|invalid from|invalid to|Date range filtering"`

Expected: PASS. The new strict-validation tests pass and the existing valid date-range tests stay green.

- [ ] **Step 6: Commit the parsing hardening**

```bash
git add src/checkpoints.ts src/recall.ts tests/checkpoints.test.ts tests/recall.test.ts
git commit -m "fix: validate checkpoint and recall date inputs"
```

## Task 5: Add Unborn-`HEAD` Regression Coverage

**Files:**
- Modify: `tests/git.test.ts`
- Modify if needed: `src/git.ts`

- [ ] **Step 1: Write the unborn-`HEAD` regression test**

Add to `tests/git.test.ts`:

```typescript
it('handles a repo before the first commit', async () => {
  originalCwd = process.cwd();
  repoDir = await mkdtemp(join(tmpdir(), 'git-unborn-'));
  process.chdir(repoDir);

  await Bun.spawn(['git', 'init'], {
    stdout: 'ignore',
    stderr: 'ignore'
  }).exited;

  await writeFile('untracked.txt', 'hello');

  const context = getGitContext();
  expect(context.files).toContain('untracked.txt');
});
```

- [ ] **Step 2: Run the targeted git test**

Run: `bun test tests/git.test.ts -t "before the first commit"`

Expected: PASS. Current exploratory check showed `git diff --name-only HEAD` errors, but `git ls-files --others --exclude-standard` still reports the untracked file, so the current implementation should survive the unborn-`HEAD` case.

- [ ] **Step 3: Only patch `src/git.ts` if the new test fails**

If it fails, keep the fix narrow:

```typescript
const filesResult = spawnSync(['git', 'diff', '--name-only', 'HEAD'], spawnOpts);
if (!filesResult.success) {
  const stagedFallback = spawnSync(['git', 'diff', '--name-only', '--cached'], spawnOpts);
  if (stagedFallback.success) {
    for (const file of stagedFallback.stdout.toString().trim().split('\n')) {
      if (file) filesSet.add(file);
    }
  }
}
```

Do not change `src/git.ts` if the test already passes.

- [ ] **Step 4: Re-run the full git test file**

Run: `bun test tests/git.test.ts`

Expected: PASS. The unborn-`HEAD` case is covered and existing git-context behavior remains intact.

- [ ] **Step 5: Commit the regression coverage**

```bash
git add tests/git.test.ts src/git.ts
git commit -m "test: cover git context before first commit"
```

## Task 6: Final Verification

**Files:**
- Verify: `tests/server.test.ts`
- Verify: `tests/handlers.test.ts`
- Verify: `tests/plans.test.ts`
- Verify: `tests/file-io.test.ts`
- Verify: `tests/registry.test.ts`
- Verify: `tests/memory.test.ts`
- Verify: `tests/checkpoints.test.ts`
- Verify: `tests/recall.test.ts`
- Verify: `tests/git.test.ts`

- [ ] **Step 1: Run the targeted slices once more**

Run: `bun test tests/server.test.ts tests/handlers.test.ts tests/plans.test.ts tests/file-io.test.ts tests/registry.test.ts tests/memory.test.ts tests/checkpoints.test.ts tests/recall.test.ts tests/git.test.ts`

Expected: PASS for the touched areas.

- [ ] **Step 2: Run the full suite**

Run: `bun test`

Expected: PASS with zero failures across the full project.

- [ ] **Step 3: Update `TODO.md` progress if any items are complete during execution**

Mark completed items as checked only after the corresponding code and tests are green.

- [ ] **Step 4: Create a checkpoint before any final commit or PR step**

Use the Goldfish checkpoint tool with a structured WHAT / WHY / HOW / IMPACT summary of the stabilization pass.
