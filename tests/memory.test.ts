import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import {
  readMemory,
  writeMemory,
  readConsolidationState,
  writeConsolidationState,
  parseMemorySections,
  getMemorySummary,
} from '../src/memory';
import type { ConsolidationState } from '../src/types';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'goldfish-memory-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('readMemory', () => {
  it('returns null when MEMORY.md does not exist', async () => {
    const result = await readMemory(tempDir);
    expect(result).toBeNull();
  });

  it('returns content when MEMORY.md exists', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'MEMORY.md'), '## Key Decisions\n\nSome content here.');

    const result = await readMemory(tempDir);
    expect(result).toBe('## Key Decisions\n\nSome content here.');
  });

  it('returns empty string for empty file', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'MEMORY.md'), '');

    const result = await readMemory(tempDir);
    expect(result).toBe('');
  });
});

describe('writeMemory', () => {
  it('creates MEMORY.md in .memories/', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    await writeMemory(tempDir, '## Section\n\nContent.');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(memoriesDir, 'MEMORY.md'), 'utf-8');
    expect(content).toBe('## Section\n\nContent.');
  });

  it('overwrites existing MEMORY.md', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'MEMORY.md'), 'old content');

    await writeMemory(tempDir, 'new content');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(memoriesDir, 'MEMORY.md'), 'utf-8');
    expect(content).toBe('new content');
  });

  it('creates .memories/ dir if missing', async () => {
    // tempDir exists but .memories/ does not
    await writeMemory(tempDir, '## Section\n\nContent.');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(tempDir, '.memories', 'MEMORY.md'), 'utf-8');
    expect(content).toBe('## Section\n\nContent.');
  });
});

describe('readConsolidationState', () => {
  it('returns null when .last-consolidated does not exist', async () => {
    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });

  it('returns parsed state when file exists', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    const state: ConsolidationState = {
      timestamp: '2026-03-23T00:00:00.000Z',
      checkpointsConsolidated: 5,
    };
    await writeFile(join(memoriesDir, '.last-consolidated'), JSON.stringify(state));

    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(state);
  });

  it('returns null for malformed JSON', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, '.last-consolidated'), 'not valid json {{{');

    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });
});

describe('writeConsolidationState', () => {
  it('writes state as JSON', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 12,
    };

    await writeConsolidationState(tempDir, state);

    const { readFile } = await import('fs/promises');
    const raw = await readFile(join(memoriesDir, '.last-consolidated'), 'utf-8');
    expect(JSON.parse(raw)).toEqual(state);
  });
});

describe('parseMemorySections', () => {
  it('returns empty array for empty content', () => {
    expect(parseMemorySections('')).toEqual([]);
  });

  it('parses sections by ## headers', () => {
    const content = '## Key Decisions\n\nDecision content here.\n\n## Open Questions\n\nSome questions.';
    const sections = parseMemorySections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].slug).toBe('key-decisions');
    expect(sections[0].header).toBe('Key Decisions');
    expect(sections[0].content).toBe('\n\nDecision content here.\n\n');
    expect(sections[1].slug).toBe('open-questions');
    expect(sections[1].header).toBe('Open Questions');
    expect(sections[1].content).toBe('\n\nSome questions.');
  });

  it('ignores content before first ## header', () => {
    const content = 'preamble text\n\n## Key Decisions\n\nDecision content.';
    const sections = parseMemorySections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].header).toBe('Key Decisions');
  });

  it('handles single section', () => {
    const content = '## Only Section\n\nJust this content.';
    const sections = parseMemorySections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].slug).toBe('only-section');
    expect(sections[0].header).toBe('Only Section');
    expect(sections[0].content).toBe('\n\nJust this content.');
  });
});

describe('getMemorySummary', () => {
  it('returns null for null content', () => {
    expect(getMemorySummary(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getMemorySummary('')).toBeNull();
  });

  it('returns content up to second ## header', () => {
    const content = '## First Section\n\nSome content.\n\n## Second Section\n\nMore content.';
    const result = getMemorySummary(content);
    expect(result).toBe('## First Section\n\nSome content.\n\n');
  });

  it('truncates long content at 300 chars with "..."', () => {
    const longContent = '## Section\n\n' + 'x'.repeat(400);
    const result = getMemorySummary(longContent);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(303); // 300 chars + "..."
    expect(result!.endsWith('...')).toBe(true);
  });

  it('stops at second ## header even if under 300 chars', () => {
    const content = '## A\n\nshort.\n\n## B\n\nmore.';
    const result = getMemorySummary(content);
    expect(result).toBe('## A\n\nshort.\n\n');
    expect(result!.length).toBeLessThan(300);
  });
});
