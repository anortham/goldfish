import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  saveCheckpoint,
  getCheckpointsForDay,
  getCheckpointsForDateRange,
  getAllCheckpoints,
  parseCheckpointFile,
  parseJsonCheckpoint,
  formatCheckpoint,
  generateCheckpointId,
  getCheckpointFilename
} from '../src/checkpoints';
import type { Checkpoint, CheckpointInput } from '../src/types';
import { ensureMemoriesDir, getMemoriesDir } from '../src/workspace';
import { listRegisteredProjects, unregisterProject } from '../src/registry';
import { join } from 'path';
import { tmpdir } from 'os';
import { rm, readdir, readFile, writeFile, mkdir } from 'fs/promises';

let tempDir: string;

beforeEach(async () => {
  tempDir = join(tmpdir(), `test-checkpoints-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await ensureMemoriesDir(tempDir);
});

afterEach(async () => {
  // Clean up registry entry to avoid polluting the real registry
  await unregisterProject(tempDir);
  await rm(tempDir, { recursive: true, force: true });
});

// ─── formatCheckpoint ────────────────────────────────────────────────

describe('formatCheckpoint', () => {
  it('formats checkpoint with all fields as YAML frontmatter + body', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_a1b2c3d4',
      timestamp: '2026-02-14T09:30:42.123Z',
      description: 'Fixed JWT validation bug where expired tokens were accepted.',
      tags: ['bug-fix', 'auth'],
      git: {
        branch: 'feature/jwt-fix',
        commit: 'a1b2c3d',
        files: ['src/auth/jwt.ts', 'tests/auth.test.ts']
      },
      summary: 'Fixed JWT validation bug'
    };

    const formatted = formatCheckpoint(checkpoint);

    // Should start and end with YAML frontmatter delimiters
    expect(formatted).toMatch(/^---\n/);
    expect(formatted).toContain('\n---\n');

    // Should contain YAML fields
    expect(formatted).toContain('id: checkpoint_a1b2c3d4');
    expect(formatted).toContain('timestamp: 2026-02-14T09:30:42.123Z');
    expect(formatted).toContain('summary: Fixed JWT validation bug');

    // Tags as YAML array
    expect(formatted).toContain('tags:');
    expect(formatted).toContain('  - bug-fix');
    expect(formatted).toContain('  - auth');

    // Git context as nested YAML
    expect(formatted).toContain('git:');
    expect(formatted).toContain('  branch: feature/jwt-fix');
    expect(formatted).toContain('  commit: a1b2c3d');
    expect(formatted).toContain('  files:');
    expect(formatted).toContain('    - src/auth/jwt.ts');
    expect(formatted).toContain('    - tests/auth.test.ts');

    // Body after frontmatter
    expect(formatted).toContain('\n\nFixed JWT validation bug where expired tokens were accepted.\n');
  });

  it('formats checkpoint with minimal fields (just id, timestamp, description)', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_deadbeef',
      timestamp: '2026-02-14T10:00:00.000Z',
      description: 'Simple checkpoint'
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('id: checkpoint_deadbeef');
    expect(formatted).toContain('timestamp:');
    expect(formatted).not.toContain('tags:');
    expect(formatted).not.toContain('git:');
    expect(formatted).not.toContain('summary:');
    expect(formatted).toContain('\n\nSimple checkpoint\n');
  });

  it('includes git context as nested YAML when present', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_11111111',
      timestamp: '2026-02-14T12:00:00.000Z',
      description: 'With git context',
      git: {
        branch: 'main',
        commit: 'abc1234'
      }
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('git:');
    expect(formatted).toContain('  branch: main');
    expect(formatted).toContain('  commit: abc1234');
    // No files key if not present
    expect(formatted).not.toContain('files:');
  });

  it('includes tags as YAML array when present', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_22222222',
      timestamp: '2026-02-14T13:00:00.000Z',
      description: 'Tagged checkpoint',
      tags: ['feature', 'frontend', 'css']
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('tags:');
    expect(formatted).toContain('  - feature');
    expect(formatted).toContain('  - frontend');
    expect(formatted).toContain('  - css');
  });

  it('includes planId in frontmatter when present', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_abc123',
      timestamp: '2026-01-15T10:30:00.000Z',
      description: 'Checkpoint with plan affinity',
      planId: 'my-feature-plan'
    };

    const formatted = formatCheckpoint(checkpoint);
    expect(formatted).toContain('planId: my-feature-plan');
  });

  it('omits planId from frontmatter when not present', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_abc123',
      timestamp: '2026-01-15T10:30:00.000Z',
      description: 'Checkpoint without plan'
    };

    const formatted = formatCheckpoint(checkpoint);
    expect(formatted).not.toContain('planId');
  });

  it('includes summary in frontmatter when present', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_33333333',
      timestamp: '2026-02-14T14:00:00.000Z',
      description: 'A very long description that goes on and on about the refactoring work done today.',
      summary: 'Refactoring work'
    };

    const formatted = formatCheckpoint(checkpoint);

    expect(formatted).toContain('summary: Refactoring work');
    // Summary is in frontmatter, description is in body
    expect(formatted).toContain('\n\nA very long description');
  });
});

// ─── parseCheckpointFile ─────────────────────────────────────────────

describe('parseCheckpointFile', () => {
  it('parses checkpoint with all fields', () => {
    const content = `---
id: checkpoint_a1b2c3d4
timestamp: "2026-02-14T09:30:42.123Z"
tags:
  - bug-fix
  - auth
git:
  branch: feature/jwt-fix
  commit: a1b2c3d
  files:
    - src/auth/jwt.ts
    - tests/auth.test.ts
summary: Fixed JWT validation bug
---

Fixed JWT validation bug where expired tokens were accepted.
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('checkpoint_a1b2c3d4');
    expect(checkpoint.timestamp).toBe('2026-02-14T09:30:42.123Z');
    expect(checkpoint.tags).toEqual(['bug-fix', 'auth']);
    expect(checkpoint.git).toEqual({
      branch: 'feature/jwt-fix',
      commit: 'a1b2c3d',
      files: ['src/auth/jwt.ts', 'tests/auth.test.ts']
    });
    expect(checkpoint.summary).toBe('Fixed JWT validation bug');
    expect(checkpoint.description).toBe('Fixed JWT validation bug where expired tokens were accepted.');
  });

  it('parses checkpoint with minimal fields', () => {
    const content = `---
id: checkpoint_deadbeef
timestamp: "2026-02-14T10:00:00.000Z"
---

Simple checkpoint
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('checkpoint_deadbeef');
    expect(checkpoint.timestamp).toBe('2026-02-14T10:00:00.000Z');
    expect(checkpoint.description).toBe('Simple checkpoint');
    expect(checkpoint.tags).toBeUndefined();
    expect(checkpoint.git).toBeUndefined();
    expect(checkpoint.summary).toBeUndefined();
  });

  it('round-trips through formatCheckpoint and parseCheckpointFile', () => {
    const original: Checkpoint = {
      id: 'checkpoint_roundtrip',
      timestamp: '2026-02-14T15:30:42.789Z',
      description: 'Round-trip test with all fields populated.',
      tags: ['test', 'roundtrip'],
      git: {
        branch: 'feature/test',
        commit: 'ff00ff0',
        files: ['src/foo.ts', 'src/bar.ts']
      },
      summary: 'Round-trip test'
    };

    const formatted = formatCheckpoint(original);
    const parsed = parseCheckpointFile(formatted);

    expect(parsed.id).toBe(original.id);
    expect(parsed.timestamp).toBe(original.timestamp);
    expect(parsed.description).toBe(original.description);
    expect(parsed.tags).toEqual(original.tags);
    expect(parsed.git).toEqual(original.git);
    expect(parsed.summary).toBe(original.summary);
  });

  it('handles missing git section gracefully', () => {
    const content = `---
id: checkpoint_nogit
timestamp: "2026-02-14T10:00:00.000Z"
tags:
  - test
---

No git context here.
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.git).toBeUndefined();
    expect(checkpoint.tags).toEqual(['test']);
  });

  it('handles missing tags gracefully', () => {
    const content = `---
id: checkpoint_notags
timestamp: "2026-02-14T10:00:00.000Z"
git:
  branch: main
---

No tags here.
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.tags).toBeUndefined();
    expect(checkpoint.git!.branch).toBe('main');
  });

  it('trims whitespace from description body', () => {
    const content = `---
id: checkpoint_trim
timestamp: "2026-02-14T10:00:00.000Z"
---

  Some description with leading spaces.

And trailing newlines.

`;

    const checkpoint = parseCheckpointFile(content);

    // Description should be trimmed
    expect(checkpoint.description).toBe('Some description with leading spaces.\n\nAnd trailing newlines.');
  });

  // ─── Old Julie MD format (Unix timestamps, files_changed, type) ──────

  it('parses old Julie MD format with Unix timestamp', () => {
    const content = `---
git:
  branch: main
  commit: 5d11ef5
  dirty: true
  files_changed:
  - src/handler.rs
  - src/tools/mod.rs
id: checkpoint_6990afbd_476027
tags:
- memory-removal
- cleanup
timestamp: 1771089853
type: checkpoint
---

## Memory Tools Removal — Complete

Removed 3 MCP tools, moving to Goldfish.
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('checkpoint_6990afbd_476027');
    // Unix timestamp 1771089853 = 2026-02-15T06:04:13.000Z
    expect(checkpoint.timestamp).toMatch(/^2026-02-1\dT/);
    expect(new Date(checkpoint.timestamp).getTime()).toBe(1771089853 * 1000);
    expect(checkpoint.tags).toEqual(['memory-removal', 'cleanup']);
    // files_changed should be mapped to files
    expect(checkpoint.git).toEqual({
      branch: 'main',
      commit: '5d11ef5',
      files: ['src/handler.rs', 'src/tools/mod.rs']
    });
    // dirty and type should be dropped
    expect((checkpoint.git as any)?.dirty).toBeUndefined();
    expect((checkpoint as any).type).toBeUndefined();
    expect(checkpoint.description).toContain('Memory Tools Removal');
  });

  it('parses old Julie MD format with millisecond timestamp and camelCase filesChanged', () => {
    const content = `---
id: mem_b2e2166f5c477f2c
timestamp: 1770580174333
tags:
  - milestone
git:
  branch: main
  commit: d273c52
  dirty: true
  filesChanged:
    - src/handler.rs
---

## Round 5 Complete
`;

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('mem_b2e2166f5c477f2c');
    // Millisecond timestamp (> 1e10) should be treated as ms, not seconds
    expect(new Date(checkpoint.timestamp).getTime()).toBe(1770580174333);
    expect(checkpoint.git!.files).toEqual(['src/handler.rs']);
    expect((checkpoint.git as any)?.filesChanged).toBeUndefined();
    expect((checkpoint.git as any)?.dirty).toBeUndefined();
  });

  it('parses old Julie MD format with decision type', () => {
    const content = `---
git:
  branch: main
  commit: 5d11ef5
  dirty: true
  files_changed:
  - JULIE_AGENT_INSTRUCTIONS.md
id: decision_6990ab06_9f4cac
tags:
- architectural-decision
timestamp: 1771088646
type: decision
---

## Architectural Decision: Julie/Goldfish Separation
`;

    const checkpoint = parseCheckpointFile(content);

    // Non-standard ID should be preserved as-is
    expect(checkpoint.id).toBe('decision_6990ab06_9f4cac');
    // Unix timestamp converted to ISO
    expect(new Date(checkpoint.timestamp).getTime()).toBe(1771088646 * 1000);
    expect(checkpoint.tags).toEqual(['architectural-decision']);
    expect(checkpoint.git!.files).toEqual(['JULIE_AGENT_INSTRUCTIONS.md']);
    expect(checkpoint.description).toContain('Architectural Decision');
  });

  // ─── CRLF handling ──────────────────────────────────────────────────

  it('handles CRLF line endings (Windows git checkout)', () => {
    // Simulate content that passed through git with core.autocrlf=true
    const content = "---\r\nid: checkpoint_crlf0001\r\ntimestamp: \"2026-02-14T21:31:02.718Z\"\r\ntags:\r\n  - windows\r\ngit:\r\n  branch: main\r\n  commit: a1b2c3d\r\nsummary: CRLF checkpoint\r\n---\r\n\r\nThis checkpoint has Windows line endings.\r\n";

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('checkpoint_crlf0001');
    expect(checkpoint.timestamp).toBe('2026-02-14T21:31:02.718Z');
    expect(checkpoint.tags).toEqual(['windows']);
    expect(checkpoint.git).toEqual({ branch: 'main', commit: 'a1b2c3d' });
    expect(checkpoint.summary).toBe('CRLF checkpoint');
    expect(checkpoint.description).toBe('This checkpoint has Windows line endings.');
  });

  it('handles mixed LF/CRLF line endings', () => {
    // Some lines CRLF, some LF (can happen with manual edits)
    const content = "---\r\nid: checkpoint_mixed01\ntimestamp: \"2026-02-14T10:00:00.000Z\"\r\n---\r\n\nMixed endings.\n";

    const checkpoint = parseCheckpointFile(content);

    expect(checkpoint.id).toBe('checkpoint_mixed01');
    expect(checkpoint.timestamp).toBe('2026-02-14T10:00:00.000Z');
    expect(checkpoint.description).toBe('Mixed endings.');
  });

  it('strips BOM from checkpoint files (Windows Notepad)', () => {
    const content = `\uFEFF---
id: checkpoint_bom00001
timestamp: "2026-02-14T10:00:00.000Z"
---

Checkpoint with BOM.`;

    const checkpoint = parseCheckpointFile(content);
    expect(checkpoint.id).toBe('checkpoint_bom00001');
    expect(checkpoint.description).toBe('Checkpoint with BOM.');
  });

  it('parses planId from frontmatter', () => {
    const content = `---
id: checkpoint_abc123
timestamp: "2026-01-15T10:30:00.000Z"
planId: my-feature-plan
---

Checkpoint with plan affinity`;

    const checkpoint = parseCheckpointFile(content);
    expect(checkpoint.planId).toBe('my-feature-plan');
  });

  it('omits planId when not in frontmatter', () => {
    const content = `---
id: checkpoint_abc123
timestamp: "2026-01-15T10:30:00.000Z"
---

Checkpoint without plan`;

    const checkpoint = parseCheckpointFile(content);
    expect(checkpoint.planId).toBeUndefined();
  });

  it('roundtrips planId through format/parse', () => {
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

  it('handles null/undefined timestamp in legacy data gracefully', () => {
    // When timestamp field is missing or null in YAML, it comes through as null
    const content = `---
id: checkpoint_nullts001
timestamp: null
---

Missing timestamp.`;

    const checkpoint = parseCheckpointFile(content);
    expect(checkpoint.id).toBe('checkpoint_nullts001');
    // Should produce a valid ISO string, not "null"
    expect(checkpoint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── parseJsonCheckpoint (old Julie JSON format) ────────────────────

describe('parseJsonCheckpoint', () => {
  it('parses old Julie JSON format with all fields', () => {
    const content = JSON.stringify({
      id: 'checkpoint_691f37ff_869822',
      timestamp: 1763653631,
      type: 'checkpoint',
      git: {
        branch: 'main',
        commit: '05c1036',
        dirty: true
      },
      description: 'Investigated TOON format and fixed parentheses bug.',
      tags: ['toon', 'planning']
    });

    const checkpoint = parseJsonCheckpoint(content);

    expect(checkpoint.id).toBe('checkpoint_691f37ff_869822');
    // Unix timestamp 1763653631 converted to ISO
    expect(new Date(checkpoint.timestamp).getTime()).toBe(1763653631 * 1000);
    expect(checkpoint.description).toBe('Investigated TOON format and fixed parentheses bug.');
    expect(checkpoint.tags).toEqual(['toon', 'planning']);
    expect(checkpoint.git).toEqual({
      branch: 'main',
      commit: '05c1036'
    });
    // dirty and type should be dropped
    expect((checkpoint.git as any)?.dirty).toBeUndefined();
    expect((checkpoint as any).type).toBeUndefined();
  });

  it('parses JSON checkpoint with minimal fields', () => {
    const content = JSON.stringify({
      id: 'checkpoint_abcd1234_ef5678',
      timestamp: 1763700000,
      description: 'Simple checkpoint'
    });

    const checkpoint = parseJsonCheckpoint(content);

    expect(checkpoint.id).toBe('checkpoint_abcd1234_ef5678');
    expect(new Date(checkpoint.timestamp).getTime()).toBe(1763700000 * 1000);
    expect(checkpoint.description).toBe('Simple checkpoint');
    expect(checkpoint.tags).toBeUndefined();
    expect(checkpoint.git).toBeUndefined();
  });

  it('handles JSON checkpoint with files_changed in git', () => {
    const content = JSON.stringify({
      id: 'checkpoint_fc000000_aabbcc',
      timestamp: 1763700000,
      git: {
        branch: 'feature',
        commit: 'abc1234',
        dirty: false,
        files_changed: ['src/foo.rs', 'src/bar.rs']
      },
      description: 'With files_changed'
    });

    const checkpoint = parseJsonCheckpoint(content);

    expect(checkpoint.git!.files).toEqual(['src/foo.rs', 'src/bar.rs']);
    expect((checkpoint.git as any)?.files_changed).toBeUndefined();
    expect((checkpoint.git as any)?.dirty).toBeUndefined();
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonCheckpoint('not json')).toThrow();
  });
});

// ─── getCheckpointsForDay (legacy format support) ───────────────────

describe('getCheckpointsForDay legacy formats', () => {
  it('reads .json files alongside .md files', async () => {
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, '2025-11-20');
    await mkdir(dateDir, { recursive: true });

    // Write a .json checkpoint (old Julie format)
    const jsonContent = JSON.stringify({
      id: 'checkpoint_json0001_aabb',
      timestamp: 1763654400,
      description: 'Old JSON checkpoint',
      tags: ['legacy']
    });
    await writeFile(join(dateDir, '120000_json.json'), jsonContent, 'utf-8');

    // Write a .md checkpoint (current format)
    const mdContent = `---
id: checkpoint_md000001
timestamp: "2025-11-20T15:00:00.000Z"
---

Current MD checkpoint
`;
    await writeFile(join(dateDir, '150000_md00.md'), mdContent, 'utf-8');

    const checkpoints = await getCheckpointsForDay(tempDir, '2025-11-20');

    expect(checkpoints).toHaveLength(2);
    const descriptions = checkpoints.map(c => c.description);
    expect(descriptions).toContain('Old JSON checkpoint');
    expect(descriptions).toContain('Current MD checkpoint');
  });
});

// ─── generateCheckpointId ────────────────────────────────────────────

describe('generateCheckpointId', () => {
  it('generates deterministic ID from timestamp + description', () => {
    const id = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Test description');
    expect(id).toMatch(/^checkpoint_[0-9a-f]{8}$/);
  });

  it('same input produces same output', () => {
    const id1 = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Same description');
    const id2 = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Same description');
    expect(id1).toBe(id2);
  });

  it('different input produces different output', () => {
    const id1 = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Description A');
    const id2 = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Description B');
    expect(id1).not.toBe(id2);

    const id3 = generateCheckpointId('2026-02-14T09:30:42.123Z', 'Same text');
    const id4 = generateCheckpointId('2026-02-14T10:00:00.000Z', 'Same text');
    expect(id3).not.toBe(id4);
  });

  it('format is checkpoint_{8-hex-chars}', () => {
    const id = generateCheckpointId('2026-02-14T12:00:00.000Z', 'Any description');
    expect(id).toMatch(/^checkpoint_[0-9a-f]{8}$/);
  });
});

// ─── getCheckpointFilename ───────────────────────────────────────────

describe('getCheckpointFilename', () => {
  it('generates filename from checkpoint as HHMMSS_hash4.md', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_a1b2c3d4',
      timestamp: '2026-02-14T09:30:42.123Z',
      description: 'Test'
    };

    const filename = getCheckpointFilename(checkpoint);
    expect(filename).toBe('093042_a1b2.md');
  });

  it('handles different timestamps correctly', () => {
    const checkpoint1: Checkpoint = {
      id: 'checkpoint_deadbeef',
      timestamp: '2026-02-14T14:05:09.000Z',
      description: 'Test'
    };
    expect(getCheckpointFilename(checkpoint1)).toBe('140509_dead.md');

    const checkpoint2: Checkpoint = {
      id: 'checkpoint_00ff11aa',
      timestamp: '2026-02-14T23:59:59.999Z',
      description: 'Test'
    };
    expect(getCheckpointFilename(checkpoint2)).toBe('235959_00ff.md');
  });

  it('handles midnight correctly', () => {
    const checkpoint: Checkpoint = {
      id: 'checkpoint_abcd1234',
      timestamp: '2026-02-14T00:00:00.000Z',
      description: 'Midnight checkpoint'
    };
    expect(getCheckpointFilename(checkpoint)).toBe('000000_abcd.md');
  });
});

// ─── saveCheckpoint ──────────────────────────────────────────────────

describe('saveCheckpoint', () => {
  it('saves checkpoint as individual file in .memories/{date}/', async () => {
    const input: CheckpointInput = {
      description: 'Test checkpoint save',
      tags: ['test'],
      workspace: tempDir
    };

    const checkpoint = await saveCheckpoint(input);
    const today = checkpoint.timestamp.split('T')[0]!;

    // Check file exists in the right location
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, today);
    const files = await readdir(dateDir);

    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^\d{6}_[0-9a-f]{4}\.md$/);
  });

  it('checkpoint has valid id field', async () => {
    const checkpoint = await saveCheckpoint({
      description: 'ID test',
      workspace: tempDir
    });

    expect(checkpoint.id).toMatch(/^checkpoint_[0-9a-f]{8}$/);
  });

  it('checkpoint has git context as nested object', async () => {
    const checkpoint = await saveCheckpoint({
      description: 'Git context test',
      workspace: tempDir
    });

    // We're running in a git repo, so git context should be present
    // The git field should be a nested object (not flat gitBranch/gitCommit)
    if (checkpoint.git) {
      expect(checkpoint.git).toHaveProperty('branch');
      expect(checkpoint.git).toHaveProperty('commit');
      // Should NOT have old flat fields
      expect((checkpoint as any).gitBranch).toBeUndefined();
      expect((checkpoint as any).gitCommit).toBeUndefined();
    }
  });

  it('file content is valid YAML frontmatter + markdown body', async () => {
    const checkpoint = await saveCheckpoint({
      description: 'Content validation test',
      tags: ['validation'],
      workspace: tempDir
    });

    const today = checkpoint.timestamp.split('T')[0]!;
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, today);
    const files = await readdir(dateDir);
    const content = await readFile(join(dateDir, files[0]!), 'utf-8');

    // Should be valid YAML frontmatter format
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('\n---\n');
    expect(content).toContain('id: ' + checkpoint.id);
    expect(content).toContain('Content validation test');
    expect(content).toContain('  - validation');
  });

  it('auto-generates summary for long descriptions', async () => {
    const longDescription = 'Successfully refactored the entire authentication system to use JWT tokens instead of session cookies. Updated all middleware, tests, and documentation. Added refresh token support and improved error handling for expired tokens.';

    const checkpoint = await saveCheckpoint({
      description: longDescription,
      workspace: tempDir
    });

    expect(checkpoint.summary).toBeDefined();
    expect(checkpoint.summary!.length).toBeLessThanOrEqual(150);
  });

  it('does not generate summary for short descriptions', async () => {
    const checkpoint = await saveCheckpoint({
      description: 'Short description',
      workspace: tempDir
    });

    expect(checkpoint.summary).toBeUndefined();
  });

  it('handles concurrent writes safely (10 parallel saves)', async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      saveCheckpoint({
        description: `Concurrent checkpoint ${i}`,
        workspace: tempDir
      })
    );

    const checkpoints = await Promise.all(writes);

    // All 10 checkpoints should be saved
    expect(checkpoints).toHaveLength(10);

    // All should have unique IDs
    const ids = new Set(checkpoints.map(c => c.id));
    expect(ids.size).toBe(10);

    // Verify files on disk
    const today = checkpoints[0]!.timestamp.split('T')[0]!;
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, today);
    const files = await readdir(dateDir);
    expect(files.length).toBe(10);
  });

  it('attaches planId when active plan exists', async () => {
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

  it('omits planId when no active plan exists', async () => {
    const checkpoint = await saveCheckpoint({
      description: 'Checkpoint with no plan',
      workspace: tempDir
    });

    expect(checkpoint.planId).toBeUndefined();
  });

  it('saves multiple checkpoints as separate files', async () => {
    await saveCheckpoint({
      description: 'First checkpoint',
      workspace: tempDir
    });

    // Small delay to ensure different timestamps
    await new Promise(resolve => setTimeout(resolve, 10));

    await saveCheckpoint({
      description: 'Second checkpoint',
      workspace: tempDir
    });

    const today = new Date().toISOString().split('T')[0]!;
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, today);
    const files = await readdir(dateDir);

    // Each checkpoint is its own file
    expect(files.length).toBe(2);
  });
});

// ─── getCheckpointsForDay ────────────────────────────────────────────

describe('getCheckpointsForDay', () => {
  it('returns checkpoints for a specific day', async () => {
    await saveCheckpoint({
      description: 'Morning work',
      tags: ['feature'],
      workspace: tempDir
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    await saveCheckpoint({
      description: 'Afternoon work',
      tags: ['bug-fix'],
      workspace: tempDir
    });

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(tempDir, today);

    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]!.description).toBe('Morning work');
    expect(checkpoints[1]!.description).toBe('Afternoon work');
  });

  it('returns empty array for day with no checkpoints', async () => {
    const checkpoints = await getCheckpointsForDay(tempDir, '2020-01-01');
    expect(checkpoints).toEqual([]);
  });

  it('returns checkpoints sorted by timestamp', async () => {
    // Create checkpoints with small delays to ensure ordering
    for (let i = 0; i < 3; i++) {
      await saveCheckpoint({
        description: `Checkpoint ${i}`,
        workspace: tempDir
      });
      if (i < 2) await new Promise(resolve => setTimeout(resolve, 10));
    }

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(tempDir, today);

    expect(checkpoints).toHaveLength(3);
    for (let i = 1; i < checkpoints.length; i++) {
      const prev = new Date(checkpoints[i - 1]!.timestamp).getTime();
      const curr = new Date(checkpoints[i]!.timestamp).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('each checkpoint has an id field', async () => {
    await saveCheckpoint({
      description: 'ID check',
      workspace: tempDir
    });

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(tempDir, today);

    expect(checkpoints[0]!.id).toMatch(/^checkpoint_[0-9a-f]{8}$/);
  });
});

// ─── getCheckpointsForDateRange ──────────────────────────────────────

describe('getCheckpointsForDateRange', () => {
  it('returns checkpoints across date range', async () => {
    // Save a checkpoint for today
    await saveCheckpoint({
      description: 'Today work',
      workspace: tempDir
    });

    // Manually create a checkpoint for yesterday
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]!;
    const memoriesDir = getMemoriesDir(tempDir);
    const yesterdayDir = join(memoriesDir, yesterday);
    await mkdir(yesterdayDir, { recursive: true });

    const yesterdayContent = `---
id: checkpoint_yester01
timestamp: "${yesterday}T15:00:00.000Z"
tags:
  - old
---

Yesterday's work
`;
    await writeFile(join(yesterdayDir, '150000_yest.md'), yesterdayContent, 'utf-8');

    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDateRange(tempDir, yesterday, today);

    expect(checkpoints.length).toBeGreaterThanOrEqual(2);

    // Should contain both yesterday and today
    const descriptions = checkpoints.map(c => c.description);
    expect(descriptions).toContain("Yesterday's work");
    expect(descriptions).toContain('Today work');
  });

  it('filters by actual timestamp, not just directory date', async () => {
    // Create a date directory with a checkpoint that has a specific timestamp
    const date = '2026-01-15';
    const memoriesDir = getMemoriesDir(tempDir);
    const dateDir = join(memoriesDir, date);
    await mkdir(dateDir, { recursive: true });

    // Checkpoint at 10:00
    const content1 = `---
id: checkpoint_morning1
timestamp: "${date}T10:00:00.000Z"
---

Morning checkpoint
`;
    await writeFile(join(dateDir, '100000_morn.md'), content1, 'utf-8');

    // Checkpoint at 20:00
    const content2 = `---
id: checkpoint_evening1
timestamp: "${date}T20:00:00.000Z"
---

Evening checkpoint
`;
    await writeFile(join(dateDir, '200000_even.md'), content2, 'utf-8');

    // Query from 15:00 to 23:59 — should only get the evening checkpoint
    const checkpoints = await getCheckpointsForDateRange(
      tempDir,
      `${date}T15:00:00.000Z`,
      `${date}T23:59:59.999Z`
    );

    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.description).toBe('Evening checkpoint');
  });

  it('sorts chronologically across multiple days', async () => {
    const memoriesDir = getMemoriesDir(tempDir);

    // Create checkpoints across 3 days
    for (let day = 10; day <= 12; day++) {
      const date = `2026-01-${day}`;
      const dateDir = join(memoriesDir, date);
      await mkdir(dateDir, { recursive: true });

      const content = `---
id: checkpoint_day${day}abc
timestamp: "${date}T12:00:00.000Z"
---

Work on day ${day}
`;
      await writeFile(join(dateDir, `120000_day${day.toString().padStart(2, '0')}.md`), content, 'utf-8');
    }

    const checkpoints = await getCheckpointsForDateRange(
      tempDir,
      '2026-01-10',
      '2026-01-12'
    );

    expect(checkpoints).toHaveLength(3);
    // Verify chronological order
    for (let i = 1; i < checkpoints.length; i++) {
      const prev = new Date(checkpoints[i - 1]!.timestamp).getTime();
      const curr = new Date(checkpoints[i]!.timestamp).getTime();
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('returns empty array when no checkpoints in range', async () => {
    const checkpoints = await getCheckpointsForDateRange(
      tempDir,
      '2020-01-01',
      '2020-01-31'
    );
    expect(checkpoints).toEqual([]);
  });
});

// ─── getAllCheckpoints ────────────────────────────────────────────────

describe('getAllCheckpoints', () => {
  it('returns all checkpoints across date directories', async () => {
    const memoriesDir = getMemoriesDir(tempDir);

    const dates = ['2024-03-01', '2024-06-15', '2025-01-10'];
    for (const date of dates) {
      const dir = join(memoriesDir, date);
      await mkdir(dir, { recursive: true });
      const content = `---\nid: checkpoint_${date.replace(/-/g, '')}\ntimestamp: "${date}T12:00:00.000Z"\n---\n\nWork from ${date}\n`;
      await writeFile(join(dir, '120000_test.md'), content, 'utf-8');
    }

    const checkpoints = await getAllCheckpoints(tempDir);
    expect(checkpoints).toHaveLength(3);
    // Newest first
    expect(checkpoints[0]!.description).toBe('Work from 2025-01-10');
    expect(checkpoints[2]!.description).toBe('Work from 2024-03-01');
  });

  it('stops scanning once limit is reached', async () => {
    const memoriesDir = getMemoriesDir(tempDir);

    // Create 5 date dirs with 2 checkpoints each = 10 total
    for (let i = 1; i <= 5; i++) {
      const date = `2025-0${i}-01`;
      const dir = join(memoriesDir, date);
      await mkdir(dir, { recursive: true });
      for (let j = 1; j <= 2; j++) {
        const content = `---\nid: checkpoint_m${i}c${j}\ntimestamp: "${date}T${10 + j}:00:00.000Z"\n---\n\nMonth ${i} checkpoint ${j}\n`;
        await writeFile(join(dir, `${10 + j}0000_m${i}c${j}.md`), content, 'utf-8');
      }
    }

    const limited = await getAllCheckpoints(tempDir, 3);
    expect(limited).toHaveLength(3);
    // Should be the 3 newest (from May and April dirs)
    expect(limited[0]!.description).toBe('Month 5 checkpoint 2');
    expect(limited[1]!.description).toBe('Month 5 checkpoint 1');
    expect(limited[2]!.description).toBe('Month 4 checkpoint 2');
  });

  it('returns all when limit exceeds total count', async () => {
    const memoriesDir = getMemoriesDir(tempDir);

    const dir = join(memoriesDir, '2025-01-01');
    await mkdir(dir, { recursive: true });
    const content = `---\nid: checkpoint_only1\ntimestamp: "2025-01-01T12:00:00.000Z"\n---\n\nOnly checkpoint\n`;
    await writeFile(join(dir, '120000_only.md'), content, 'utf-8');

    const checkpoints = await getAllCheckpoints(tempDir, 100);
    expect(checkpoints).toHaveLength(1);
  });

  it('returns empty for project with no memories', async () => {
    const emptyDir = join(tmpdir(), `test-empty-${Date.now()}`);
    const checkpoints = await getAllCheckpoints(emptyDir);
    expect(checkpoints).toEqual([]);
  });
});

// ─── Auto-registration ──────────────────────────────────────────────

describe('Auto-registration', () => {
  it('registers project in registry after saving checkpoint', async () => {
    // Save a checkpoint to our temp directory
    await saveCheckpoint({
      description: 'Auto-register test',
      workspace: tempDir
    });

    // Give the fire-and-forget registration time to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Our test dir should be registered
    const projects = await listRegisteredProjects();
    const registered = projects.find(p => p.path === tempDir.replace(/\\/g, '/'));
    // ensureMemoriesDir was called in beforeEach, so .memories/ exists
    expect(registered).toBeDefined();
    expect(registered!.name).toBeTruthy();
  });
});
