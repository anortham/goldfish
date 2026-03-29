# Merge-Friendly Memory Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MEMORY.md (markdown) with memory.yaml (structured YAML), move `.last-consolidated` out of `.memories/` to `~/.goldfish/` (machine-local), and update all consumers for merge-friendly multi-machine consolidation.

**Architecture:** Memory file changes from free-form markdown to YAML with four fixed section keys (`decisions`, `open_questions`, `deferred_work`, `gotchas`), each containing chronologically sorted single-line entries. Consolidation state moves from `.memories/.last-consolidated` to `~/.goldfish/consolidation-state/{workspace}.json`. Migration reads old formats as fallback.

**Tech Stack:** TypeScript, Bun test runner, `yaml` package (already a dependency), `fuse.js`

---

### Task 1: Add consolidation state path helper to workspace.ts

**Files:**
- Modify: `src/workspace.ts:85-112`
- Test: `tests/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/workspace.test.ts`:

```typescript
describe('getConsolidationStateDir', () => {
  it('returns path under goldfish home', () => {
    const result = getConsolidationStateDir();
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state'));
  });
});

describe('getConsolidationStatePath', () => {
  it('returns per-workspace JSON file path', () => {
    const result = getConsolidationStatePath('/Users/dev/source/goldfish');
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state', 'goldfish.json'));
  });

  it('normalizes workspace name', () => {
    const result = getConsolidationStatePath('/Users/dev/source/@org/my-project');
    expect(result).toBe(join(getGoldfishHomeDir(), 'consolidation-state', 'org-my-project.json'));
  });
});
```

Import `getConsolidationStateDir`, `getConsolidationStatePath`, and `getGoldfishHomeDir` from `../src/workspace`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/workspace.test.ts -t "getConsolidationState"`
Expected: FAIL (functions not exported)

- [ ] **Step 3: Write minimal implementation**

Add to `src/workspace.ts`:

```typescript
export function getConsolidationStateDir(): string {
  return join(getGoldfishHomeDir(), 'consolidation-state');
}

export function getConsolidationStatePath(projectPath: string): string {
  const name = normalizeWorkspace(projectPath);
  return join(getConsolidationStateDir(), `${name}.json`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/workspace.test.ts -t "getConsolidationState"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/workspace.ts tests/workspace.test.ts
git commit -m "feat: add consolidation state path helpers for machine-local storage"
```

---

### Task 2: Update types.ts for YAML memory format

**Files:**
- Modify: `src/types.ts:138-155`

- [ ] **Step 1: Update MemorySection and add MemoryData type**

In `src/types.ts`, replace the `MemorySection` interface and add `MemoryData`:

```typescript
export interface MemoryData {
  decisions?: string[];
  open_questions?: string[];
  deferred_work?: string[];
  gotchas?: string[];
}

export interface MemorySection {
  slug: string;      // e.g., "decisions" (the YAML key)
  header: string;    // e.g., "Decisions" (display name)
  content: string;   // Joined entries as text for search
}
```

Update the `ConsolidationPayload` comment on `memoryPath`:

```typescript
  memoryPath?: string;                 // Absolute path to .memories/memory.yaml
  lastConsolidatedPath?: string;       // Absolute path to ~/.goldfish/consolidation-state/{workspace}.json
```

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit 2>&1 | head -20`
Expected: Type errors in files that use old `MemorySection` shape (this is expected, we'll fix them in later tasks)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add MemoryData and MemoryEntry types for YAML memory format"
```

---

### Task 3: Rewrite memory.ts for YAML format with migration fallback

**Files:**
- Modify: `src/memory.ts`
- Test: `tests/memory.test.ts`

- [ ] **Step 1: Write failing tests for YAML read/write**

Replace the test file `tests/memory.test.ts` with updated tests. Key changes:
- `readMemory` reads `memory.yaml` first, falls back to `MEMORY.md`
- `writeMemory` writes `memory.yaml`
- `parseMemoryYaml` replaces `parseMemorySections`
- `getMemorySummary` works with YAML content
- Consolidation state reads from `~/.goldfish/consolidation-state/{workspace}.json` with fallback

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, writeFile, mkdir, readdir, readFile } from 'fs/promises';
import {
  readMemory,
  writeMemory,
  readConsolidationState,
  writeConsolidationState,
  parseMemoryYaml,
  parseMemorySections,
  getMemorySummary,
} from '../src/memory';
import type { ConsolidationState } from '../src/types';

let tempDir: string;
let tempGoldfishHome: string;
const originalEnv = process.env.GOLDFISH_HOME;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'goldfish-memory-'));
  tempGoldfishHome = await mkdtemp(join(tmpdir(), 'goldfish-home-'));
  process.env.GOLDFISH_HOME = tempGoldfishHome;
});

afterEach(async () => {
  process.env.GOLDFISH_HOME = originalEnv;
  await rm(tempDir, { recursive: true, force: true });
  await rm(tempGoldfishHome, { recursive: true, force: true });
});

describe('readMemory', () => {
  it('returns null when neither memory.yaml nor MEMORY.md exist', async () => {
    const result = await readMemory(tempDir);
    expect(result).toBeNull();
  });

  it('returns content from memory.yaml when it exists', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    const yamlContent = 'decisions:\n  - "2026-03-24 | Some decision"\n';
    await writeFile(join(memoriesDir, 'memory.yaml'), yamlContent);

    const result = await readMemory(tempDir);
    expect(result).toBe(yamlContent);
  });

  it('falls back to MEMORY.md when memory.yaml does not exist', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'MEMORY.md'), '## Key Decisions\n\nSome content here.');

    const result = await readMemory(tempDir);
    expect(result).toBe('## Key Decisions\n\nSome content here.');
  });

  it('prefers memory.yaml over MEMORY.md when both exist', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'memory.yaml'), 'decisions:\n  - "2026-03-24 | YAML version"\n');
    await writeFile(join(memoriesDir, 'MEMORY.md'), '## Old markdown');

    const result = await readMemory(tempDir);
    expect(result).toContain('YAML version');
  });

  it('returns empty string for empty file', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'memory.yaml'), '');

    const result = await readMemory(tempDir);
    expect(result).toBe('');
  });
});

describe('writeMemory', () => {
  it('creates memory.yaml in .memories/', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    const content = 'decisions:\n  - "2026-03-24 | Test"\n';
    await writeMemory(tempDir, content);

    const written = await readFile(join(memoriesDir, 'memory.yaml'), 'utf-8');
    expect(written).toBe(content);
  });

  it('overwrites existing memory.yaml', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'memory.yaml'), 'old content');

    await writeMemory(tempDir, 'new content');

    const written = await readFile(join(memoriesDir, 'memory.yaml'), 'utf-8');
    expect(written).toBe('new content');
  });

  it('creates .memories/ dir if missing', async () => {
    await writeMemory(tempDir, 'decisions:\n  - "2026-03-24 | Test"\n');

    const written = await readFile(join(tempDir, '.memories', 'memory.yaml'), 'utf-8');
    expect(written).toContain('Test');
  });

  it('uses atomic write (no temp files left behind)', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    await writeMemory(tempDir, 'decisions:\n  - "2026-03-24 | Atomic"\n');

    const files = await readdir(memoriesDir);
    const tempFiles = files.filter(f => f.includes('.tmp.'));
    expect(tempFiles).toEqual([]);
    expect(files).toContain('memory.yaml');
  });
});

describe('readConsolidationState', () => {
  it('returns null when no state file exists anywhere', async () => {
    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });

  it('reads from ~/.goldfish/consolidation-state/{workspace}.json', async () => {
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    const workspaceName = tempDir.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const state: ConsolidationState = {
      timestamp: '2026-03-23T00:00:00.000Z',
      checkpointsConsolidated: 5,
    };
    await writeFile(join(stateDir, `${workspaceName}.json`), JSON.stringify(state));

    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(state);
  });

  it('falls back to .memories/.last-consolidated when new path does not exist', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    const state: ConsolidationState = {
      timestamp: '2026-03-20T00:00:00.000Z',
      checkpointsConsolidated: 3,
    };
    await writeFile(join(memoriesDir, '.last-consolidated'), JSON.stringify(state));

    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(state);
  });

  it('prefers new path over old fallback when both exist', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, '.last-consolidated'), JSON.stringify({
      timestamp: '2026-03-20T00:00:00.000Z',
      checkpointsConsolidated: 3,
    }));

    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    const workspaceName = tempDir.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const newState: ConsolidationState = {
      timestamp: '2026-03-25T00:00:00.000Z',
      checkpointsConsolidated: 10,
    };
    await writeFile(join(stateDir, `${workspaceName}.json`), JSON.stringify(newState));

    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(newState);
  });

  it('returns null for malformed JSON', async () => {
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    const workspaceName = tempDir.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    await writeFile(join(stateDir, `${workspaceName}.json`), 'not valid json {{{');

    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });
});

describe('writeConsolidationState', () => {
  it('writes state to ~/.goldfish/consolidation-state/{workspace}.json', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 12,
    };

    await writeConsolidationState(tempDir, state);

    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    const workspaceName = tempDir.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const raw = await readFile(join(stateDir, `${workspaceName}.json`), 'utf-8');
    expect(JSON.parse(raw)).toEqual(state);
  });

  it('creates consolidation-state/ dir if missing', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 1,
    };

    await writeConsolidationState(tempDir, state);

    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    const files = await readdir(stateDir);
    expect(files.length).toBe(1);
    expect(files[0]).toEndWith('.json');
  });

  it('uses atomic write (no temp files left behind)', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 7,
    };
    await writeConsolidationState(tempDir, state);

    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    const files = await readdir(stateDir);
    const tempFiles = files.filter(f => f.includes('.tmp.'));
    expect(tempFiles).toEqual([]);
  });
});

describe('parseMemoryYaml', () => {
  it('returns empty data for empty content', () => {
    expect(parseMemoryYaml('')).toEqual({});
  });

  it('returns empty data for null', () => {
    expect(parseMemoryYaml(null)).toEqual({});
  });

  it('parses YAML with all four sections', () => {
    const yaml = [
      'decisions:',
      '  - "2026-03-24 | Chose YAML over markdown"',
      '',
      'open_questions:',
      '  - "2026-03-25 | How to handle merges?"',
      '',
      'deferred_work:',
      '  - "2026-03-26 | Registry refactor blocked"',
      '',
      'gotchas:',
      '  - "2026-03-27 | Semantic cache is derived state"',
    ].join('\n');

    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toEqual(['2026-03-24 | Chose YAML over markdown']);
    expect(result.open_questions).toEqual(['2026-03-25 | How to handle merges?']);
    expect(result.deferred_work).toEqual(['2026-03-26 | Registry refactor blocked']);
    expect(result.gotchas).toEqual(['2026-03-27 | Semantic cache is derived state']);
  });

  it('omits empty sections', () => {
    const yaml = 'decisions:\n  - "2026-03-24 | Only decisions"\n';
    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toEqual(['2026-03-24 | Only decisions']);
    expect(result.open_questions).toBeUndefined();
    expect(result.deferred_work).toBeUndefined();
    expect(result.gotchas).toBeUndefined();
  });

  it('handles multiple entries per section', () => {
    const yaml = [
      'decisions:',
      '  - "2026-03-24 | First decision"',
      '  - "2026-03-25 | Second decision"',
      '  - "2026-03-26 | Third decision"',
    ].join('\n');

    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toHaveLength(3);
  });

  it('ignores unknown keys', () => {
    const yaml = [
      'decisions:',
      '  - "2026-03-24 | A decision"',
      'random_key:',
      '  - "should be ignored"',
    ].join('\n');

    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toHaveLength(1);
    expect((result as any).random_key).toBeUndefined();
  });
});

describe('parseMemorySections (YAML-backed)', () => {
  it('returns empty array for empty content', () => {
    expect(parseMemorySections('')).toEqual([]);
  });

  it('converts YAML sections to MemorySection format', () => {
    const yaml = [
      'decisions:',
      '  - "2026-03-24 | Chose YAML over markdown"',
      '  - "2026-03-25 | Fixed merge conflicts"',
      '',
      'gotchas:',
      '  - "2026-03-26 | Cache is derived state"',
    ].join('\n');

    const sections = parseMemorySections(yaml);
    expect(sections).toHaveLength(2);
    expect(sections[0].slug).toBe('decisions');
    expect(sections[0].header).toBe('Decisions');
    expect(sections[0].content).toContain('Chose YAML over markdown');
    expect(sections[0].content).toContain('Fixed merge conflicts');
    expect(sections[1].slug).toBe('gotchas');
    expect(sections[1].header).toBe('Gotchas');
  });

  it('falls back to markdown parsing for legacy content', () => {
    const markdown = '## Key Decisions\n\nDecision content here.\n\n## Open Questions\n\nSome questions.';
    const sections = parseMemorySections(markdown);
    expect(sections).toHaveLength(2);
    expect(sections[0].header).toBe('Key Decisions');
  });
});

describe('getMemorySummary', () => {
  it('returns null for null content', () => {
    expect(getMemorySummary(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getMemorySummary('')).toBeNull();
  });

  it('summarizes YAML content showing first section entries', () => {
    const yaml = [
      'decisions:',
      '  - "2026-03-24 | Chose YAML over markdown"',
      '  - "2026-03-25 | Fixed merge conflicts"',
      '',
      'gotchas:',
      '  - "2026-03-26 | Cache is derived state"',
    ].join('\n');

    const result = getMemorySummary(yaml);
    expect(result).not.toBeNull();
    expect(result!).toContain('Chose YAML');
  });

  it('truncates at 300 chars', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      `  - "2026-03-${String(i + 1).padStart(2, '0')} | ${'x'.repeat(30)}"`
    ).join('\n');
    const yaml = `decisions:\n${entries}\n`;

    const result = getMemorySummary(yaml);
    expect(result!.length).toBeLessThanOrEqual(303);
  });

  it('still works with legacy markdown content', () => {
    const markdown = '## First Section\n\nSome content.\n\n## Second Section\n\nMore content.';
    const result = getMemorySummary(markdown);
    expect(result).not.toBeNull();
    expect(result!).toContain('First Section');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/memory.test.ts`
Expected: Multiple failures (functions not updated yet)

- [ ] **Step 3: Implement memory.ts changes**

Rewrite `src/memory.ts`:

```typescript
/**
 * Memory module: file I/O for memory.yaml and consolidation state
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';
import type { ConsolidationState, MemoryData, MemorySection } from './types';
import { getConsolidationStatePath, normalizeWorkspace } from './workspace';

const MEMORIES_DIR = '.memories';
const MEMORY_YAML = 'memory.yaml';
const MEMORY_MD_LEGACY = 'MEMORY.md';
const CONSOLIDATION_STATE_FILE_LEGACY = '.last-consolidated';

const VALID_SECTIONS: (keyof MemoryData)[] = ['decisions', 'open_questions', 'deferred_work', 'gotchas'];

const SECTION_DISPLAY_NAMES: Record<keyof MemoryData, string> = {
  decisions: 'Decisions',
  open_questions: 'Open Questions',
  deferred_work: 'Deferred Work',
  gotchas: 'Gotchas',
};

function memoriesDir(workspace: string): string {
  return join(workspace, MEMORIES_DIR);
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/**
 * Read memory file from the given workspace.
 * Prefers memory.yaml; falls back to MEMORY.md for migration.
 * Returns null if neither file exists.
 */
export async function readMemory(workspace: string): Promise<string | null> {
  const dir = memoriesDir(workspace);
  const yamlContent = await readFileOrNull(join(dir, MEMORY_YAML));
  if (yamlContent !== null) return yamlContent;
  return await readFileOrNull(join(dir, MEMORY_MD_LEGACY));
}

/**
 * Write content to .memories/memory.yaml, creating the directory if needed.
 * Uses atomic write-then-rename to prevent corruption.
 */
export async function writeMemory(workspace: string, content: string): Promise<void> {
  const dir = memoriesDir(workspace);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, MEMORY_YAML);
  await atomicWrite(filePath, content);
}

/**
 * Read consolidation state.
 * Prefers ~/.goldfish/consolidation-state/{workspace}.json;
 * falls back to .memories/.last-consolidated for migration.
 * Returns null on ENOENT or any parse error.
 */
export async function readConsolidationState(workspace: string): Promise<ConsolidationState | null> {
  // Try new location first
  const newPath = getConsolidationStatePath(workspace);
  const newContent = await readFileOrNull(newPath);
  if (newContent !== null) {
    try {
      return JSON.parse(newContent) as ConsolidationState;
    } catch {
      // Malformed JSON at new path, try fallback
    }
  }

  // Fallback to legacy location
  const legacyPath = join(memoriesDir(workspace), CONSOLIDATION_STATE_FILE_LEGACY);
  const legacyContent = await readFileOrNull(legacyPath);
  if (legacyContent === null) return null;
  try {
    return JSON.parse(legacyContent) as ConsolidationState;
  } catch {
    return null;
  }
}

/**
 * Write consolidation state to ~/.goldfish/consolidation-state/{workspace}.json.
 * Uses atomic write-then-rename to prevent corruption.
 */
export async function writeConsolidationState(workspace: string, state: ConsolidationState): Promise<void> {
  const filePath = getConsolidationStatePath(workspace);
  const dir = join(filePath, '..');
  await mkdir(dir, { recursive: true });
  const content = JSON.stringify(state, null, 2);
  await atomicWrite(filePath, content);
}

/**
 * Parse memory.yaml content into a MemoryData structure.
 * Only includes the four known section keys; ignores everything else.
 * Returns empty object for null/empty input.
 */
export function parseMemoryYaml(content: string | null): MemoryData {
  if (!content) return {};

  let parsed: unknown;
  try {
    parsed = YAML.parse(content);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object') return {};

  const result: MemoryData = {};
  for (const key of VALID_SECTIONS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (Array.isArray(value) && value.length > 0) {
      result[key] = value.filter((v): v is string => typeof v === 'string');
    }
  }
  return result;
}

/**
 * Detect whether content is YAML or legacy markdown.
 */
function isYamlContent(content: string): boolean {
  const trimmed = content.trimStart();
  return VALID_SECTIONS.some(key => trimmed.startsWith(`${key}:`));
}

/**
 * Parse memory content into MemorySection array for search integration.
 * Handles both YAML (new) and markdown (legacy) formats.
 */
export function parseMemorySections(content: string): MemorySection[] {
  if (!content) return [];

  if (isYamlContent(content)) {
    const data = parseMemoryYaml(content);
    const sections: MemorySection[] = [];
    for (const key of VALID_SECTIONS) {
      const entries = data[key];
      if (entries && entries.length > 0) {
        sections.push({
          slug: key,
          header: SECTION_DISPLAY_NAMES[key],
          content: entries.join('\n'),
        });
      }
    }
    return sections;
  }

  // Legacy markdown parsing
  return parseMarkdownSections(content);
}

/**
 * Legacy markdown section parser (for migration).
 */
function parseMarkdownSections(content: string): MemorySection[] {
  const firstHeaderIdx = content.indexOf('\n## ');
  const startsAtBeginning = content.startsWith('## ');

  let workingContent: string;
  if (startsAtBeginning) {
    workingContent = content;
  } else if (firstHeaderIdx !== -1) {
    workingContent = content.slice(firstHeaderIdx + 1);
  } else {
    return [];
  }

  const parts = workingContent.split(/(?=^## )/m);
  const sections: MemorySection[] = [];
  for (const part of parts) {
    if (!part.startsWith('## ')) continue;
    const newlineIdx = part.indexOf('\n');
    const header = newlineIdx === -1 ? part.slice(3).trim() : part.slice(3, newlineIdx).trim();
    const body = newlineIdx === -1 ? '' : part.slice(newlineIdx);
    sections.push({
      slug: headerToSlug(header),
      header,
      content: body,
    });
  }
  return sections;
}

function headerToSlug(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Return a summary of memory content (up to 300 chars).
 * Handles both YAML and legacy markdown formats.
 * Returns null for null or empty input.
 */
export function getMemorySummary(content: string | null): string | null {
  if (!content) return null;

  let summary: string;

  if (isYamlContent(content)) {
    // For YAML, show up to 300 chars of the raw content
    summary = content.slice(0, 300);
  } else {
    // Legacy markdown: up to second ## header or 300 chars
    const firstHeaderIdx = content.indexOf('## ');
    let cutoff = content.length;
    if (firstHeaderIdx !== -1) {
      const secondHeaderIdx = content.indexOf('\n## ', firstHeaderIdx + 1);
      if (secondHeaderIdx !== -1) {
        cutoff = secondHeaderIdx + 1;
      }
    }
    summary = content.slice(0, cutoff);
    if (summary.length > 300) {
      summary = summary.slice(0, 300);
    }
  }

  if (summary.length >= 300) {
    summary = summary.slice(0, 300) + '...';
  }

  return summary.trim() || null;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tempPath, content, 'utf-8');
  try {
    await rename(tempPath, filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8');
      try { await unlink(tempPath); } catch {}
    } else {
      throw error;
    }
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/memory.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/memory.ts tests/memory.test.ts
git commit -m "feat: rewrite memory module for YAML format with migration fallback"
```

---

### Task 4: Update consolidation handler for new paths

**Files:**
- Modify: `src/handlers/consolidate.ts:84-86`
- Test: `tests/consolidate.test.ts`

- [ ] **Step 1: Update failing test assertions**

In `tests/consolidate.test.ts`, update the test at line 75-83:

```typescript
  it('returns memoryPath and lastConsolidatedPath', async () => {
    await saveCheckpoint({ description: 'a checkpoint', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.memoryPath).toBe(join(TEST_DIR, '.memories', 'memory.yaml'));
    expect(parsed.lastConsolidatedPath).toBe(getConsolidationStatePath(TEST_DIR));
  });
```

Also update the test at line 137-146 that checks prompt content:

```typescript
  it('includes prompt with file paths embedded', async () => {
    await saveCheckpoint({ description: 'test', workspace: TEST_DIR });

    const result = await handleConsolidate({ workspace: TEST_DIR });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.prompt).toContain('Read the following files');
    expect(parsed.prompt).toContain(`${sep}.memories${sep}`);
    expect(parsed.prompt).toContain('memory.yaml');
  });
```

Add import for `getConsolidationStatePath` from `../src/workspace`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/consolidate.test.ts -t "returns memoryPath"`
Expected: FAIL (still returns old paths)

- [ ] **Step 3: Update the handler**

In `src/handlers/consolidate.ts`, update the path-building section (lines 83-86):

```typescript
  // Build paths
  const memoriesDir = getMemoriesDir(workspace);
  const memoryPath = join(memoriesDir, 'memory.yaml');
  const lastConsolidatedPath = getConsolidationStatePath(workspace);
```

Add import for `getConsolidationStatePath` from `../workspace.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/consolidate.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/handlers/consolidate.ts tests/consolidate.test.ts
git commit -m "feat: update consolidation handler paths for YAML and machine-local state"
```

---

### Task 5: Rewrite consolidation prompt for YAML output

**Files:**
- Modify: `src/consolidation-prompt.ts`
- Test: `tests/consolidate.test.ts`

- [ ] **Step 1: Update test assertions for YAML prompt**

In `tests/consolidate.test.ts`, update the test "prompt contains litmus test and traffic light budget":

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

    // YAML format instructions
    expect(parsed.prompt).toContain('decisions');
    expect(parsed.prompt).toContain('open_questions');
    expect(parsed.prompt).toContain('deferred_work');
    expect(parsed.prompt).toContain('gotchas');
    expect(parsed.prompt).toContain('YYYY-MM-DD');

    // Old markdown patterns gone
    expect(parsed.prompt).not.toContain('## header');
    expect(parsed.prompt).not.toContain('No prescribed sections');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/consolidate.test.ts -t "litmus test"`
Expected: FAIL on YAML-specific assertions

- [ ] **Step 3: Rewrite the consolidation prompt**

Replace the entire content of `src/consolidation-prompt.ts`:

```typescript
/**
 * Build the subagent prompt for memory consolidation.
 *
 * The prompt tells the subagent to read checkpoint files from disk
 * rather than receiving content inline.
 */

/**
 * @param memoryPath - Absolute path to memory.yaml (may not exist yet)
 * @param lastConsolidatedPath - Absolute path to consolidation state JSON
 * @param checkpointFiles - Absolute paths to checkpoint files, oldest-first
 * @param activePlanPath - Absolute path to active plan, or undefined
 * @param checkpointCount - Number of checkpoint files in this batch
 * @param previousTotal - Running total of checkpoints consolidated before this batch
 * @param lastBatchTimestamp - ISO 8601 timestamp of the last checkpoint in this batch (used as consolidation cursor)
 */
export function buildConsolidationPrompt(
  memoryPath: string,
  lastConsolidatedPath: string,
  checkpointFiles: string[],
  activePlanPath: string | undefined,
  checkpointCount: number,
  previousTotal: number,
  lastBatchTimestamp: string
): string {
  const newTotal = previousTotal + checkpointCount;

  const fileList = checkpointFiles
    .map((f, i) => `   ${i + 1}. \`${f}\``)
    .join('\n');

  const planSection = activePlanPath
    ? `\`${activePlanPath}\`\n   - Use it to understand project direction. Do not modify it.`
    : 'No active plan.';

  return `You are a memory consolidation subagent. Your job is to distill developer checkpoints into a lean memory.yaml that captures only what cannot be derived from the codebase, git log, or tools.

## Inputs

Read the following files using the Read tool:

1. **Current memory file** (baseline): \`${memoryPath}\`
   - If the file does not exist, this is the first consolidation. Start from scratch.
   - The file may be YAML (new format) or markdown (legacy). Either way, use it as baseline context.

2. **Checkpoint files** (read in this exact order, oldest first):
${fileList}
   - Each file has YAML frontmatter (between \`---\` markers) with metadata fields, followed by a markdown body (the checkpoint description).
   - Extract durable facts from the markdown body. The frontmatter contains timestamp, tags, type, and optional structured fields (decision, context, impact, symbols, next).

3. **Active plan** (optional context): ${planSection}

## Output Format: YAML

Write a YAML file with exactly these four section keys (omit sections with no entries):

\`\`\`yaml
decisions:
  - "YYYY-MM-DD | description of decision and rationale"

open_questions:
  - "YYYY-MM-DD | unresolved question or uncertainty"

deferred_work:
  - "YYYY-MM-DD | what is blocked, why, and what unblocks it"

gotchas:
  - "YYYY-MM-DD | non-obvious thing discovered through experience"
\`\`\`

**Format rules:**
- Each entry is a single quoted string: \`"YYYY-MM-DD | description"\`
- The date is when the entry was discovered/decided (from checkpoint timestamps)
- Entries sorted chronologically within each section, newest at the bottom
- Blank line between sections
- Omit sections that have no entries (no empty arrays)
- Section order when present: decisions, open_questions, deferred_work, gotchas

## Synthesis Instructions

**Litmus test: if you can derive it from the codebase, git log, or tools, it doesn't belong in memory.yaml.**

### KEEP (hard to reconstruct)

- **Decisions + rationale**: why a choice was made, what alternatives were rejected
- **Open questions**: unresolved uncertainties, things still being evaluated
- **Deferred work with context**: what's blocked, why, and what's needed to unblock
- **Gotchas**: non-obvious things discovered through experience that would burn time again

### KILL (derivable from code, git, or tools)

- Architecture descriptions (read the code)
- Module/file inventories (use search tools)
- Phase histories and changelogs (git log)
- Feature lists (read the files)
- Infrastructure/config details (read configs)
- Current state summaries (git status, tests)

### How to Synthesize

1. **Start from existing memory.** Preserve entries that are still accurate. Do not rewrite entries that haven't changed.
2. **Read checkpoints in order** (oldest first). Extract only decisions, rationale, open questions, deferred work, and gotchas.
3. **Overwrite contradictions.** If a checkpoint says "we switched from X to Y", update the existing entry to reflect Y. Remove entries that are no longer true.
4. **Age out old entries.** Drop entries with dates older than 30 days to make room for recent decisions. If something from 30+ days ago is still relevant, it probably belongs in CLAUDE.md, not here.
5. **Add new entries.** Append new entries at the bottom of their section (chronological order).
6. **Remove stale entries.** Delete entries that are resolved, no longer relevant, or contradicted by newer information.
7. **Minimize the diff.** Only touch entries that need to change. Unchanged entries must remain exactly as they are, character for character. This is critical for version control merges across multiple machines.

### Entry Budget (Traffic Light)

- **Green**: under 25 entries total. Healthy. Room to add.
- **Yellow**: 25-40 entries. Don't add without removing something.
- **Red**: over 40 entries. Must remove something before adding.

If over 40 entries, you are almost certainly including derivable information. Re-apply the litmus test aggressively.

## Output: Write Two Files

**File 1:** Write the updated memory.yaml to:
\`${memoryPath}\`

- Pure YAML, no frontmatter. Starts directly with a section key.
- Target under 25 entries total. Never exceed 40.

**File 2:** Write the consolidation state JSON to:
\`${lastConsolidatedPath}\`

Content must be exactly:
\`\`\`json
{ "timestamp": "${lastBatchTimestamp}", "checkpointsConsolidated": ${newTotal} }
\`\`\`

## Constraints

- Do NOT modify or delete any checkpoint files.
- Do NOT touch plan files.
- Do NOT create any files other than the two listed above.
- If you are uncertain about a fact from the checkpoints, omit it rather than guess.`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/consolidate.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/consolidation-prompt.ts tests/consolidate.test.ts
git commit -m "feat: rewrite consolidation prompt for YAML output format"
```

---

### Task 6: Update recall.ts for YAML memory

**Files:**
- Modify: `src/recall.ts:425-555`
- Test: `tests/recall.test.ts`

- [ ] **Step 1: Update recall test fixtures**

In `tests/recall.test.ts`, update the `MEMORY_CONTENT` constant and memory-related tests in the "Memory and consolidation in recall" describe block. The key change: use YAML content instead of markdown for tests that write memory files.

Update the constant:

```typescript
  const MEMORY_CONTENT = `decisions:
  - "2026-03-20 | Chose LanceDB for vector store"
  - "2026-03-21 | MPS acceleration for Apple Silicon"

gotchas:
  - "2026-03-22 | Sparks is the MCP server entry point"
`;
```

Then update the "Memory section search integration" tests to use YAML content:

```typescript
  it('search finds content in memory.yaml sections', async () => {
    await writeMemory(TEST_DIR_A, [
      'decisions:',
      '  - "2026-03-20 | Use Kubernetes with Helm charts for all production deployments"',
      '',
      'gotchas:',
      '  - "2026-03-21 | Integration tests run in CI against ephemeral postgres databases"',
    ].join('\n'));

    await saveCheckpoint({
      description: 'Added retry logic to payment processor',
      tags: ['payments'],
      workspace: TEST_DIR_A
    });

    const result = await recall({
      workspace: TEST_DIR_A,
      search: 'Kubernetes',
      limit: 5
    });

    expect(result.matchedMemorySections).toBeDefined();
    expect(result.matchedMemorySections!.length).toBeGreaterThanOrEqual(1);
    const matched = result.matchedMemorySections!.find(s => s.header === 'Decisions');
    expect(matched).toBeDefined();
    expect(matched!.content).toContain('Kubernetes');
  });
```

Update the second search test similarly, using YAML format.

Also update the `stat` check for memory existence. In `recall.ts`, the code checks for `MEMORY.md` existence at lines 428 and 551-555. These need to check for `memory.yaml` first, with fallback.

- [ ] **Step 2: Run tests to verify failures**

Run: `bun test tests/recall.test.ts -t "Memory"`
Expected: Some failures from format/path changes

- [ ] **Step 3: Update recall.ts**

Changes needed in `src/recall.ts`:

1. Update the `stat` check at line 428 to check `memory.yaml` first, then `MEMORY.md`:

```typescript
    let memoryExists = false;
    try {
      await stat(join(workspace, '.memories', 'memory.yaml'));
      memoryExists = true;
    } catch {
      try {
        await stat(join(workspace, '.memories', 'MEMORY.md'));
        memoryExists = true;
      } catch { /* neither exists */ }
    }
```

2. Apply the same change at lines 550-555 (same pattern, second occurrence).

3. No other changes needed in recall.ts. The `readMemory` and `readConsolidationState` functions already handle the fallback internally, and `parseMemorySections` already handles both YAML and markdown.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/recall.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/recall.ts tests/recall.test.ts
git commit -m "feat: update recall for YAML memory format with fallback"
```

---

### Task 7: Update recall handler formatting

**Files:**
- Modify: `src/handlers/recall.ts:183-189`

- [ ] **Step 1: Update the consolidated memory section header**

In `src/handlers/recall.ts`, update lines 183-189 to label the section more generically:

```typescript
  // Consolidated memory section
  if (result.memory) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Consolidated Memory');
    lines.push(result.memory);
  }
```

This section doesn't actually need to change. The label "Consolidated Memory" is format-agnostic, and the content (whether YAML or markdown) is just dumped as-is. The LLM reading it can parse either format.

- [ ] **Step 2: Verify no changes needed**

Run: `bun test tests/handlers.test.ts`
Expected: PASS (no changes to recall handler needed)

- [ ] **Step 3: Commit (skip if no changes)**

No commit needed for this task.

---

### Task 8: Update hooks for new file paths

**Files:**
- Modify: `hooks/session-start.ts:13-14`
- Modify: `hooks/count-stale.ts:12-16`

- [ ] **Step 1: Update session-start.ts**

Change the memory existence check from `MEMORY.md` to check `memory.yaml` first:

```typescript
  try {
    statSync(join(memoriesDir, 'memory.yaml'));
    hasMemory = true;
  } catch {
    try {
      statSync(join(memoriesDir, 'MEMORY.md'));
      hasMemory = true;
    } catch { /* no memory */ }
  }
```

- [ ] **Step 2: Update count-stale.ts**

Update the consolidation state reading to check the new location first, then fall back:

```typescript
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export function countStaleCheckpoints(memoriesDir: string): number {
  let staleCount = 0;

  let lastTimestamp = 0;

  // Try new location first: ~/.goldfish/consolidation-state/{workspace}.json
  const goldfishHome = process.env.GOLDFISH_HOME || join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.goldfish');
  // Extract workspace name from memoriesDir (parent of .memories)
  const projectPath = memoriesDir.replace(/[/\\]\.memories$/, '');
  let workspaceName = projectPath.replace(/^.*[/\\]/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!workspaceName) workspaceName = 'default';
  const newStatePath = join(goldfishHome, 'consolidation-state', `${workspaceName}.json`);

  try {
    const raw = readFileSync(newStatePath, 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch {
    // Fall back to legacy location
    try {
      const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
      const state = JSON.parse(raw);
      lastTimestamp = new Date(state.timestamp).getTime();
    } catch { /* no state */ }
  }

  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no dirs */ }

  return staleCount;
}
```

- [ ] **Step 3: Verify hooks work**

Run: `bun test` (full suite, hooks are tested indirectly through handler tests)
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add hooks/session-start.ts hooks/count-stale.ts
git commit -m "feat: update hooks for YAML memory and machine-local consolidation state"
```

---

### Task 9: Update tool descriptions and server instructions

**Files:**
- Modify: `src/tools.ts:289-320`
- Modify: `src/instructions.ts:42-50`

- [ ] **Step 1: Update consolidate tool description**

In `src/tools.ts`, update the consolidate tool description (line 291-306). Change references from `.memories/MEMORY.md` and `.memories/.last-consolidated` to the new locations:

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

The subagent reads checkpoint files directly from disk and writes two files: .memories/memory.yaml (version-controlled) and a machine-local consolidation state file.

Returns: JSON with status, checkpointCount, remainingCount, memoryPath, lastConsolidatedPath, and subagent prompt.`,
```

- [ ] **Step 2: Update recall tool description**

In `src/tools.ts`, update the recall tool `includeMemory` parameter description (line 196-197):

```typescript
            description: 'Include full memory.yaml in response. Default: true when no search param (bootstrap mode), false when search param provided (search mode). Memory sections are always searchable regardless of this setting.'
```

Also update the main recall tool description comment about `includeMemory` (line 80):

```typescript
  includeMemory?: boolean;  // Include memory.yaml in response. Defaults: true (no search), false (with search). Override explicitly.
```

Wait, that's in types.ts, not tools.ts. Update the comment in `src/types.ts` line 80 as well.

- [ ] **Step 3: Update server instructions**

In `src/instructions.ts`, update the consolidation section to not specify internal file names (it's within the 2k cap so we have room):

No changes actually needed here. The instructions say "dispatch a background subagent with the payload's prompt field" and "the subagent handles the rest". The file paths are in the prompt, not in the instructions. The source control section says "commit `.memories/`" which is still correct.

- [ ] **Step 4: Run the server instruction length test**

Run: `bun test tests/server.test.ts -t "character"`
Expected: PASS (instructions still under 2k)

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts src/types.ts
git commit -m "feat: update tool descriptions for YAML memory format"
```

---

### Task 10: Update skills documentation

**Files:**
- Modify: `skills/consolidate/SKILL.md`
- Modify: `skills/recall/SKILL.md`

- [ ] **Step 1: Update consolidate skill**

In `skills/consolidate/SKILL.md`, update lines 3, 65-68, 72:

Line 3 (description):
```
description: Consolidate Goldfish checkpoints into memory.yaml -- use when recall flags consolidation needed, before ending long sessions, or on a scheduled cadence to synthesize episodic checkpoints into durable project understanding
```

Lines 63-74 (what subagent does):
```markdown
## What the Subagent Does

1. Reads memory.yaml from disk (if it exists; handles legacy MEMORY.md as baseline)
2. Reads each checkpoint file from the provided path list
3. Reads the active plan from disk (if provided)
4. Synthesizes into structured YAML with four fixed sections (decisions, open_questions, deferred_work, gotchas)
5. Overwrites contradictions (new facts replace old)
6. Prunes ephemeral details (keeps decisions, drops debugging steps)
7. Respects the 40-entry hard cap
8. Writes updated memory.yaml and consolidation state
```

- [ ] **Step 2: Update recall skill**

In `skills/recall/SKILL.md`, update line 49:
```
### Search without memory (leaner results)
```

Update line 95:
```
Recall now returns consolidated memory (memory.yaml) alongside checkpoints. When recall flags `consolidation.needed: true`, use the `/consolidate` skill to handle it.
```

- [ ] **Step 3: Commit**

```bash
git add skills/consolidate/SKILL.md skills/recall/SKILL.md
git commit -m "docs: update skill descriptions for YAML memory format"
```

---

### Task 11: Update CLAUDE.md references

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update architecture storage diagram**

Update the `.memories/` tree in the Architecture Overview section to show `memory.yaml` instead of `MEMORY.md`, and remove `.last-consolidated` (it's now in `~/.goldfish/`):

```
{project}/.memories/
  {date}/
    {HHMMSS}_{hash}.md    # Individual checkpoint files (YAML frontmatter)
  plans/
    {plan-id}.md           # Individual plans (YAML frontmatter)
  .active-plan             # Contains active plan ID
  memory.yaml              # Consolidated memory (YAML, merge-friendly)

~/.goldfish/
  registry.json            # Cross-project registry (auto-populated)
  consolidation-state/     # Per-workspace consolidation cursors (machine-local)
    {workspace}.json
  cache/semantic/          # Derived semantic manifest + JSONL records (rebuildable)
  models/transformers/     # Local embedding model cache
```

- [ ] **Step 2: Update module table**

Update the `src/memory.ts` description in the Core Modules table:

```
| `src/memory.ts` | Memory file I/O (memory.yaml with MEMORY.md fallback), consolidation state I/O | `tests/memory.test.ts` |
```

- [ ] **Step 3: Update key types**

Update the `RecallOptions` comment for `includeMemory`:

```typescript
  includeMemory?: boolean;  // Include memory.yaml in response. Defaults: true (no search), false (with search).
```

- [ ] **Step 4: Update Behavioral Language Pattern section**

If there are references to "MEMORY.md" in the behavioral language section, update to "memory.yaml".

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for YAML memory format and machine-local consolidation state"
```

---

### Task 12: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 2: Run type check**

Run: `bunx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify no stale references**

Run: `grep -r "MEMORY\.md" src/ tests/ hooks/ --include="*.ts" | grep -v "MEMORY_MD_LEGACY\|Legacy\|legacy\|fallback\|migration"` to find any references that should have been updated but weren't. A few are expected (the legacy fallback paths), but any in main code paths should be investigated.

Also check: `grep -r "\.last-consolidated" src/ tests/ hooks/ --include="*.ts" | grep -v "LEGACY\|legacy\|fallback\|migration"` for stale references to the old consolidation state path.

- [ ] **Step 4: Fix any issues found**

Address any stale references or test failures.

- [ ] **Step 5: Final commit if fixes were needed**

```bash
git add -A
git commit -m "fix: clean up stale MEMORY.md references"
```
