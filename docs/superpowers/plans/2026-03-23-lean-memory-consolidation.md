# Lean MEMORY.md Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten consolidation to produce a 15-25 line MEMORY.md carrying only decisions, rationale, open questions, deferred work, and gotchas, with a 30-day age window on input checkpoints.

**Architecture:** Two changes: (1) the handler filters checkpoints to the last 30 days before batching, (2) the consolidation prompt gets rewritten with the litmus test, keep/kill lists, and traffic light line budget.

**Tech Stack:** Bun, TypeScript, bun:test

**Spec:** `docs/superpowers/specs/2026-03-23-lean-memory-consolidation-design.md`

---

### Task 1: Add 30-day age filter to consolidation handler

**Files:**
- Modify: `src/handlers/consolidate.ts:32-52` (add age filter between unconsolidated filter and .md filter)
- Test: `tests/consolidate.test.ts`

- [ ] **Step 1: Write failing test for age filter**

Add to `tests/consolidate.test.ts` inside the `handleConsolidate` describe block:

```typescript
it('excludes checkpoints older than 30 days', async () => {
  // Create a checkpoint with a timestamp 45 days ago by writing the file directly
  const { writeFile, mkdir } = await import('fs/promises');
  const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const dateStr = oldDate.toISOString().split('T')[0];
  const dateDir = join(TEST_DIR, '.memories', dateStr);
  await mkdir(dateDir, { recursive: true });
  const oldCheckpointContent = [
    '---',
    `id: checkpoint_old001`,
    `timestamp: ${oldDate.toISOString()}`,
    'tags: [old]',
    '---',
    '## Old checkpoint',
    'This is from 45 days ago.'
  ].join('\n');
  await writeFile(join(dateDir, '120000_old1.md'), oldCheckpointContent);

  // Create a recent checkpoint normally
  await saveCheckpoint({ description: 'recent work', workspace: TEST_DIR });

  const result = await handleConsolidate({ workspace: TEST_DIR });
  const parsed = JSON.parse(result.content[0].text);

  expect(parsed.status).toBe('ready');
  expect(parsed.checkpointFiles.length).toBe(1);
  // The old checkpoint should not be in the batch
  for (const f of parsed.checkpointFiles) {
    expect(f).not.toContain(dateStr);
  }
});

it('returns current when all unconsolidated checkpoints are older than 30 days', async () => {
  const { writeFile, mkdir } = await import('fs/promises');
  const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const dateStr = oldDate.toISOString().split('T')[0];
  const dateDir = join(TEST_DIR, '.memories', dateStr);
  await mkdir(dateDir, { recursive: true });
  const oldCheckpointContent = [
    '---',
    `id: checkpoint_old002`,
    `timestamp: ${oldDate.toISOString()}`,
    'tags: [old]',
    '---',
    '## Ancient checkpoint',
    'Way too old to consolidate.'
  ].join('\n');
  await writeFile(join(dateDir, '120000_old2.md'), oldCheckpointContent);

  const result = await handleConsolidate({ workspace: TEST_DIR });
  const parsed = JSON.parse(result.content[0].text);

  expect(parsed.status).toBe('current');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/consolidate.test.ts -t "older than 30" 2>&1 | tail -20`
Expected: FAIL (no age filter exists yet, old checkpoints are included)

- [ ] **Step 3: Implement the 30-day filter**

In `src/handlers/consolidate.ts`, add a constant and filter step. After the existing unconsolidated filter and before the `.md` filter:

```typescript
const CONSOLIDATION_AGE_LIMIT_DAYS = 30;
```

Add between the unconsolidated sort and the `.md` filter:

```typescript
  // Filter to checkpoints within the age window
  const ageLimit = Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
  const recent = unconsolidated.filter(
    c => new Date(c.timestamp).getTime() >= ageLimit
  );

  // Exclude legacy .json files (subagent only understands .md format)
  const mdOnly = recent.filter(c => c.filePath?.endsWith('.md'));
```

Update the existing `mdOnly` line to filter from `recent` instead of `unconsolidated`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/consolidate.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/consolidate.ts tests/consolidate.test.ts
git commit -m "feat: add 30-day age filter to consolidation handler"
```

---

### Task 2: Rewrite consolidation prompt

**Files:**
- Modify: `src/consolidation-prompt.ts` (rewrite synthesis instructions, line budget, drop section template)
- Test: `tests/consolidate.test.ts`

- [ ] **Step 1: Write failing tests for new prompt content**

Add to `tests/consolidate.test.ts`:

```typescript
it('prompt contains litmus test and traffic light budget', async () => {
  await saveCheckpoint({ description: 'test checkpoint', workspace: TEST_DIR });

  const result = await handleConsolidate({ workspace: TEST_DIR });
  const parsed = JSON.parse(result.content[0].text);

  // Litmus test present
  expect(parsed.prompt).toContain('derive it from the codebase');

  // Traffic light budget present
  expect(parsed.prompt).toContain('25');
  expect(parsed.prompt).toContain('40');

  // Old bloat-inducing patterns gone
  expect(parsed.prompt).not.toContain('500 lines');
  expect(parsed.prompt).not.toContain('## Project Overview');
  expect(parsed.prompt).not.toContain('## Architecture');
  expect(parsed.prompt).not.toContain('## Current State');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/consolidate.test.ts -t "litmus test" 2>&1 | tail -20`
Expected: FAIL (old prompt still has 500-line cap and section template)

- [ ] **Step 3: Rewrite the consolidation prompt**

Replace the `## Synthesis Instructions` and line cap sections in `src/consolidation-prompt.ts` with the lean version. Keep the `## Inputs`, `## Output: Write Two Files`, and `## Constraints` sections structurally the same.

The new synthesis instructions should include:
- The litmus test: "If you can derive it from the codebase, git log, or tools, it doesn't belong."
- Explicit keep list: decisions + rationale, open questions, deferred work with context, gotchas
- Explicit kill list: architecture descriptions, module inventories, phase histories, feature lists, config details, state summaries
- Traffic light: green (<25 lines), yellow (25-40, don't add without removing), red (>40, must remove before adding)
- Age-out guidance: drop entries about work older than 30 days to make room for recent decisions
- No prescribed section headers

- [ ] **Step 4: Run all consolidate tests**

Run: `bun test tests/consolidate.test.ts 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `bun test 2>&1 | tail -10`
Expected: All tests PASS, no regressions

- [ ] **Step 6: Commit**

```bash
git add src/consolidation-prompt.ts tests/consolidate.test.ts
git commit -m "feat: rewrite consolidation prompt for lean MEMORY.md

Litmus test: if derivable from codebase/git/tools, it doesn't belong.
Traffic light budget: green <25, yellow 25-40, red >40 lines.
30-day age-out guidance. No prescribed section template."
```

---

### Task 3: Version bump and push

**Files:**
- Modify: `src/server.ts` (SERVER_VERSION)
- Modify: `package.json` (version)
- Modify: `.claude-plugin/plugin.json` (version)

- [ ] **Step 1: Bump version to 6.1.0**

This is a feature release (new behavior in consolidation). Update all three version locations from `6.0.3` to `6.1.0`.

- [ ] **Step 2: Run full test suite**

Run: `bun test 2>&1 | tail -10`
Expected: All tests PASS

- [ ] **Step 3: Commit and push**

```bash
git add src/server.ts package.json .claude-plugin/plugin.json
git commit -m "chore: bump version to 6.1.0 for lean consolidation"
git push
```
