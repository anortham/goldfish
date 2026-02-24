# Plan-Checkpoint Affinity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically link checkpoints to the active plan and support filtering recalled checkpoints by plan ID.

**Architecture:** Add optional `planId` field to `Checkpoint` type and YAML frontmatter. During `saveCheckpoint()`, read the active plan and attach its ID. In `recall()`, support filtering by `planId`. All changes are backward-compatible — existing checkpoints without `planId` are unaffected.

**Tech Stack:** TypeScript, Bun test runner, YAML frontmatter

---

### Task 1: Add `planId` to Checkpoint type

**Files:**
- Modify: `src/types.ts` (Checkpoint and CheckpointInput interfaces)

**Step 1: Add `planId` to `Checkpoint` interface**

In `src/types.ts`, add after the `summary` field:

```typescript
planId?: string;       // ID of active plan when checkpoint was created
```

**Step 2: Run tests to verify nothing breaks**

Run: `bun test 2>&1 | tail -5`
Expected: All tests pass (type addition is backward-compatible)

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add planId field to Checkpoint type"
```

---

### Task 2: Serialize `planId` in checkpoint frontmatter

**Files:**
- Modify: `src/checkpoints.ts` (`formatCheckpoint` and `parseCheckpointFile`)
- Test: `tests/checkpoints.test.ts`

**Step 1: Write failing test for formatCheckpoint with planId**

Add to `tests/checkpoints.test.ts` in the `formatCheckpoint` describe block:

```typescript
test('includes planId in frontmatter when present', () => {
  const checkpoint: Checkpoint = {
    id: 'checkpoint_abc123',
    timestamp: '2026-01-15T10:30:00.000Z',
    description: 'Checkpoint with plan affinity',
    planId: 'my-feature-plan'
  };

  const formatted = formatCheckpoint(checkpoint);
  expect(formatted).toContain('planId: my-feature-plan');
});

test('omits planId from frontmatter when not present', () => {
  const checkpoint: Checkpoint = {
    id: 'checkpoint_abc123',
    timestamp: '2026-01-15T10:30:00.000Z',
    description: 'Checkpoint without plan'
  };

  const formatted = formatCheckpoint(checkpoint);
  expect(formatted).not.toContain('planId');
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/checkpoints.test.ts -t "includes planId" 2>&1 | tail -10`
Expected: FAIL — `planId` not yet serialized

**Step 3: Implement in `formatCheckpoint`**

In `src/checkpoints.ts`, in `formatCheckpoint()`, add after the `summary` block (before the `const yaml = stringifyYaml` line):

```typescript
if (checkpoint.planId) {
  frontmatter.planId = checkpoint.planId;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/checkpoints.test.ts -t "planId" 2>&1 | tail -10`
Expected: PASS

**Step 5: Write failing test for parseCheckpointFile with planId**

Add to `tests/checkpoints.test.ts` in the `parseCheckpointFile` describe block:

```typescript
test('parses planId from frontmatter', () => {
  const content = `---
id: checkpoint_abc123
timestamp: "2026-01-15T10:30:00.000Z"
planId: my-feature-plan
---

Checkpoint with plan affinity`;

  const checkpoint = parseCheckpointFile(content);
  expect(checkpoint.planId).toBe('my-feature-plan');
});

test('omits planId when not in frontmatter', () => {
  const content = `---
id: checkpoint_abc123
timestamp: "2026-01-15T10:30:00.000Z"
---

Checkpoint without plan`;

  const checkpoint = parseCheckpointFile(content);
  expect(checkpoint.planId).toBeUndefined();
});
```

**Step 6: Run test to verify it fails**

Run: `bun test tests/checkpoints.test.ts -t "parses planId" 2>&1 | tail -10`
Expected: FAIL — `planId` not yet parsed

**Step 7: Implement in `parseCheckpointFile`**

In `src/checkpoints.ts`, in `parseCheckpointFile()`, add after the `if (frontmatter.summary)` line:

```typescript
if (frontmatter.planId) checkpoint.planId = String(frontmatter.planId);
```

**Step 8: Run all checkpoint tests**

Run: `bun test tests/checkpoints.test.ts 2>&1 | tail -5`
Expected: All pass

**Step 9: Write roundtrip test**

Add to `tests/checkpoints.test.ts`:

```typescript
test('roundtrips planId through format/parse', () => {
  const original: Checkpoint = {
    id: 'checkpoint_abc123',
    timestamp: '2026-01-15T10:30:00.000Z',
    description: 'Roundtrip test',
    planId: 'my-plan-id'
  };

  const formatted = formatCheckpoint(original);
  const parsed = parseCheckpointFile(formatted);
  expect(parsed.planId).toBe('my-plan-id');
});
```

**Step 10: Run test to verify it passes**

Run: `bun test tests/checkpoints.test.ts -t "roundtrips planId" 2>&1 | tail -5`
Expected: PASS

**Step 11: Commit**

```bash
git add src/checkpoints.ts tests/checkpoints.test.ts
git commit -m "feat: serialize/deserialize planId in checkpoint frontmatter"
```

---

### Task 3: Auto-attach planId during saveCheckpoint

**Files:**
- Modify: `src/checkpoints.ts` (`saveCheckpoint`)
- Test: `tests/checkpoints.test.ts`

**Step 1: Write failing test for saveCheckpoint with active plan**

Add to `tests/checkpoints.test.ts`. This test needs to create an active plan first, then save a checkpoint and verify it picks up the plan ID. Use the existing `tempDir` setup:

```typescript
test('attaches planId when active plan exists', async () => {
  // Set up an active plan
  const { savePlan } = await import('../src/plans');
  await savePlan({
    title: 'Test Plan',
    content: 'Plan content',
    workspace: tempDir,
    activate: true
  });

  const checkpoint = await saveCheckpoint({
    description: 'Checkpoint during active plan',
    workspace: tempDir
  });

  expect(checkpoint.planId).toBe('test-plan');
});

test('omits planId when no active plan exists', async () => {
  const checkpoint = await saveCheckpoint({
    description: 'Checkpoint with no plan',
    workspace: tempDir
  });

  expect(checkpoint.planId).toBeUndefined();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/checkpoints.test.ts -t "attaches planId" 2>&1 | tail -10`
Expected: FAIL — `planId` is undefined

**Step 3: Implement in `saveCheckpoint`**

In `src/checkpoints.ts`:

1. Add import at top: `import { getActivePlan } from './plans.js';`
2. In `saveCheckpoint()`, after the `if (summary)` block and before the file path section, add:

```typescript
// Attach active plan ID if one exists
try {
  const activePlan = await getActivePlan(projectPath);
  if (activePlan) {
    checkpoint.planId = activePlan.id;
  }
} catch {
  // Silently ignore — plan affinity is best-effort
}
```

**Step 4: Run tests**

Run: `bun test tests/checkpoints.test.ts 2>&1 | tail -5`
Expected: All pass

**Step 5: Commit**

```bash
git add src/checkpoints.ts tests/checkpoints.test.ts
git commit -m "feat: auto-attach planId from active plan during checkpoint save"
```

---

### Task 4: Add planId filter to recall

**Files:**
- Modify: `src/types.ts` (RecallOptions)
- Modify: `src/recall.ts` (recallFromWorkspace)
- Test: `tests/recall.test.ts`

**Step 1: Add `planId` to `RecallOptions`**

In `src/types.ts`, add to `RecallOptions`:

```typescript
planId?: string;        // Filter to checkpoints associated with this plan
```

**Step 2: Write failing test for planId filtering**

Add to `tests/recall.test.ts`. This test should create checkpoints with and without planId, then recall with the filter. Add a new describe block:

```typescript
describe('planId filtering', () => {
  const PLAN_DIR = join(tmpdir(), `goldfish-test-plan-filter-${Date.now()}`);

  beforeAll(async () => {
    await mkdir(PLAN_DIR, { recursive: true });
    process.env.GOLDFISH_WORKSPACE = PLAN_DIR;
  });

  afterAll(async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    await rm(PLAN_DIR, { recursive: true, force: true });
  });

  test('filters checkpoints by planId', async () => {
    // Create checkpoints with different planIds by writing files directly
    const memoriesDir = join(PLAN_DIR, '.memories');
    const dateDir = join(memoriesDir, '2026-01-15');
    await mkdir(dateDir, { recursive: true });

    // Checkpoint with plan-a
    const cp1 = `---
id: checkpoint_aaa
timestamp: "2026-01-15T10:00:00.000Z"
planId: plan-a
---

Work on plan A`;

    // Checkpoint with plan-b
    const cp2 = `---
id: checkpoint_bbb
timestamp: "2026-01-15T11:00:00.000Z"
planId: plan-b
---

Work on plan B`;

    // Checkpoint with no plan
    const cp3 = `---
id: checkpoint_ccc
timestamp: "2026-01-15T12:00:00.000Z"
---

Work without a plan`;

    await writeFile(join(dateDir, '100000_aaa.md'), cp1);
    await writeFile(join(dateDir, '110000_bbb.md'), cp2);
    await writeFile(join(dateDir, '120000_ccc.md'), cp3);

    const result = await recall({
      workspace: PLAN_DIR,
      planId: 'plan-a',
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(1);
    expect(result.checkpoints[0].id).toBe('checkpoint_aaa');
  });

  test('returns all checkpoints when planId not specified', async () => {
    const result = await recall({
      workspace: PLAN_DIR,
      limit: 10,
      days: 365
    });

    expect(result.checkpoints).toHaveLength(3);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `bun test tests/recall.test.ts -t "filters checkpoints by planId" 2>&1 | tail -10`
Expected: FAIL — no filtering applied, returns all 3

**Step 4: Implement planId filter in `recallFromWorkspace`**

In `src/recall.ts`, in `recallFromWorkspace()`, add after the fuzzy search block (`if (options.search)`) and before the summary filtering block:

```typescript
// Filter by planId if specified
if (options.planId) {
  checkpoints = checkpoints.filter(cp => cp.planId === options.planId);
}
```

**Step 5: Run tests**

Run: `bun test tests/recall.test.ts 2>&1 | tail -5`
Expected: All pass

**Step 6: Commit**

```bash
git add src/types.ts src/recall.ts tests/recall.test.ts
git commit -m "feat: add planId filter to recall"
```

---

### Task 5: Expose planId in tool definitions and handler

**Files:**
- Modify: `src/tools.ts` (recall tool inputSchema)
- Modify: `src/instructions.ts` (if planId needs mention in instructions)

**Step 1: Add `planId` to recall tool schema**

In `src/tools.ts`, in the recall tool's `inputSchema.properties`, add:

```typescript
planId: {
  type: 'string',
  description: 'Filter to checkpoints created while a specific plan was active. Use to see progress on a particular plan.'
},
```

**Step 2: Update recall tool description**

In `src/tools.ts`, add to the "Key parameters" list in the recall tool description:

```
- planId: Filter checkpoints to those created under a specific plan
```

And add an example:

```
- recall({ planId: "auth-redesign" }) - checkpoints from a specific plan
```

**Step 3: Run all tests to verify nothing breaks**

Run: `bun test 2>&1 | tail -5`
Expected: All pass

**Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "feat: expose planId parameter in recall tool definition"
```

---

### Task 6: Update handler response to show planId

**Files:**
- Modify: `src/handlers/recall.ts` (formatCheckpoint helper)
- Test: `tests/handlers.test.ts`

**Step 1: Check how `formatCheckpoint` in recall handler works**

Read `src/handlers/recall.ts` to find the `formatCheckpoint` helper that formats individual checkpoints in recall output.

**Step 2: Write failing test**

Add to `tests/handlers.test.ts` in the recall handler describe block:

```typescript
test('shows planId in checkpoint output when present', async () => {
  // Save a plan and checkpoint
  const { savePlan } = await import('../src/plans');
  await savePlan({
    title: 'Handler Test Plan',
    content: 'Content',
    workspace: tempDir,
    activate: true
  });

  const { saveCheckpoint } = await import('../src/checkpoints');
  await saveCheckpoint({
    description: 'Checkpoint with plan',
    workspace: tempDir
  });

  const result = await handleRecall({
    workspace: tempDir,
    full: true,
    limit: 1
  });

  const text = result.content[0].text;
  expect(text).toContain('Plan: handler-test-plan');
});
```

**Step 3: Run test to verify it fails**

Run: `bun test tests/handlers.test.ts -t "shows planId" 2>&1 | tail -10`
Expected: FAIL

**Step 4: Implement planId display in recall handler's formatCheckpoint**

In `src/handlers/recall.ts`, in the `formatCheckpoint` helper function, add a line showing planId when present:

```typescript
if (checkpoint.planId) {
  lines.push(`Plan: ${checkpoint.planId}`);
}
```

**Step 5: Run all tests**

Run: `bun test 2>&1 | tail -5`
Expected: All pass

**Step 6: Also show planId in checkpoint handler response**

In `src/handlers/checkpoint.ts`, in `handleCheckpoint()`, add after the tags line:

```typescript
if (checkpoint.planId) {
  lines.push(`Plan: ${checkpoint.planId}`);
}
```

**Step 7: Run all tests one final time**

Run: `bun test 2>&1 | tail -5`
Expected: All pass

**Step 8: Commit**

```bash
git add src/handlers/recall.ts src/handlers/checkpoint.ts tests/handlers.test.ts
git commit -m "feat: display planId in checkpoint and recall handler output"
```

---

### Task 7: Update documentation

**Files:**
- Modify: `CLAUDE.md` (types section, add planId to Checkpoint)

**Step 1: Update Checkpoint type in CLAUDE.md**

Add `planId?: string;` to the Checkpoint interface shown in the Key Types section.

**Step 2: Update RecallOptions type in CLAUDE.md**

Add `planId?: string;` to the RecallOptions interface shown in the Key Types section.

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add planId to type documentation in CLAUDE.md"
```
