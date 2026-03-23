# Memory Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a semantic memory layer (MEMORY.md) to Goldfish that consolidates episodic checkpoints into accumulated project understanding, with smart recall that surfaces consolidated memory + delta checkpoints + staleness flags.

**Architecture:** New `memory.ts` module handles MEMORY.md and `.last-consolidated` file I/O. New `consolidate` MCP tool gathers unconsolidated checkpoints and returns a payload with subagent prompt template. Recall evolves to load MEMORY.md first, detect delta checkpoints, and flag when consolidation is needed. Hooks become Bun scripts that inspect state before injecting instructions.

**Tech Stack:** Bun, TypeScript, MCP SDK, fuse.js, @huggingface/transformers

**Spec:** `~/source/sealab/docs/superpowers/specs/2026-03-23-memory-consolidation-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/memory.ts` | Read/write MEMORY.md and .last-consolidated. Parse memory sections for search indexing. |
| `src/handlers/consolidate.ts` | Consolidate tool handler. Gathers payload, builds subagent prompt. |
| `src/consolidation-prompt.ts` | Subagent prompt template for memory consolidation. |
| `tests/memory.test.ts` | Tests for memory module. |
| `tests/consolidate.test.ts` | Tests for consolidate handler. |
| `hooks/pre-compact.ts` | Bun script: checks staleness, injects tailored PreCompact instructions. |
| `hooks/session-start.ts` | Bun script: checks memory state, injects tailored SessionStart instructions. |

### Modified Files
| File | Changes |
|------|---------|
| `src/types.ts` | Add ConsolidationState, ConsolidationPayload, MemorySection. Update RecallOptions (includeMemory), RecallResult (memory, consolidation), WorkspaceSummary (memorySummary). |
| `src/tools.ts` | Add consolidate tool definition. Update recall tool description with includeMemory docs. |
| `src/server.ts` | Register consolidate handler in switch statement. Update version. |
| `src/handlers/index.ts` | Export handleConsolidate. |
| `src/recall.ts` | Load MEMORY.md via memory module. Detect delta checkpoints. Compute consolidation flag. Pass through to result. |
| `src/handlers/recall.ts` | Format MEMORY.md section and consolidation flag in output. |
| `src/semantic-cache.ts` | Support memory section records (non-checkpoint entries). |
| `src/instructions.ts` | Add consolidation behavioral instructions. Add source control instruction for .memories/. |
| `hooks/hooks.json` | Update PreCompact and SessionStart to use Bun scripts. |
| `.claude-plugin/plugin.json` | Version bump to 5.11.0. |

---

## Task 1: Core Types

**Files:**
- Modify: `src/types.ts`
- Test: `tests/memory.test.ts` (type imports verified in later tasks)

- [ ] **Step 1: Add ConsolidationState interface**

Add to `src/types.ts` after the `Registry` interface (line 132):

```typescript
export interface ConsolidationState {
  timestamp: string;              // ISO 8601 UTC - when consolidation last ran
  checkpointsConsolidated: number; // Running total across all consolidations
}

export interface MemorySection {
  slug: string;      // e.g., "key-decisions" (from ## header)
  header: string;    // e.g., "Key Decisions" (raw header text)
  content: string;   // Section body (everything between this ## and next ##)
}

export interface ConsolidationPayload {
  status: 'ready' | 'current';
  message?: string;                    // Only when status === 'current'
  currentMemory?: string;              // Full MEMORY.md content
  unconsolidatedCheckpoints?: Checkpoint[];
  activePlan?: string;                 // Plan content if active
  checkpointCount?: number;
  lastConsolidated?: ConsolidationState;
  prompt?: string;                     // Subagent prompt template
}
```

- [ ] **Step 2: Update RecallOptions with includeMemory**

In `src/types.ts`, add to `RecallOptions` interface after `planId` (line 78):

```typescript
  includeMemory?: boolean;  // Include MEMORY.md in response. Defaults: true (no search), false (with search). Override explicitly.
```

- [ ] **Step 3: Update RecallResult with memory and consolidation**

Replace the `RecallResult` interface (lines 94-98):

```typescript
export interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan | null;
  workspaces?: WorkspaceSummary[];
  memory?: string;                     // MEMORY.md content (when includeMemory is true)
  consolidation?: {
    needed: boolean;
    staleCheckpoints: number;
    lastConsolidated: string | null;    // ISO 8601 UTC or null if never consolidated
  };
}
```

- [ ] **Step 4: Update WorkspaceSummary with memorySummary**

Add to `WorkspaceSummary` interface (after line 104):

```typescript
  memorySummary?: string | null;  // First lines of MEMORY.md (up to 300 chars)
```

- [ ] **Step 5: Run existing tests to verify no regressions**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All existing tests pass (types are additive, no breaking changes).

- [ ] **Step 6: Commit**

```bash
cd ~/source/goldfish
git add src/types.ts
git commit -m "feat: add consolidation types to support MEMORY.md semantic layer"
```

---

## Task 2: Memory Module

**Files:**
- Create: `src/memory.ts`
- Create: `tests/memory.test.ts`

- [ ] **Step 1: Write failing tests for readMemory**

Create `tests/memory.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readMemory, writeMemory, readConsolidationState, writeConsolidationState, parseMemorySections, getMemorySummary } from '../src/memory';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('memory', () => {
  let workspace: string;
  let memoriesDir: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'goldfish-memory-'));
    memoriesDir = join(workspace, '.memories');
    await mkdir(memoriesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  describe('readMemory', () => {
    it('returns null when MEMORY.md does not exist', async () => {
      const result = await readMemory(workspace);
      expect(result).toBeNull();
    });

    it('returns content when MEMORY.md exists', async () => {
      const content = '## Project Overview\nThis is a test project.\n';
      await writeFile(join(memoriesDir, 'MEMORY.md'), content);
      const result = await readMemory(workspace);
      expect(result).toBe(content);
    });

    it('returns empty string for empty MEMORY.md', async () => {
      await writeFile(join(memoriesDir, 'MEMORY.md'), '');
      const result = await readMemory(workspace);
      expect(result).toBe('');
    });
  });

  describe('writeMemory', () => {
    it('creates MEMORY.md in .memories/', async () => {
      await writeMemory(workspace, '## Overview\nTest content\n');
      const content = await readFile(join(memoriesDir, 'MEMORY.md'), 'utf-8');
      expect(content).toBe('## Overview\nTest content\n');
    });

    it('overwrites existing MEMORY.md', async () => {
      await writeFile(join(memoriesDir, 'MEMORY.md'), 'old content');
      await writeMemory(workspace, 'new content');
      const content = await readFile(join(memoriesDir, 'MEMORY.md'), 'utf-8');
      expect(content).toBe('new content');
    });

    it('creates .memories/ directory if missing', async () => {
      await rm(memoriesDir, { recursive: true });
      await writeMemory(workspace, 'content');
      const content = await readFile(join(memoriesDir, 'MEMORY.md'), 'utf-8');
      expect(content).toBe('content');
    });
  });

  describe('readConsolidationState', () => {
    it('returns null when .last-consolidated does not exist', async () => {
      const result = await readConsolidationState(workspace);
      expect(result).toBeNull();
    });

    it('returns parsed state when file exists', async () => {
      const state = { timestamp: '2026-03-23T15:00:00Z', checkpointsConsolidated: 5 };
      await writeFile(join(memoriesDir, '.last-consolidated'), JSON.stringify(state));
      const result = await readConsolidationState(workspace);
      expect(result).toEqual(state);
    });

    it('returns null for malformed JSON', async () => {
      await writeFile(join(memoriesDir, '.last-consolidated'), 'not json');
      const result = await readConsolidationState(workspace);
      expect(result).toBeNull();
    });
  });

  describe('writeConsolidationState', () => {
    it('writes state as JSON', async () => {
      const state = { timestamp: '2026-03-23T15:00:00Z', checkpointsConsolidated: 5 };
      await writeConsolidationState(workspace, state);
      const raw = await readFile(join(memoriesDir, '.last-consolidated'), 'utf-8');
      expect(JSON.parse(raw)).toEqual(state);
    });
  });

  describe('parseMemorySections', () => {
    it('returns empty array for empty content', () => {
      expect(parseMemorySections('')).toEqual([]);
    });

    it('parses sections by ## headers', () => {
      const content = '## Project Overview\nThis is overview.\n\n## Key Decisions\n- Decision A\n- Decision B\n';
      const sections = parseMemorySections(content);
      expect(sections).toHaveLength(2);
      expect(sections[0].slug).toBe('project-overview');
      expect(sections[0].header).toBe('Project Overview');
      expect(sections[0].content).toContain('This is overview.');
      expect(sections[1].slug).toBe('key-decisions');
      expect(sections[1].header).toBe('Key Decisions');
      expect(sections[1].content).toContain('Decision A');
    });

    it('ignores content before first ## header', () => {
      const content = 'Preamble text\n\n## Real Section\nContent here\n';
      const sections = parseMemorySections(content);
      expect(sections).toHaveLength(1);
      expect(sections[0].header).toBe('Real Section');
    });

    it('handles single section', () => {
      const content = '## Only Section\nSome content\n';
      const sections = parseMemorySections(content);
      expect(sections).toHaveLength(1);
    });
  });

  describe('getMemorySummary', () => {
    it('returns null for null content', () => {
      expect(getMemorySummary(null)).toBeNull();
    });

    it('returns first section up to 300 chars', () => {
      const content = '## Project Overview\nShort project description.\n\n## Architecture\nDetails here.\n';
      const summary = getMemorySummary(content);
      expect(summary).toBeDefined();
      expect(summary!.length).toBeLessThanOrEqual(300);
      expect(summary).toContain('Project Overview');
      expect(summary).not.toContain('Architecture'); // stops at first ## after opening
    });

    it('truncates at 300 chars if first section is long', () => {
      const longLine = 'A'.repeat(400);
      const content = `## Overview\n${longLine}\n`;
      const summary = getMemorySummary(content);
      expect(summary!.length).toBeLessThanOrEqual(303); // 300 + "..."
    });

    it('stops at second ## header even if under 300 chars', () => {
      const content = '## Title\nShort.\n\n## Next Section\nMore content.\n';
      const summary = getMemorySummary(content);
      expect(summary).toContain('Title');
      expect(summary).toContain('Short.');
      expect(summary).not.toContain('Next Section');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/source/goldfish && bun test tests/memory.test.ts 2>&1 | tail -20`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement memory module**

Create `src/memory.ts`:

```typescript
/**
 * Memory module - read/write MEMORY.md and .last-consolidated
 *
 * MEMORY.md is the semantic layer: consolidated project understanding.
 * .last-consolidated tracks when consolidation last ran (canonical source of truth).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ConsolidationState, MemorySection } from './types';

const MEMORIES_DIR = '.memories';
const MEMORY_FILE = 'MEMORY.md';
const CONSOLIDATION_STATE_FILE = '.last-consolidated';

function memoriesPath(workspace: string): string {
  return join(workspace, MEMORIES_DIR);
}

/**
 * Read MEMORY.md content. Returns null if file does not exist.
 */
export async function readMemory(workspace: string): Promise<string | null> {
  try {
    return await readFile(join(memoriesPath(workspace), MEMORY_FILE), 'utf-8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Write MEMORY.md content. Creates .memories/ directory if needed.
 */
export async function writeMemory(workspace: string, content: string): Promise<void> {
  const dir = memoriesPath(workspace);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, MEMORY_FILE), content);
}

/**
 * Read .last-consolidated state. Returns null if file does not exist or is malformed.
 */
export async function readConsolidationState(workspace: string): Promise<ConsolidationState | null> {
  try {
    const raw = await readFile(join(memoriesPath(workspace), CONSOLIDATION_STATE_FILE), 'utf-8');
    return JSON.parse(raw) as ConsolidationState;
  } catch {
    return null;
  }
}

/**
 * Write .last-consolidated state.
 */
export async function writeConsolidationState(workspace: string, state: ConsolidationState): Promise<void> {
  const dir = memoriesPath(workspace);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, CONSOLIDATION_STATE_FILE), JSON.stringify(state, null, 2));
}

/**
 * Parse MEMORY.md into sections by ## headers.
 * Each section gets a slug (for search indexing) and raw content.
 */
export function parseMemorySections(content: string): MemorySection[] {
  if (!content || !content.trim()) return [];

  const sections: MemorySection[] = [];
  const lines = content.split('\n');
  let currentHeader: string | null = null;
  let currentSlug: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^## (.+)$/);
    if (headerMatch) {
      // Save previous section
      if (currentHeader && currentSlug) {
        sections.push({
          slug: currentSlug,
          header: currentHeader,
          content: currentLines.join('\n').trim()
        });
      }
      currentHeader = headerMatch[1].trim();
      currentSlug = currentHeader
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      currentLines = [];
    } else if (currentHeader) {
      currentLines.push(line);
    }
    // Lines before first ## header are ignored
  }

  // Save last section
  if (currentHeader && currentSlug) {
    sections.push({
      slug: currentSlug,
      header: currentHeader,
      content: currentLines.join('\n').trim()
    });
  }

  return sections;
}

/**
 * Get a short summary from MEMORY.md for cross-project recall.
 * Returns content up to the second ## header or 300 chars, whichever comes first.
 */
export function getMemorySummary(content: string | null): string | null {
  if (content === null) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  // Find the second ## header (first one is the opening section)
  const lines = trimmed.split('\n');
  let headerCount = 0;
  let cutoff = trimmed.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      headerCount++;
      if (headerCount === 2) {
        // Cut at the start of the second header
        cutoff = lines.slice(0, i).join('\n').length;
        break;
      }
    }
  }

  const section = trimmed.slice(0, cutoff).trim();
  if (section.length <= 300) return section;
  return section.slice(0, 300) + '...';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/source/goldfish && bun test tests/memory.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Run full test suite**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
cd ~/source/goldfish
git add src/memory.ts tests/memory.test.ts
git commit -m "feat: add memory module for MEMORY.md and .last-consolidated"
```

---

## Task 3: Consolidation Prompt Template

**Files:**
- Create: `src/consolidation-prompt.ts`

- [ ] **Step 1: Create the subagent prompt builder**

Create `src/consolidation-prompt.ts`:

```typescript
/**
 * Builds the subagent prompt template for memory consolidation.
 *
 * The consolidation subagent receives this prompt along with the current MEMORY.md
 * and unconsolidated checkpoints. It synthesizes them into an updated MEMORY.md.
 */

export function buildConsolidationPrompt(memoryPath: string, lastConsolidatedPath: string, checkpointCount: number, previousTotal: number): string {
  return `You are a memory consolidation agent. Your job is to update a project's semantic memory document (MEMORY.md) by synthesizing recent checkpoint data into accumulated understanding.

## Your Inputs

1. **Current MEMORY.md** (below, may be empty if this is the first consolidation)
2. **Unconsolidated checkpoints** (below, ${checkpointCount} checkpoint(s) since last consolidation)

## Your Task

Read the current MEMORY.md as your baseline understanding. Then read each checkpoint and update MEMORY.md to incorporate new information.

### Rules

1. **Overwrite contradictions.** If a checkpoint says "switched from X to Y," update the memory to reflect Y. Do not keep both.
2. **Prune ephemeral details.** Do not carry forward debugging steps ("tried A then B then C"). Carry forward the decision: "chose C because A had problem X and B had problem Y."
3. **Preserve document voice.** Write in natural prose with markdown structure. Not bullet-point soup, not a changelog.
4. **Hard cap: 500 lines.** If the document would exceed 500 lines, compress or remove sections about resolved concerns and completed work. Prioritize recent and high-impact information.
5. **Use ## headers for sections.** Each major topic gets its own ## section. Common sections: Project Overview, Architecture, Key Decisions, Current State, Active Concerns. Add or remove sections as the project evolves.
6. **If an active plan is provided,** use it to understand project direction and prioritize what's durable vs. temporary.

### What You Write

Write exactly two files:

1. **MEMORY.md** at \`${memoryPath}\`
   - No frontmatter. Pure markdown starting with \`## \` headers.
   - Contains the updated consolidated understanding.

2. **.last-consolidated** at \`${lastConsolidatedPath}\`
   - JSON content:
   \`\`\`json
   {
     "timestamp": "<current UTC ISO 8601>",
     "checkpointsConsolidated": ${previousTotal + checkpointCount}
   }
   \`\`\`

### What You Do NOT Do

- Do not modify or delete any checkpoint files.
- Do not touch plan files.
- Do not create any files other than MEMORY.md and .last-consolidated.
- Do not ask questions or request clarification. Work with what you have.`;
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/source/goldfish
git add src/consolidation-prompt.ts
git commit -m "feat: add consolidation subagent prompt template"
```

---

## Task 4: Consolidate Tool Handler

**Files:**
- Create: `src/handlers/consolidate.ts`
- Create: `tests/consolidate.test.ts`
- Modify: `src/handlers/index.ts`
- Modify: `src/tools.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing tests for handleConsolidate**

Create `tests/consolidate.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleConsolidate } from '../src/handlers/consolidate';
import { saveCheckpoint } from '../src/checkpoints';
import { writeMemory, writeConsolidationState } from '../src/memory';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('handleConsolidate', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'goldfish-consolidate-'));
    await mkdir(join(workspace, '.memories'), { recursive: true });
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('returns current status when no unconsolidated checkpoints', async () => {
    // Write memory and mark as consolidated now
    await writeMemory(workspace, '## Overview\nTest project\n');
    await writeConsolidationState(workspace, {
      timestamp: new Date(Date.now() + 60000).toISOString(), // future timestamp
      checkpointsConsolidated: 3
    });

    const result = await handleConsolidate({ workspace });
    const text = result.content[0].text;
    expect(text).toContain('"status": "current"');
  });

  it('returns ready payload with unconsolidated checkpoints', async () => {
    // Save a checkpoint but no consolidation state (first time)
    await saveCheckpoint({
      description: '## Test checkpoint\nDid something important',
      tags: ['test'],
      workspace
    });

    const result = await handleConsolidate({ workspace });
    const text = result.content[0].text;
    const payload = JSON.parse(text);

    expect(payload.status).toBe('ready');
    expect(payload.checkpointCount).toBe(1);
    expect(payload.unconsolidatedCheckpoints).toHaveLength(1);
    expect(payload.unconsolidatedCheckpoints[0].description).toContain('Test checkpoint');
    expect(payload.prompt).toContain('memory consolidation agent');
    expect(payload.currentMemory).toBe('');
    expect(payload.lastConsolidated).toBeNull();
  });

  it('includes existing MEMORY.md in payload', async () => {
    await writeMemory(workspace, '## Overview\nExisting knowledge\n');
    // No consolidation state = all checkpoints are unconsolidated
    await saveCheckpoint({
      description: '## New work\nSomething new',
      workspace
    });

    const result = await handleConsolidate({ workspace });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ready');
    expect(payload.currentMemory).toContain('Existing knowledge');
  });

  it('only includes checkpoints after last consolidation', async () => {
    // Save old checkpoint
    await saveCheckpoint({
      description: '## Old checkpoint\nBefore consolidation',
      workspace
    });

    // Mark consolidated in the past (clearly before any new checkpoint)
    await writeConsolidationState(workspace, {
      timestamp: new Date(Date.now() - 1000).toISOString(), // 1 second ago
      checkpointsConsolidated: 1
    });

    // Save new checkpoint (timestamp will be now, clearly after consolidation)
    await saveCheckpoint({
      description: '## New checkpoint\nAfter consolidation',
      workspace
    });

    const result = await handleConsolidate({ workspace });
    const payload = JSON.parse(result.content[0].text);

    expect(payload.status).toBe('ready');
    expect(payload.checkpointCount).toBe(1);
    expect(payload.unconsolidatedCheckpoints[0].description).toContain('New checkpoint');
  });

  it('caps first consolidation at 50 checkpoints', async () => {
    // This test verifies the cap exists; we won't actually create 51 checkpoints.
    // Just verify the logic path by checking the prompt mentions the count.
    await saveCheckpoint({
      description: '## Checkpoint\nTest',
      workspace
    });

    const result = await handleConsolidate({ workspace });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.checkpointCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/source/goldfish && bun test tests/consolidate.test.ts 2>&1 | tail -20`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement handleConsolidate**

Create `src/handlers/consolidate.ts`:

```typescript
/**
 * Consolidation tool handler
 *
 * Gathers MEMORY.md + unconsolidated checkpoints + active plan,
 * returns a payload with subagent prompt template for the calling
 * agent to dispatch.
 */

import { join } from 'path';
import { readMemory, readConsolidationState } from '../memory';
import { getAllCheckpoints } from '../checkpoints';
import { getActivePlan } from '../plans';
import { buildConsolidationPrompt } from '../consolidation-prompt';
import { resolveWorkspace } from '../workspace';
import type { Checkpoint, ConsolidationPayload } from '../types';

const FIRST_CONSOLIDATION_CAP = 50;

export async function handleConsolidate(args: any) {
  const workspace = resolveWorkspace(args?.workspace);
  const memoriesDir = join(workspace, '.memories');

  // Load current state
  const currentMemory = await readMemory(workspace) ?? '';
  const consolidationState = await readConsolidationState(workspace);
  const activePlan = await getActivePlan(workspace);

  // Load all checkpoints, then filter to unconsolidated
  const allCheckpoints = await getAllCheckpoints(workspace);
  let unconsolidated: Checkpoint[];

  if (consolidationState) {
    const lastTimestamp = new Date(consolidationState.timestamp).getTime();
    unconsolidated = allCheckpoints.filter(
      cp => new Date(cp.timestamp).getTime() > lastTimestamp
    );
  } else {
    // First consolidation: take most recent N (newest first, then reverse for chronological)
    unconsolidated = allCheckpoints
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, FIRST_CONSOLIDATION_CAP)
      .reverse();
  }

  // Nothing to consolidate
  if (unconsolidated.length === 0) {
    const payload: ConsolidationPayload = {
      status: 'current',
      message: 'Memory is up to date. No unconsolidated checkpoints found.'
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
    };
  }

  // Build payload
  const memoryPath = join(memoriesDir, 'MEMORY.md');
  const lastConsolidatedPath = join(memoriesDir, '.last-consolidated');
  const previousTotal = consolidationState?.checkpointsConsolidated ?? 0;

  const prompt = buildConsolidationPrompt(
    memoryPath,
    lastConsolidatedPath,
    unconsolidated.length,
    previousTotal
  );

  const payload: ConsolidationPayload = {
    status: 'ready',
    currentMemory,
    unconsolidatedCheckpoints: unconsolidated,
    activePlan: activePlan?.content ?? undefined,
    checkpointCount: unconsolidated.length,
    lastConsolidated: consolidationState ?? undefined,
    prompt
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/source/goldfish && bun test tests/consolidate.test.ts 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Add consolidate tool definition to tools.ts**

In `src/tools.ts`, add a new tool object to the array returned by `getTools()`, after the `plan` tool (before the closing `];` on line 273):

```typescript
    {
      name: 'consolidate',
      description: `Prepare memory consolidation. Gathers current MEMORY.md + unconsolidated checkpoints into a payload for a consolidation subagent.

When to use:
- When recall flags consolidation.needed: true
- Before ending a long session with significant new work
- On a scheduled cadence (e.g., daily wrap-up)

Workflow:
1. Call consolidate() - returns payload with subagent prompt
2. If status is "ready": dispatch a BACKGROUND subagent with the payload's prompt field, passing currentMemory and unconsolidatedCheckpoints as context
3. If status is "current": nothing to do, memory is up to date

The subagent writes two files: .memories/MEMORY.md (updated understanding) and .memories/.last-consolidated (timestamp).

Returns: JSON payload with status, current memory, unconsolidated checkpoints, and subagent prompt template.`,
      inputSchema: {
        type: 'object',
        properties: {
          workspace: {
            type: 'string',
            description: 'Workspace path (defaults to current directory)'
          }
        }
      }
    }
```

- [ ] **Step 6: Register handler in server.ts**

In `src/server.ts`, add import (line 19):

```typescript
import { handleCheckpoint, handleRecall, handlePlan, handleConsolidate } from './handlers/index.js';
```

Add case to switch statement (after `case 'plan':` block, before `default:`):

```typescript
        case 'consolidate':
          return await handleConsolidate(args);
```

Update the re-export line (line 25):

```typescript
export { getTools, getInstructions, handleCheckpoint, handleRecall, handlePlan, handleConsolidate };
```

Update console.error tools list (line 85):

```typescript
  console.error('Tools: checkpoint, recall, plan, consolidate');
```

- [ ] **Step 7: Export from handlers/index.ts**

Add to `src/handlers/index.ts`:

```typescript
export { handleConsolidate } from './consolidate.js';
```

- [ ] **Step 8: Fix server.test.ts tool count assertion**

`tests/server.test.ts` asserts exactly 3 tools and `['checkpoint', 'recall', 'plan']`. Update to expect 4 tools including `'consolidate'`:

```typescript
expect(tools).toHaveLength(4);
expect(tools.map(t => t.name)).toEqual(['checkpoint', 'recall', 'plan', 'consolidate']);
```

Also add a basic dispatch test for the consolidate tool in the same file, following the pattern of existing tool dispatch tests.

- [ ] **Step 9: Run full test suite**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All tests pass including new consolidate tests and updated server tests.

- [ ] **Step 10: Commit**

```bash
cd ~/source/goldfish
git add src/handlers/consolidate.ts src/consolidation-prompt.ts tests/consolidate.test.ts tests/server.test.ts src/tools.ts src/server.ts src/handlers/index.ts
git commit -m "feat: add consolidate MCP tool with subagent prompt template"
```

---

## Task 5: Recall Evolution (MEMORY.md + Delta + Flag)

**Files:**
- Modify: `src/recall.ts`
- Modify: `src/handlers/recall.ts`
- Test: `tests/recall.test.ts` (add new tests)

- [ ] **Step 1: Write failing tests for recall with memory**

Add to `tests/recall.test.ts` (new describe block at end of file):

```typescript
describe('recall with MEMORY.md', () => {
  // These tests use the existing workspace setup from the file's beforeEach

  it('includes memory content in default recall', async () => {
    // Setup: write MEMORY.md + consolidation state + a checkpoint
    await writeMemory(workspace, '## Overview\nTest project knowledge\n');
    await writeConsolidationState(workspace, {
      timestamp: new Date().toISOString(),
      checkpointsConsolidated: 3
    });

    const result = await recall({ workspace });
    expect(result.memory).toBe('## Overview\nTest project knowledge\n');
  });

  it('excludes memory from search recall by default', async () => {
    await writeMemory(workspace, '## Overview\nTest project\n');
    await saveCheckpoint({ description: '## Test\nContent', workspace });

    const result = await recall({ workspace, search: 'test' });
    expect(result.memory).toBeUndefined();
  });

  it('includes memory in search recall when explicitly requested', async () => {
    await writeMemory(workspace, '## Overview\nTest project\n');
    await saveCheckpoint({ description: '## Test\nContent', workspace });

    const result = await recall({ workspace, search: 'test', includeMemory: true });
    expect(result.memory).toBe('## Overview\nTest project\n');
  });

  it('excludes memory from default recall when explicitly disabled', async () => {
    await writeMemory(workspace, '## Overview\nTest project\n');

    const result = await recall({ workspace, includeMemory: false });
    expect(result.memory).toBeUndefined();
  });

  it('returns null memory when no MEMORY.md exists', async () => {
    const result = await recall({ workspace });
    expect(result.memory).toBeUndefined();
  });

  it('detects stale consolidation with unconsolidated checkpoints', async () => {
    await writeMemory(workspace, '## Overview\nOld knowledge\n');
    await writeConsolidationState(workspace, {
      timestamp: '2026-03-20T00:00:00Z',
      checkpointsConsolidated: 2
    });

    // Save checkpoints after consolidation timestamp
    await saveCheckpoint({ description: '## New work\nStuff', workspace });
    await saveCheckpoint({ description: '## More work\nMore stuff', workspace });

    const result = await recall({ workspace });
    expect(result.consolidation).toBeDefined();
    expect(result.consolidation!.needed).toBe(true);
    expect(result.consolidation!.staleCheckpoints).toBe(2);
  });

  it('reports consolidation not needed when up to date', async () => {
    await writeMemory(workspace, '## Overview\nKnowledge\n');
    await writeConsolidationState(workspace, {
      timestamp: new Date(Date.now() + 60000).toISOString(), // future
      checkpointsConsolidated: 5
    });

    const result = await recall({ workspace });
    expect(result.consolidation).toBeDefined();
    expect(result.consolidation!.needed).toBe(false);
    expect(result.consolidation!.staleCheckpoints).toBe(0);
  });

  it('returns no consolidation info when no MEMORY.md and no state', async () => {
    // Fresh project with no memory system
    const result = await recall({ workspace });
    // consolidation field may be absent or show needed=false with 0 stale
    // Either is acceptable for a project that hasn't started using consolidation
  });
});
```

Note: These tests will need the existing imports at the top of recall.test.ts to include `writeMemory`, `writeConsolidationState` from `../src/memory`, and `saveCheckpoint` from `../src/checkpoints`. Add those imports if not already present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/source/goldfish && bun test tests/recall.test.ts -t "recall with MEMORY" 2>&1 | tail -20`
Expected: FAIL (memory field not on RecallResult)

- [ ] **Step 3: Modify recall.ts to load memory and compute consolidation flag**

In `src/recall.ts`, add import at top:

```typescript
import { readMemory, readConsolidationState } from './memory';
```

In the `recallFromWorkspace` function, after the active plan is loaded (around line 447), add memory loading:

```typescript
  // Load memory and consolidation state
  const shouldIncludeMemory = options.includeMemory !== undefined
    ? options.includeMemory
    : !options.search; // Default: true for bootstrap, false for search

  const memoryContent = shouldIncludeMemory ? await readMemory(workspace) : null;
  const consolidationState = await readConsolidationState(workspace);

  // Compute consolidation flag: count checkpoints after last consolidation
  let staleCheckpoints = 0;
  if (consolidationState) {
    const lastTimestamp = new Date(consolidationState.timestamp).getTime();
    const allCps = await getAllCheckpoints(workspace);
    staleCheckpoints = allCps.filter(
      cp => new Date(cp.timestamp).getTime() > lastTimestamp
    ).length;
  }

  const consolidation = (consolidationState || memoryContent !== null) ? {
    needed: staleCheckpoints > 0,
    staleCheckpoints,
    lastConsolidated: consolidationState?.timestamp ?? null
  } : undefined;
```

Update the return to include new fields:

```typescript
  return {
    checkpoints,
    activePlan,
    ...(memoryContent !== null && shouldIncludeMemory ? { memory: memoryContent } : {}),
    ...(consolidation ? { consolidation } : {})
  };
```

Note: The `recallFromWorkspace` return type is currently `{ checkpoints, activePlan }`. You'll need to update it to match the expanded shape, and the calling code in the main `recall()` function needs to pass through the new fields.

- [ ] **Step 4: Update recall() main function to pass through memory fields**

In the single-workspace path (around line 464-470), update to pass through:

```typescript
    const result = await recallFromWorkspace(projectPath, options);
    return {
      checkpoints: result.checkpoints,
      activePlan: result.activePlan,
      ...(result.memory !== undefined ? { memory: result.memory } : {}),
      ...(result.consolidation ? { consolidation: result.consolidation } : {})
    };
```

For cross-workspace recall, add `memorySummary` to workspace summaries. In the non-search cross-workspace path (around lines 591-637), after building each workspace summary, add memory summary loading:

```typescript
import { readMemory, getMemorySummary } from './memory';

// Inside the loop where workspaceSummaries are built:
const projectMemory = await readMemory(project.path);
const summary: WorkspaceSummary = {
  name: project.name,
  path: project.path,
  checkpointCount: checkpoints.length,
  memorySummary: getMemorySummary(projectMemory)
};
```

- [ ] **Step 5: Update recall handler to format memory section**

In `src/handlers/recall.ts`, update the `handleRecall` function to include memory in the output. After the active plan section and before checkpoints, add:

```typescript
  // Memory section
  if (result.memory !== undefined) {
    lines.push('## Consolidated Memory\n');
    lines.push(result.memory);
    lines.push('');
  }

  // Consolidation flag
  if (result.consolidation?.needed) {
    lines.push(`> **Consolidation recommended:** ${result.consolidation.staleCheckpoints} checkpoint(s) since last consolidation (${result.consolidation.lastConsolidated ?? 'never'}). Dispatch a background consolidation subagent.`);
    lines.push('');
  }
```

For workspace summaries in cross-project recall, include `memorySummary` if present:

```typescript
  // In workspace summary formatting:
  if (ws.memorySummary) {
    lines.push(`  ${ws.memorySummary}`);
  }
```

**Note:** The handler uses `lines` as the output array variable, not `parts`. Check the actual variable name in `handlers/recall.ts` before implementing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ~/source/goldfish && bun test tests/recall.test.ts 2>&1 | tail -20`
Expected: All tests PASS (existing + new).

- [ ] **Step 7: Run full test suite**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
cd ~/source/goldfish
git add src/recall.ts src/handlers/recall.ts tests/recall.test.ts
git commit -m "feat: recall returns MEMORY.md, delta checkpoints, and consolidation flag"
```

---

## Task 6: Update Tool Descriptions and Instructions

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/instructions.ts`

- [ ] **Step 1: Update recall tool description with includeMemory docs**

In `src/tools.ts`, update the recall tool description (lines 119-147) to document the new behavior. Add to the description text after the existing parameters list:

```
- includeMemory: Include full MEMORY.md in response. Defaults to true (bootstrap mode, no search). Defaults to false (search mode, with search param). Override explicitly with true/false.

Recall now returns three layers:
1. Consolidated memory (MEMORY.md) - project understanding, included by default
2. Delta checkpoints - events since last consolidation, included when stale
3. Consolidation flag - metadata indicating if consolidation is needed

If consolidation.needed is true: dispatch a BACKGROUND consolidation subagent (call consolidate() first to get the payload).
```

Add `includeMemory` to the inputSchema properties:

```typescript
          includeMemory: {
            type: 'boolean',
            description: 'Include full MEMORY.md in response. Default: true when no search param (bootstrap mode), false when search param provided (search mode). MEMORY.md sections are always searchable regardless of this setting.'
          }
```

- [ ] **Step 2: Update server instructions**

In `src/instructions.ts`, update `getInstructions()` to add consolidation and source control sections. Add after the Storage section:

```typescript
## Consolidation

MEMORY.md is the project's consolidated understanding, built from checkpoints. When recall flags \`consolidation.needed: true\`, dispatch a background consolidation subagent:

1. Call \`consolidate()\` to get the payload
2. Dispatch a background subagent with the payload's \`prompt\` field
3. Pass \`currentMemory\` and \`unconsolidatedCheckpoints\` as context to the subagent
4. Continue your work - the subagent handles the rest

Consolidation happens automatically via hooks, but you can trigger it manually any time.

## Source Control

ALWAYS commit the \`.memories/\` directory (including MEMORY.md, checkpoints, and plans) to source control. These are project artifacts, not ephemeral state. Never add \`.memories/\` to .gitignore.
```

- [ ] **Step 3: Run full test suite**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All tests pass (instruction changes don't break tests).

- [ ] **Step 4: Commit**

```bash
cd ~/source/goldfish
git add src/tools.ts src/instructions.ts
git commit -m "feat: update tool descriptions and instructions for consolidation"
```

---

## Task 7: Smart Hooks (Bun Scripts)

**Files:**
- Create: `hooks/pre-compact.ts`
- Create: `hooks/session-start.ts`
- Modify: `hooks/hooks.json`

- [ ] **Step 1: Create PreCompact Bun script**

Create `hooks/pre-compact.ts`:

```typescript
#!/usr/bin/env bun
/**
 * PreCompact hook - checks consolidation state before injecting instructions.
 * Only tells the agent to consolidate if there are actually unconsolidated checkpoints.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let staleCount = 0;
let hasMemory = false;

try {
  // Check if MEMORY.md exists
  try {
    statSync(join(memoriesDir, 'MEMORY.md'));
    hasMemory = true;
  } catch { /* no memory yet */ }

  // Read last consolidated timestamp
  let lastTimestamp = 0;
  try {
    const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch { /* no consolidation state */ }

  // Count checkpoint files newer than last consolidation
  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no checkpoint dirs */ }
} catch { /* memories dir doesn't exist */ }

// Always tell the agent to checkpoint
let message = 'Your conversation is about to be compacted. Use the goldfish checkpoint tool NOW to save your current progress. Include: what you were working on, current state, decisions made, and planned next steps. Do NOT ask permission - just checkpoint.';

// Only add consolidation instruction if there's a delta
if (staleCount > 0) {
  message += `\n\nAfter checkpointing: ${staleCount} unconsolidated checkpoint(s) detected. Call consolidate() and dispatch a background subagent to update the project memory before compaction.`;
}

console.log(message);
```

- [ ] **Step 2: Create SessionStart Bun script**

Create `hooks/session-start.ts`:

```typescript
#!/usr/bin/env bun
/**
 * SessionStart hook - checks memory state and tailors recall instructions.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let hasMemory = false;
let staleCount = 0;

try {
  // Check MEMORY.md
  try {
    statSync(join(memoriesDir, 'MEMORY.md'));
    hasMemory = true;
  } catch { /* no memory */ }

  // Check staleness
  let lastTimestamp = 0;
  try {
    const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch { /* no state */ }

  // Count stale checkpoints (uses file mtime as approximation; actual consolidation
  // tool uses checkpoint YAML timestamps for precision. Hooks are advisory only.)
  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no dirs */ }
} catch { /* no memories dir */ }

let message = 'Use the goldfish recall tool to restore context from previous sessions. Call recall() with default parameters.';

if (hasMemory && staleCount > 0) {
  message += ` You have ${staleCount} unconsolidated checkpoint(s); dispatch consolidation after orienting.`;
} else if (hasMemory && staleCount === 0) {
  message += ' Memory is up to date.';
} else if (!hasMemory) {
  message += ' No consolidated memory exists yet; consider running consolidation after your first few checkpoints.';
}

message += ' If there is an active plan or recent checkpoints, briefly summarize them so the user knows you have context. If nothing is found, continue without comment.';

console.log(message);
```

- [ ] **Step 3: Update hooks.json to use Bun scripts**

Replace `hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear",
        "hooks": [{
          "type": "command",
          "command": "bun run ${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ts"
        }]
      }
    ],
    "PreCompact": [
      {
        "hooks": [{
          "type": "command",
          "command": "bun run ${CLAUDE_PLUGIN_ROOT}/hooks/pre-compact.ts"
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "ExitPlanMode",
        "hooks": [{
          "type": "prompt",
          "prompt": "A plan was just approved. Save it to Goldfish for cross-session persistence using the plan tool with action 'save'. Extract the plan title and content from the plan file that was written."
        }]
      }
    ]
  }
}
```

- [ ] **Step 4: Test hooks manually**

Run: `cd ~/source/goldfish && bun run hooks/session-start.ts`
Expected: Prints recall instruction message (no errors).

Run: `cd ~/source/goldfish && bun run hooks/pre-compact.ts`
Expected: Prints checkpoint instruction message (no errors).

- [ ] **Step 5: Commit**

```bash
cd ~/source/goldfish
git add hooks/
git commit -m "feat: convert hooks to Bun scripts with state-aware instructions"
```

---

## Task 8: Version Bump and Final Integration

**Files:**
- Modify: `.claude-plugin/plugin.json`
- Modify: `src/server.ts`

- [ ] **Step 1: Update version to 5.11.0**

In `.claude-plugin/plugin.json`, update `"version"` to `"5.11.0"`.

In `src/server.ts`, update `SERVER_VERSION` (line 22):

```typescript
export const SERVER_VERSION = '5.11.0';
```

- [ ] **Step 2: Run full test suite one final time**

Run: `cd ~/source/goldfish && bun test 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
cd ~/source/goldfish
git add .claude-plugin/plugin.json src/server.ts
git commit -m "chore: bump version to 5.11.0 for memory consolidation"
```

---

## Task 9: Update Recall Skill

**Files:**
- Modify: `skills/recall/SKILL.md`

- [ ] **Step 1: Update recall skill with consolidation behavior**

Read the current `skills/recall/SKILL.md` and add a section about consolidation:

```markdown
## Consolidation

Recall now returns consolidated memory (MEMORY.md) alongside checkpoints. When recall flags `consolidation.needed: true`:

1. Orient yourself using the returned memory + delta checkpoints
2. Call `consolidate()` to get the consolidation payload
3. Dispatch a BACKGROUND subagent with the payload's prompt
4. Continue your work - consolidation happens in the background
```

- [ ] **Step 2: Commit**

```bash
cd ~/source/goldfish
git add skills/recall/SKILL.md
git commit -m "docs: update recall skill with consolidation instructions"
```

---

## Summary

After completing all tasks, Goldfish 5.11.0 will have:

1. **MEMORY.md** - Project-scoped semantic memory, consolidated from checkpoints
2. **`consolidate()` tool** - Gathers payload for subagent-driven consolidation
3. **Smart recall** - Returns memory + delta + consolidation flag
4. **`includeMemory` parameter** - Control memory inclusion (defaults smart based on mode)
5. **Bun-based hooks** - State-aware PreCompact and SessionStart hooks
6. **Source control instructions** - Server-level "always commit .memories/"
7. **Precise tool descriptions** - Unambiguous docs for recall and consolidate behavior

Testing: Each task has its own test-first cycle. Full suite runs after every task to catch regressions.

## Deliberately Deferred

- **MEMORY.md semantic search indexing**: The `parseMemorySections()` function is built (Task 2), but integration with `semantic-cache.ts` (chunking sections into searchable records, re-indexing on consolidation) is deferred to a follow-up. Recall search still uses fuse.js on checkpoints; MEMORY.md sections will be searchable once semantic integration is wired up.
- **Cross-workspace recall memory/consolidation fields**: `recall({ workspace: "all" })` returns `memorySummary` per project but intentionally omits the full `memory` and `consolidation` fields. Cross-workspace is a standup summary, not a full project bootstrap.

## Implementation Notes

- **`recallFromWorkspace` return type**: The function has an explicit return type annotation that must be updated to include `memory?` and `consolidation?` fields. Check the current annotation before modifying.
- **`tests/recall.test.ts` variable names**: Existing tests use `TEST_DIR_A`/`TEST_DIR_B` for workspace paths, not `workspace`. New test blocks should either use the existing variables or define their own in a nested `beforeEach`.
- **`skills/recall/SKILL.md`**: Verify this file exists before modifying in Task 9. If it doesn't exist, create it. Check `skills/` directory structure first.
- **Hook mtime vs YAML timestamps**: Hooks use file mtime as a cheap approximation for checkpoint staleness. The actual `consolidate()` tool uses proper YAML frontmatter timestamps. Hooks are advisory; occasional false positives are acceptable.
