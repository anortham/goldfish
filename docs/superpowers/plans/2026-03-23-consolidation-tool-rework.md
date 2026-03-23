# Consolidation Tool Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the consolidate tool to return metadata and file paths only, eliminating the 100K+ char checkpoint content from MCP responses. The subagent reads files directly from disk.

**Architecture:** The consolidate handler filters unconsolidated checkpoints (oldest-first) and returns their file paths, MEMORY.md path, plan path, and a prompt template. The subagent reads checkpoint files from disk using the Read tool. No file content passes through MCP.

**Tech Stack:** Bun, TypeScript, MCP SDK

**Spec:** `docs/superpowers/specs/2026-03-23-consolidation-tool-rework-design.md`

---

## File Map

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Update `ConsolidationPayload` (remove content fields, add path fields). Add `filePath` to `Checkpoint`. |
| `src/checkpoints.ts` | Populate `filePath` on checkpoints in `getCheckpointsForDay()`. |
| `src/consolidation-prompt.ts` | New signature with file paths. Prompt tells subagent to read from disk. |
| `src/handlers/consolidate.ts` | Return paths instead of content. Oldest-first batching. `remainingCount`. |
| `src/tools.ts` | Update consolidate tool description. |
| `skills/consolidate/SKILL.md` | Add `remainingCount` handling, `/consolidate all` loop. |
| `tests/consolidate.test.ts` | Rewrite tests for new response shape. |
| `tests/checkpoints.test.ts` | Add `filePath` population test. |

---

## Task 1: Add `filePath` to Checkpoint Type and Pipeline

**Files:**
- Modify: `src/types.ts:5-24`
- Modify: `src/checkpoints.ts:424-471`
- Test: `tests/checkpoints.test.ts`

- [ ] **Step 1: Write failing test for filePath population**

Add to `tests/checkpoints.test.ts` in the `getCheckpointsForDay` describe block:

```typescript
it('populates filePath on each checkpoint', async () => {
  await saveCheckpoint({ description: 'test checkpoint', workspace: TEST_DIR });
  const today = new Date().toISOString().split('T')[0];
  const checkpoints = await getCheckpointsForDay(TEST_DIR, today);
  expect(checkpoints.length).toBeGreaterThan(0);
  for (const cp of checkpoints) {
    expect(cp.filePath).toBeDefined();
    expect(cp.filePath).toContain(today);
    expect(cp.filePath!.endsWith('.md')).toBe(true);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/checkpoints.test.ts -t "populates filePath" 2>&1 | tail -10`
Expected: FAIL (filePath is undefined)

- [ ] **Step 3: Add `filePath` to `Checkpoint` interface**

In `src/types.ts`, add after line 23 (`planId?: string;`):

```typescript
  filePath?: string;        // Absolute path to checkpoint file on disk
```

- [ ] **Step 4: Populate `filePath` in `getCheckpointsForDay`**

In `src/checkpoints.ts`, update the `.md` file loop (lines 445-453):

```typescript
  for (const file of mdFiles) {
    try {
      const filePath = join(dateDir, file);
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseCheckpointFile(content);
      checkpoint.filePath = filePath;
      checkpoints.push(checkpoint);
    } catch {
      continue;
    }
  }
```

And the `.json` file loop (lines 457-464):

```typescript
  for (const file of jsonFiles) {
    try {
      const filePath = join(dateDir, file);
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseJsonCheckpoint(content);
      checkpoint.filePath = filePath;
      checkpoints.push(checkpoint);
    } catch {
      continue;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/checkpoints.test.ts -t "populates filePath" 2>&1 | tail -10`
Expected: PASS

- [ ] **Step 6: Run full test suite for regressions**

Run: `bun test 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/checkpoints.ts tests/checkpoints.test.ts
git commit -m "feat: populate filePath on Checkpoint objects in loading pipeline"
```

---

## Task 2: Update ConsolidationPayload Type

**Files:**
- Modify: `src/types.ts:154-163`

- [ ] **Step 1: Replace `ConsolidationPayload` interface**

In `src/types.ts`, replace lines 154-163:

```typescript
export interface ConsolidationPayload {
  status: 'ready' | 'current';
  message?: string;                    // Only when status === 'current'
  checkpointFiles?: string[];          // Absolute paths, chronological (oldest-first), capped at 50
  memoryPath?: string;                 // Absolute path to .memories/MEMORY.md
  lastConsolidatedPath?: string;       // Absolute path to .memories/.last-consolidated
  activePlanPath?: string;             // Absolute path to active plan file, if one exists
  checkpointCount?: number;            // Number of checkpoints in this batch
  remainingCount?: number;             // Unconsolidated checkpoints beyond this batch
  previousTotal?: number;              // Running total for incrementing checkpointsConsolidated
  prompt?: string;                     // Subagent instructions (includes file paths)
}
```

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in `consolidate.ts` (references removed fields). This is expected; we fix it in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: update ConsolidationPayload to metadata-only (paths, no content)"
```

---

## Task 3: Rework Consolidation Prompt Template

**Files:**
- Modify: `src/consolidation-prompt.ts`

- [ ] **Step 1: Rewrite `buildConsolidationPrompt`**

Replace the entire contents of `src/consolidation-prompt.ts`:

```typescript
/**
 * Build the subagent prompt for memory consolidation.
 *
 * The prompt tells the subagent to read checkpoint files from disk
 * rather than receiving content inline.
 */

/**
 * @param memoryPath - Absolute path to MEMORY.md (may not exist yet)
 * @param lastConsolidatedPath - Absolute path to .last-consolidated
 * @param checkpointFiles - Absolute paths to checkpoint files, oldest-first
 * @param activePlanPath - Absolute path to active plan, or undefined
 * @param checkpointCount - Number of checkpoint files in this batch
 * @param previousTotal - Running total of checkpoints consolidated before this batch
 */
export function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointFiles: string[],
  activePlanPath: string | undefined,
  checkpointCount: number,
  previousTotal: number
): string {
  const newTotal = previousTotal + checkpointCount;

  const fileList = checkpointFiles
    .map((f, i) => `   ${i + 1}. \`${f}\``)
    .join('\n');

  const planSection = activePlanPath
    ? `\`${activePlanPath}\`\n   - Use it to understand project direction. Do not modify it.`
    : 'No active plan.';

  return `You are a memory consolidation subagent. Your job is to synthesize developer checkpoints into a durable, well-structured MEMORY.md.

## Inputs

Read the following files using the Read tool:

1. **Current MEMORY.md** (baseline): \`${memoryPath}\`
   - If the file does not exist, this is the first consolidation. Start from scratch.

2. **Checkpoint files** (read in this exact order, oldest first):
${fileList}
   - Each file has YAML frontmatter (between \`---\` markers) with metadata fields, followed by a markdown body (the checkpoint description).
   - Extract durable facts from the markdown body. The frontmatter contains timestamp, tags, type, and optional structured fields (decision, context, impact, symbols, next).

3. **Active plan** (optional context): ${planSection}

## Synthesis Instructions

1. **Use currentMemory as baseline.** Start from the existing MEMORY.md structure and content. Do not discard what is already there unless it is contradicted or obsoleted by newer checkpoints.

2. **Read each unconsolidated checkpoint.** Extract durable facts, decisions, discoveries, architectural choices, and current state. Process them in chronological order (oldest first).

3. **Use the active plan for context.** If provided, let the plan inform which areas are in active flux and which sections deserve more detail.

4. **Synthesize, do not append.** Do not dump checkpoints verbatim. Extract what matters and integrate it into the appropriate sections.

5. **Overwrite contradictions.** New facts replace old ones. If a checkpoint says "we switched from X to Y", update the relevant section to reflect Y and remove stale mentions of X.

6. **Prune ephemeral details.** Keep: decisions, architecture, key discoveries, current state, active concerns, open questions. Drop: debugging steps, false starts, commands run, transient errors resolved.

7. **Preserve document voice.** Write in clear prose. Avoid bullet soup; use bullets only when items are genuinely list-like. Keep sections cohesive and readable.

8. **Hard cap: 500 lines.** If the document would exceed 500 lines, compress old or resolved sections. Summarize instead of listing. Archive resolved concerns.

9. **Use ## headers for sections.** Standard sections include (use what's relevant, add others as needed):
   - \`## Project Overview\`
   - \`## Architecture\`
   - \`## Key Decisions\`
   - \`## Current State\`
   - \`## Active Concerns\`
   - \`## Open Questions\`

   Do NOT include a title line or frontmatter. The document starts directly with a \`##\` header.

## Output: Write Two Files

**File 1:** Write the updated MEMORY.md to:
\`${memoryPath}\`

- No frontmatter, no title. Pure markdown starting with a \`##\` header.
- Must not exceed 500 lines.

**File 2:** Write the consolidation state JSON to:
\`${lastConsolidatedPath}\`

Content must be exactly:
\`\`\`json
{ "timestamp": "<UTC ISO timestamp of now>", "checkpointsConsolidated": ${newTotal} }
\`\`\`

Replace \`<UTC ISO timestamp of now>\` with the actual current UTC time in ISO 8601 format (e.g. \`2026-03-23T15:04:05.000Z\`).

## Constraints

- Do NOT modify or delete any checkpoint files.
- Do NOT touch plan files.
- Do NOT create any files other than the two listed above.
- If you are uncertain about a fact from the checkpoints, omit it rather than guess.`;
}
```

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in `consolidate.ts` (old call signature). Expected; we fix it in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/consolidation-prompt.ts
git commit -m "feat: rework consolidation prompt to read files from disk"
```

---

## Task 4: Rework Consolidate Handler

**Files:**
- Modify: `src/handlers/consolidate.ts`
- Test: `tests/consolidate.test.ts`

- [ ] **Step 1: Write failing tests for new response shape**

Replace the entire contents of `tests/consolidate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { ensureMemoriesDir, getPlansDir } from '../src/workspace';
import { savePlan, setActivePlan, updatePlan } from '../src/plans';
import { handleConsolidate } from '../src/handlers/consolidate';

let TEST_DIR: string;
let restoreDeps: (() => void) | undefined;

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'goldfish-consolidate-'));
  await ensureMemoriesDir(TEST_DIR);
  restoreDeps = __setCheckpointDependenciesForTests({
    queueSemanticRecord: async () => {}
  });
});

afterEach(async () => {
  restoreDeps?.();
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('handleConsolidate', () => {
  it('returns "current" when no unconsolidated checkpoints exist', async () => {
    await saveCheckpoint({ description: 'old checkpoint', workspace: TEST_DIR });

    const futureTimestamp = new Date(Date.now() + 60_000).toISOString();
    await writeConsolidationState(TEST_DIR, {
      timestamp: futureTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('current');
    expect(parsed.message).toBeTruthy();
    expect(parsed.checkpointFiles).toBeUndefined();
  });

  it('returns file paths instead of checkpoint content', async () => {
    await saveCheckpoint({ description: 'first checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(Array.isArray(parsed.checkpointFiles)).toBe(true);
    expect(parsed.checkpointFiles.length).toBe(1);
    expect(parsed.checkpointFiles[0]).toContain('.memories/');
    expect(parsed.checkpointFiles[0]).toEndWith('.md');

    // Content fields must NOT be present
    expect(parsed.unconsolidatedCheckpoints).toBeUndefined();
    expect(parsed.currentMemory).toBeUndefined();
    expect(parsed.activePlan).toBeUndefined();
  });

  it('returns memoryPath and lastConsolidatedPath', async () => {
    await saveCheckpoint({ description: 'a checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.memoryPath).toBe(join(TEST_DIR, '.memories', 'MEMORY.md'));
    expect(parsed.lastConsolidatedPath).toBe(join(TEST_DIR, '.memories', '.last-consolidated'));
  });

  it('returns checkpointFiles in chronological (oldest-first) order', async () => {
    await saveCheckpoint({ description: 'first', workspace: TEST_DIR });
    // Sleep past second boundary so filenames differ in HHMMSS portion
    await new Promise(resolve => setTimeout(resolve, 1100));
    await saveCheckpoint({ description: 'second', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.checkpointFiles.length).toBe(2);
    // Read both files and verify timestamps are in order
    const { readFile } = await import('fs/promises');
    const content1 = await readFile(parsed.checkpointFiles[0], 'utf-8');
    const content2 = await readFile(parsed.checkpointFiles[1], 'utf-8');
    const ts1 = content1.match(/timestamp: (.+)/)?.[1] ?? '';
    const ts2 = content2.match(/timestamp: (.+)/)?.[1] ?? '';
    expect(new Date(ts1).getTime()).toBeLessThan(new Date(ts2).getTime());
  });

  it('only includes checkpoints after last consolidation timestamp', async () => {
    await saveCheckpoint({ description: 'old checkpoint', workspace: TEST_DIR });

    await new Promise(resolve => setTimeout(resolve, 5));
    const consolidationTimestamp = new Date().toISOString();

    await new Promise(resolve => setTimeout(resolve, 5));
    await saveCheckpoint({ description: 'new checkpoint', workspace: TEST_DIR });

    await writeConsolidationState(TEST_DIR, {
      timestamp: consolidationTimestamp,
      checkpointsConsolidated: 1
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.status).toBe('ready');
    expect(parsed.checkpointFiles.length).toBe(1);
    expect(parsed.previousTotal).toBe(1);
  });

  it('returns remainingCount of 0 when all fit in batch', async () => {
    await saveCheckpoint({ description: 'only one', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.remainingCount).toBe(0);
  });

  it('includes prompt with file paths embedded', async () => {
    await saveCheckpoint({ description: 'test', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.prompt).toContain('Read the following files');
    expect(parsed.prompt).toContain('.memories/');
    expect(parsed.prompt).toContain('MEMORY.md');
  });

  it('excludes legacy .json checkpoint files from checkpointFiles', async () => {
    // Save a normal .md checkpoint
    await saveCheckpoint({ description: 'md checkpoint', workspace: TEST_DIR });

    // Manually create a legacy .json file in the same date directory
    const today = new Date().toISOString().split('T')[0];
    const dateDir = join(TEST_DIR, '.memories', today);
    const { writeFile } = await import('fs/promises');
    await writeFile(
      join(dateDir, '120000_legacy.json'),
      JSON.stringify({ id: 'legacy_001', timestamp: new Date().toISOString(), description: 'legacy' })
    );

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    // Should only have the .md file
    for (const f of parsed.checkpointFiles) {
      expect(f).toEndWith('.md');
    }
  });

  it('returns activePlanPath when an active plan exists', async () => {
    await saveCheckpoint({ description: 'work done', workspace: TEST_DIR });
    await savePlan({
      title: 'Test Plan',
      content: '# Plan\n\nDo things.',
      workspace: TEST_DIR,
      activate: true
    });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.activePlanPath).toBeDefined();
    expect(parsed.activePlanPath).toContain('.memories/plans/');
    expect(parsed.activePlanPath).toEndWith('.md');
  });

  it('omits activePlanPath when plan is completed', async () => {
    await saveCheckpoint({ description: 'work done', workspace: TEST_DIR });
    const plan = await savePlan({
      title: 'Done Plan',
      content: '# Plan\n\nAll done.',
      workspace: TEST_DIR,
      activate: true
    });
    await updatePlan(TEST_DIR, plan.id, { status: 'completed' });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.activePlanPath).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/consolidate.test.ts 2>&1 | tail -20`
Expected: FAIL (handler still returns old shape)

- [ ] **Step 3: Rewrite the consolidate handler**

Replace the entire contents of `src/handlers/consolidate.ts`:

```typescript
/**
 * Consolidate tool handler
 *
 * Returns metadata (file paths, counts, prompt) for a consolidation subagent.
 * No checkpoint content passes through the MCP response.
 */

import { join } from 'path';
import { readConsolidationState } from '../memory.js';
import { getAllCheckpoints } from '../checkpoints.js';
import { getActivePlan } from '../plans.js';
import { buildConsolidationPrompt } from '../consolidation-prompt.js';
import { getMemoriesDir, getPlansDir, resolveWorkspace } from '../workspace.js';
import type { ConsolidationPayload } from '../types.js';

const CONSOLIDATION_BATCH_CAP = 50;

/**
 * Handle the consolidate tool call.
 * Returns a metadata-only JSON payload (file paths + prompt) that a subagent
 * uses to read checkpoint files from disk and update MEMORY.md.
 */
export async function handleConsolidate(args: any) {
  const workspace = resolveWorkspace(args?.workspace);

  const [consolidationState, activePlan, allCheckpoints] = await Promise.all([
    readConsolidationState(workspace),
    getActivePlan(workspace),
    getAllCheckpoints(workspace)
  ]);

  // Filter to unconsolidated checkpoints
  let unconsolidated;
  if (!consolidationState) {
    // First consolidation: all checkpoints are unconsolidated
    // Sort oldest-first so batching processes chronologically
    unconsolidated = [...allCheckpoints].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  } else {
    const lastTs = new Date(consolidationState.timestamp).getTime();
    const filtered = allCheckpoints.filter(
      c => new Date(c.timestamp).getTime() > lastTs
    );
    // Sort oldest-first
    unconsolidated = filtered.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // Exclude legacy .json files (subagent only understands .md format)
  const mdOnly = unconsolidated.filter(c => c.filePath?.endsWith('.md'));

  // Nothing to consolidate
  if (mdOnly.length === 0) {
    const payload: ConsolidationPayload = {
      status: 'current',
      message: 'Memory is up to date. No unconsolidated checkpoints.'
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
    };
  }

  // Batch: take first CONSOLIDATION_BATCH_CAP (oldest-first)
  const batch = mdOnly.slice(0, CONSOLIDATION_BATCH_CAP);
  const remainingCount = mdOnly.length - batch.length;
  const checkpointFiles = batch.map(c => c.filePath!);

  // Build paths
  const memoriesDir = getMemoriesDir(workspace);
  const memoryPath = join(memoriesDir, 'MEMORY.md');
  const lastConsolidatedPath = join(memoriesDir, '.last-consolidated');

  // Active plan path (if valid active plan exists)
  const activePlanPath = activePlan
    ? join(getPlansDir(workspace), `${activePlan.id}.md`)
    : undefined;

  const previousTotal = consolidationState?.checkpointsConsolidated ?? 0;
  const checkpointCount = batch.length;

  const prompt = buildConsolidationPrompt(
    memoryPath,
    lastConsolidatedPath,
    checkpointFiles,
    activePlanPath,
    checkpointCount,
    previousTotal
  );

  const payload: ConsolidationPayload = {
    status: 'ready',
    checkpointFiles,
    memoryPath,
    lastConsolidatedPath,
    activePlanPath,
    checkpointCount,
    remainingCount,
    previousTotal,
    prompt
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/consolidate.test.ts 2>&1 | tail -20`
Expected: All pass

- [ ] **Step 5: Run full test suite for regressions**

Run: `bun test 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/handlers/consolidate.ts tests/consolidate.test.ts
git commit -m "feat: consolidate handler returns file paths only, no content"
```

---

## Task 5: Update Tool Description

**Files:**
- Modify: `src/tools.ts:286-311`

- [ ] **Step 1: Update consolidate tool description**

In `src/tools.ts`, replace the consolidate tool description (lines 287-301):

```typescript
      description: `Prepare memory consolidation. Returns file paths and metadata for a consolidation subagent. No checkpoint content is returned through this tool.

When to use:
- When recall flags consolidation.needed: true
- Before ending a long session with significant new work
- On a scheduled cadence (e.g., daily wrap-up)

Workflow:
1. Call consolidate() - returns file paths, counts, and subagent prompt
2. If status is "ready": dispatch a BACKGROUND subagent with the prompt field. The subagent reads checkpoint files from disk.
3. If status is "current": nothing to do, memory is up to date
4. If remainingCount > 0: more checkpoints need processing. Run consolidate again or tell the user.

The subagent reads checkpoint files directly from disk and writes two files: .memories/MEMORY.md and .memories/.last-consolidated.

Returns: JSON with status, checkpointFiles (paths), memoryPath, lastConsolidatedPath, remainingCount, and subagent prompt.`,
```

- [ ] **Step 2: Run full test suite**

Run: `bun test 2>&1 | tail -5`
Expected: All pass (server test checks tool count, not description text)

- [ ] **Step 3: Commit**

```bash
git add src/tools.ts
git commit -m "docs: update consolidate tool description for metadata-only response"
```

---

## Task 6: Update Consolidate Skill

**Files:**
- Modify: `skills/consolidate/SKILL.md`

- [ ] **Step 1: Rewrite the skill**

Replace the entire contents of `skills/consolidate/SKILL.md`:

```markdown
---
name: consolidate
description: Consolidate Goldfish checkpoints into MEMORY.md -- use when recall flags consolidation needed, before ending long sessions, or on a scheduled cadence to synthesize episodic checkpoints into durable project understanding
allowed-tools: mcp__goldfish__consolidate, Agent
---

# Consolidate -- Synthesize Developer Memory

## When to Consolidate

- **Recall flags it** -- `consolidation.needed: true` in recall response
- **Before ending a long session** -- significant new work that should be synthesized
- **Scheduled cadence** -- daily wrap-up, weekly review
- **Manual request** -- user asks to consolidate or update project memory

## Workflow

### Step 1: Get the Payload

```
mcp__goldfish__consolidate({})
```

Returns a lightweight JSON payload with `status`, `checkpointFiles` (paths), `memoryPath`, `remainingCount`, and a `prompt` template. No checkpoint content is returned.

### Step 2: Check Status

- **`status: "current"`** -- nothing to do, memory is up to date. Tell the user and stop.
- **`status: "ready"`** -- proceed to step 3.

### Step 3: Dispatch Background Subagent

The `prompt` field already contains everything the subagent needs: file paths to read, synthesis instructions, and output paths to write. Dispatch it directly.

```
Agent({
  description: "Consolidate project memory",
  prompt: payload.prompt,
  run_in_background: true,
  mode: "bypassPermissions"
})
```

### Step 4: Report Remaining

If `remainingCount > 0`, tell the user:
"Consolidated {checkpointCount} checkpoints. {remainingCount} remain. Run `/consolidate` again to process more, or `/consolidate all` to process everything."

If `remainingCount` is 0, the user does not need to know about batching.

## `/consolidate all` -- Process Everything

When the user passes "all" as an argument, loop until fully caught up:

1. Call `consolidate()`
2. If `status: "current"`, done. Report total processed.
3. If `status: "ready"`, dispatch a **foreground** subagent (must wait for `.last-consolidated` to update before next batch).
4. If `remainingCount > 0`, repeat from step 1.
5. **Circuit breaker:** Max 10 iterations. If exceeded, stop and tell user how many were processed and how many remain.

Foreground subagents are required because each batch writes `.last-consolidated`, and the next `consolidate()` call needs that timestamp to filter correctly.

## What the Subagent Does

1. Reads MEMORY.md from disk (if it exists)
2. Reads each checkpoint file from the provided path list
3. Reads the active plan from disk (if provided)
4. Synthesizes into well-structured prose sections (## headers)
5. Overwrites contradictions (new facts replace old)
6. Prunes ephemeral details (keeps decisions, drops debugging steps)
7. Respects the 500-line hard cap
8. Writes updated MEMORY.md and .last-consolidated

The subagent does NOT modify or delete checkpoints or plans.

## After Consolidation

Next time `recall()` runs, it will load the fresh MEMORY.md and show fewer (or zero) delta checkpoints. The consolidation flag will show `needed: false`.
```

- [ ] **Step 2: Commit**

```bash
git add skills/consolidate/SKILL.md
git commit -m "docs: update consolidate skill for metadata-only workflow"
```

---

## Task 7: Version Bump and Final Validation

**Files:**
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `src/server.ts`

- [ ] **Step 1: Bump version to 6.0.2**

Update the version string in all three files from `6.0.1` to `6.0.2`.

- [ ] **Step 2: Run full test suite**

Run: `bun test 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 3: Run type check**

Run: `bunx tsc --noEmit 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit and push**

```bash
git add package.json .claude-plugin/plugin.json src/server.ts
git commit -m "chore: bump version to 6.0.2 for consolidation tool rework"
git push
```
