import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'fs/promises';
import {
  readMemory,
  writeMemory,
  readConsolidationState,
  writeConsolidationState,
  parseMemorySections,
  getMemorySummary,
  parseMemoryYaml,
} from '../src/memory';
import type { ConsolidationState, MemoryData } from '../src/types';

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

  it('reads memory.yaml when it exists', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    const yamlContent = 'decisions:\n  - Use YAML for memory storage\n';
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
    const yamlContent = 'decisions:\n  - YAML wins\n';
    await writeFile(join(memoriesDir, 'memory.yaml'), yamlContent);
    await writeFile(join(memoriesDir, 'MEMORY.md'), '## Old markdown content');

    const result = await readMemory(tempDir);
    expect(result).toBe(yamlContent);
  });

  it('returns empty string for empty memory.yaml', async () => {
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

    await writeMemory(tempDir, 'decisions:\n  - Use YAML\n');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(memoriesDir, 'memory.yaml'), 'utf-8');
    expect(content).toBe('decisions:\n  - Use YAML\n');
  });

  it('overwrites existing memory.yaml', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, 'memory.yaml'), 'decisions:\n  - old decision\n');

    await writeMemory(tempDir, 'decisions:\n  - new decision\n');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(memoriesDir, 'memory.yaml'), 'utf-8');
    expect(content).toBe('decisions:\n  - new decision\n');
  });

  it('creates .memories/ dir if missing', async () => {
    // tempDir exists but .memories/ does not
    await writeMemory(tempDir, 'gotchas:\n  - Watch out for this\n');

    const { readFile } = await import('fs/promises');
    const content = await readFile(join(tempDir, '.memories', 'memory.yaml'), 'utf-8');
    expect(content).toBe('gotchas:\n  - Watch out for this\n');
  });

  it('uses atomic write (no temp files left behind)', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    await writeMemory(tempDir, 'decisions:\n  - Atomic write\n');

    const files = await readdir(memoriesDir);
    const tempFiles = files.filter(f => f.includes('.tmp.'));
    expect(tempFiles).toEqual([]);
    expect(files).toContain('memory.yaml');
  });

  it('does NOT write to MEMORY.md (only memory.yaml)', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    await writeMemory(tempDir, 'decisions:\n  - Content\n');

    const files = await readdir(memoriesDir);
    expect(files).not.toContain('MEMORY.md');
    expect(files).toContain('memory.yaml');
  });
});

describe('readConsolidationState', () => {
  it('returns null when state file does not exist (no legacy either)', async () => {
    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });

  it('reads from ~/.goldfish/consolidation-state/{workspace}.json', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T00:00:00.000Z',
      checkpointsConsolidated: 5,
    };
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    // tempDir last segment is the workspace name after normalization
    // but normalizeWorkspace is tested elsewhere; use the actual function via writing state
    // We need to figure out what workspace name tempDir normalizes to.
    // Since tempDir is something like /tmp/goldfish-memory-XXXX, normalized is "goldfish-memory-xxxx"
    // Instead, write the state via writeConsolidationState then read it back
    await writeConsolidationState(tempDir, state);
    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(state);
  });

  it('falls back to .memories/.last-consolidated when new path does not exist', async () => {
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

  it('prefers new path over legacy .last-consolidated when both exist', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    const legacyState: ConsolidationState = {
      timestamp: '2026-01-01T00:00:00.000Z',
      checkpointsConsolidated: 2,
    };
    await writeFile(join(memoriesDir, '.last-consolidated'), JSON.stringify(legacyState));

    const newState: ConsolidationState = {
      timestamp: '2026-03-23T00:00:00.000Z',
      checkpointsConsolidated: 10,
    };
    await writeConsolidationState(tempDir, newState);

    const result = await readConsolidationState(tempDir);
    expect(result).toEqual(newState);
  });

  it('returns null for malformed JSON in new path', async () => {
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    // Write bad JSON to where the new state file would go
    // We'll write state via a raw file write, using normalizeWorkspace for the path
    const { normalizeWorkspace } = await import('../src/workspace');
    const wsName = normalizeWorkspace(tempDir);
    await writeFile(join(stateDir, `${wsName}.json`), 'not valid json {{{');

    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON in legacy fallback', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });
    await writeFile(join(memoriesDir, '.last-consolidated'), 'not valid json {{{');

    const result = await readConsolidationState(tempDir);
    expect(result).toBeNull();
  });

  it('throws on permission errors (not ENOENT or parse error)', async () => {
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    await mkdir(stateDir, { recursive: true });
    const { normalizeWorkspace } = await import('../src/workspace');
    const wsName = normalizeWorkspace(tempDir);
    const filePath = join(stateDir, `${wsName}.json`);
    await writeFile(filePath, '{"timestamp":"2026-01-01T00:00:00.000Z","checkpointsConsolidated":1}');
    const { chmod } = await import('fs/promises');
    await chmod(filePath, 0o000);

    try {
      await expect(readConsolidationState(tempDir)).rejects.toThrow();
    } finally {
      await chmod(filePath, 0o644);
    }
  });
});

describe('writeConsolidationState', () => {
  it('writes state as JSON to ~/.goldfish/consolidation-state/{workspace}.json', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 12,
    };

    await writeConsolidationState(tempDir, state);

    const { normalizeWorkspace } = await import('../src/workspace');
    const wsName = normalizeWorkspace(tempDir);
    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    const { readFile } = await import('fs/promises');
    const raw = await readFile(join(stateDir, `${wsName}.json`), 'utf-8');
    expect(JSON.parse(raw)).toEqual(state);
  });

  it('creates consolidation-state dir if missing', async () => {
    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 3,
    };

    await writeConsolidationState(tempDir, state);

    const stateDir = join(tempGoldfishHome, 'consolidation-state');
    const { readdir: listDir } = await import('fs/promises');
    const files = await listDir(stateDir);
    expect(files.length).toBeGreaterThan(0);
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

  it('does NOT write to .memories/.last-consolidated', async () => {
    const memoriesDir = join(tempDir, '.memories');
    await mkdir(memoriesDir, { recursive: true });

    const state: ConsolidationState = {
      timestamp: '2026-03-23T12:00:00.000Z',
      checkpointsConsolidated: 5,
    };
    await writeConsolidationState(tempDir, state);

    const files = await readdir(memoriesDir);
    expect(files).not.toContain('.last-consolidated');
  });
});

describe('parseMemoryYaml', () => {
  it('returns empty object for null input', () => {
    const result = parseMemoryYaml(null);
    expect(result).toEqual({});
  });

  it('returns empty object for empty string', () => {
    const result = parseMemoryYaml('');
    expect(result).toEqual({});
  });

  it('parses decisions list', () => {
    const yaml = 'decisions:\n  - Use atomic writes\n  - Store UTC timestamps\n';
    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toEqual(['Use atomic writes', 'Store UTC timestamps']);
  });

  it('parses all four keys', () => {
    const yaml = [
      'decisions:',
      '  - Use YAML format',
      'open_questions:',
      '  - Should we add Redis?',
      'deferred_work:',
      '  - Add search pagination',
      'gotchas:',
      '  - GOLDFISH_HOME must be set in tests',
    ].join('\n');

    const result: MemoryData = parseMemoryYaml(yaml);
    expect(result.decisions).toEqual(['Use YAML format']);
    expect(result.open_questions).toEqual(['Should we add Redis?']);
    expect(result.deferred_work).toEqual(['Add search pagination']);
    expect(result.gotchas).toEqual(['GOLDFISH_HOME must be set in tests']);
  });

  it('handles missing keys (returns partial object)', () => {
    const yaml = 'gotchas:\n  - Be careful here\n';
    const result = parseMemoryYaml(yaml);
    expect(result.gotchas).toEqual(['Be careful here']);
    expect(result.decisions).toBeUndefined();
    expect(result.open_questions).toBeUndefined();
    expect(result.deferred_work).toBeUndefined();
  });

  it('returns empty object for invalid YAML', () => {
    const result = parseMemoryYaml('{{{{not yaml at all}}}}');
    expect(result).toEqual({});
  });

  it('returns empty object for markdown content (non-YAML)', () => {
    const result = parseMemoryYaml('## Key Decisions\n\nSome markdown content.');
    expect(result).toEqual({});
  });

  it('handles empty lists', () => {
    const yaml = 'decisions: []\nopen_questions:\n  - One question\n';
    const result = parseMemoryYaml(yaml);
    expect(result.decisions).toEqual([]);
    expect(result.open_questions).toEqual(['One question']);
  });
});

describe('parseMemorySections', () => {
  it('returns empty array for empty content', () => {
    expect(parseMemorySections('')).toEqual([]);
  });

  // Legacy markdown tests
  it('parses sections from legacy markdown by ## headers', () => {
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

  it('ignores content before first ## header in markdown', () => {
    const content = 'preamble text\n\n## Key Decisions\n\nDecision content.';
    const sections = parseMemorySections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].header).toBe('Key Decisions');
  });

  it('handles single markdown section', () => {
    const content = '## Only Section\n\nJust this content.';
    const sections = parseMemorySections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].slug).toBe('only-section');
    expect(sections[0].header).toBe('Only Section');
    expect(sections[0].content).toBe('\n\nJust this content.');
  });

  // YAML format tests
  it('parses YAML decisions into a section', () => {
    const yaml = 'decisions:\n  - Use YAML storage\n  - Store UTC timestamps\n';
    const sections = parseMemorySections(yaml);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    const decSection = sections.find(s => s.slug === 'decisions');
    expect(decSection).toBeDefined();
    expect(decSection!.header).toBe('Decisions');
    expect(decSection!.content).toContain('Use YAML storage');
    expect(decSection!.content).toContain('Store UTC timestamps');
  });

  it('parses all four YAML keys into sections', () => {
    const yaml = [
      'decisions:',
      '  - Decision one',
      'open_questions:',
      '  - Question one',
      'deferred_work:',
      '  - Deferred one',
      'gotchas:',
      '  - Gotcha one',
    ].join('\n');

    const sections = parseMemorySections(yaml);
    const slugs = sections.map(s => s.slug);
    expect(slugs).toContain('decisions');
    expect(slugs).toContain('open_questions');
    expect(slugs).toContain('deferred_work');
    expect(slugs).toContain('gotchas');
  });

  it('uses YAML key as slug and display name for YAML format', () => {
    const yaml = 'open_questions:\n  - Is this working?\n';
    const sections = parseMemorySections(yaml);
    const section = sections.find(s => s.slug === 'open_questions');
    expect(section).toBeDefined();
    expect(section!.header).toBe('Open Questions');
  });

  it('skips YAML keys with empty lists', () => {
    const yaml = 'decisions:\n  - One decision\nopen_questions: []\n';
    const sections = parseMemorySections(yaml);
    const decSection = sections.find(s => s.slug === 'decisions');
    const qSection = sections.find(s => s.slug === 'open_questions');
    expect(decSection).toBeDefined();
    expect(qSection).toBeUndefined();
  });
});

describe('getMemorySummary', () => {
  it('returns null for null content', () => {
    expect(getMemorySummary(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getMemorySummary('')).toBeNull();
  });

  // Legacy markdown tests
  it('returns content up to second ## header for markdown', () => {
    const content = '## First Section\n\nSome content.\n\n## Second Section\n\nMore content.';
    const result = getMemorySummary(content);
    expect(result).toBe('## First Section\n\nSome content.');
  });

  it('truncates long markdown content at 300 chars with "..."', () => {
    const longContent = '## Section\n\n' + 'x'.repeat(400);
    const result = getMemorySummary(longContent);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(303); // 300 chars + "..."
    expect(result!.endsWith('...')).toBe(true);
  });

  it('stops at second ## header even if under 300 chars', () => {
    const content = '## A\n\nshort.\n\n## B\n\nmore.';
    const result = getMemorySummary(content);
    expect(result).toBe('## A\n\nshort.');
    expect(result!.length).toBeLessThan(300);
  });

  // YAML format tests
  it('returns a summary for YAML content', () => {
    const yaml = 'decisions:\n  - Use YAML format\n  - Keep data simple\nopen_questions:\n  - Anything unclear?\n';
    const result = getMemorySummary(yaml);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
  });

  it('truncates long YAML content at 300 chars with "..."', () => {
    const longEntries = Array.from({ length: 30 }, (_, i) => `  - Decision entry number ${i + 1} with some extra text to pad it out`).join('\n');
    const yaml = `decisions:\n${longEntries}\n`;
    const result = getMemorySummary(yaml);
    expect(result).not.toBeNull();
    if (yaml.length > 300) {
      expect(result!.length).toBe(303);
      expect(result!.endsWith('...')).toBe(true);
    }
  });
});
