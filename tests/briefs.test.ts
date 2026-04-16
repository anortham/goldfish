import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  saveBrief,
  getBrief,
  getActiveBrief,
  setActiveBrief,
  listBriefs,
  updateBrief,
  deleteBrief,
  parseBriefFile,
  formatBriefFile
} from '../src/briefs';
import { acquireLock } from '../src/lock';
import type { Brief, BriefInput } from '../src/types';
import { getBriefsDir, getPlansDir, ensureMemoriesDir } from '../src/workspace';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_DIR: string;

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-briefs-'));
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('Brief file formatting', () => {
  it('formats brief with YAML frontmatter', () => {
    const brief: Brief = {
      id: 'test-brief',
      title: 'Test Brief',
      content: '## Goals\n- Goal 1\n- Goal 2',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T14:00:00.000Z',
      tags: ['test', 'example']
    };

    const formatted = formatBriefFile(brief);

    expect(formatted).toContain('---');
    expect(formatted).toContain('id: test-brief');
    expect(formatted).toContain('title: Test Brief');
    expect(formatted).toContain('status: active');
    expect(formatted).toContain('tags:');
    expect(formatted).toContain('  - test');
    expect(formatted).toContain('  - example');
    expect(formatted).toContain('## Goals');
  });

  it('formats brief with empty tags', () => {
    const brief: Brief = {
      id: 'simple',
      title: 'Simple',
      content: 'Content',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T10:00:00.000Z',
      tags: []
    };

    const formatted = formatBriefFile(brief);
    expect(formatted).toContain('tags: []');
  });

  it('ends with a trailing newline', () => {
    const brief: Brief = {
      id: 'newline-test',
      title: 'Newline Test',
      content: 'Content here',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T10:00:00.000Z',
      tags: []
    };

    const formatted = formatBriefFile(brief);
    expect(formatted.endsWith('\n')).toBe(true);
  });
});

describe('Brief file parsing', () => {
  it('parses brief with YAML frontmatter', () => {
    const content = `---
id: auth-system
title: Authentication System Redesign
status: active
created: 2025-10-13T09:00:00.000Z
updated: 2025-10-13T16:45:00.000Z
tags:
  - backend
  - security
---

## Goals
- Implement JWT with refresh tokens
- Add OAuth2 support

## Progress
- [x] JWT refresh working
- [ ] OAuth2 integration`;

    const brief = parseBriefFile(content);

    expect(brief.id).toBe('auth-system');
    expect(brief.title).toBe('Authentication System Redesign');
    expect(brief.status).toBe('active');
    expect(brief.tags).toEqual(['backend', 'security']);
    expect(brief.content).toContain('## Goals');
    expect(brief.content).toContain('## Progress');
  });

  it('handles brief with empty tags', () => {
    const content = `---
id: test
title: Test
status: active
created: 2025-10-13T10:00:00.000Z
updated: 2025-10-13T10:00:00.000Z
tags: []
---

Content here.`;

    const brief = parseBriefFile(content);
    expect(brief.tags).toEqual([]);
  });

  it('throws on invalid YAML', () => {
    const content = `---
invalid yaml {{{
---
Content`;

    expect(() => parseBriefFile(content)).toThrow();
  });

  it('throws on missing frontmatter', () => {
    const content = 'Just content, no frontmatter';
    expect(() => parseBriefFile(content)).toThrow();
  });

  it('handles CRLF line endings (Windows git checkout)', () => {
    const content = "---\r\nid: crlf-brief\r\ntitle: CRLF Brief\r\nstatus: active\r\ncreated: \"2026-02-14T10:00:00.000Z\"\r\nupdated: \"2026-02-14T10:00:00.000Z\"\r\ntags:\r\n  - windows\r\n---\r\n\r\nBrief with Windows line endings.\r\n";

    const brief = parseBriefFile(content);

    expect(brief.id).toBe('crlf-brief');
    expect(brief.title).toBe('CRLF Brief');
    expect(brief.status).toBe('active');
    expect(brief.content).toBe('Brief with Windows line endings.');
  });

  it('parses brief with single newline between frontmatter and body', () => {
    const content = `---
id: single-newline
title: Single Newline
status: active
created: "2026-02-14T10:00:00.000Z"
updated: "2026-02-14T10:00:00.000Z"
tags: []
---
Content with single newline separator.`;

    const brief = parseBriefFile(content);
    expect(brief.id).toBe('single-newline');
    expect(brief.content).toBe('Content with single newline separator.');
  });

  it('strips BOM from brief files (Windows Notepad)', () => {
    const content = `\uFEFF---
id: bom-brief
title: BOM Brief
status: active
created: "2026-02-14T10:00:00.000Z"
updated: "2026-02-14T10:00:00.000Z"
tags: []
---

Brief with BOM.`;

    const brief = parseBriefFile(content);
    expect(brief.id).toBe('bom-brief');
    expect(brief.content).toBe('Brief with BOM.');
  });
});

describe('Brief ID sanitization', () => {
  it('rejects brief IDs that escape the briefs directory (path traversal)', async () => {
    await expect(
      saveBrief({
        id: '../../etc/passwd',
        title: 'Escape attempt',
        content: 'Content',
        workspace: TEST_DIR
      })
    ).rejects.toThrow(/invalid.*brief.*id/i);
  });

  it('rejects brief IDs with embedded path separators', async () => {
    await expect(
      saveBrief({
        id: 'foo/bar',
        title: 'Separator in ID',
        content: 'Content',
        workspace: TEST_DIR
      })
    ).rejects.toThrow(/invalid.*brief.*id/i);
  });

  it('rejects brief IDs with backslash separators', async () => {
    await expect(
      saveBrief({
        id: 'foo\\bar',
        title: 'Backslash in ID',
        content: 'Content',
        workspace: TEST_DIR
      })
    ).rejects.toThrow(/invalid.*brief.*id/i);
  });

  it('allows normal brief IDs', async () => {
    const brief = await saveBrief({
      id: 'my-valid-brief-123',
      title: 'Valid Brief',
      content: 'Content',
      workspace: TEST_DIR
    });
    expect(brief.id).toBe('my-valid-brief-123');
  });
});

describe('Brief save locking (TOCTOU)', () => {
  it('prevents concurrent saves with the same ID', async () => {
    const results = await Promise.allSettled([
      saveBrief({ id: 'race-test', title: 'First', content: 'A', workspace: TEST_DIR }),
      saveBrief({ id: 'race-test', title: 'Second', content: 'B', workspace: TEST_DIR })
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});

describe('Brief storage', () => {
  it('saveBrief writes to briefs storage', async () => {
    const brief = await saveBrief({
      id: 'brief-id',
      title: 'Brief Title',
      content: 'Brief content',
      workspace: TEST_DIR
    });

    const briefPath = join(getBriefsDir(TEST_DIR), 'brief-id.md');

    expect(brief.id).toBe('brief-id');
    expect(await Bun.file(briefPath).exists()).toBe(true);
  });

  it('saves brief with auto-generated ID', async () => {
    const input: BriefInput = {
      title: 'Test Brief',
      content: 'Brief content',
      workspace: TEST_DIR
    };

    const brief = await saveBrief(input);

    expect(brief.id).toBeTruthy();
    expect(brief.title).toBe('Test Brief');
    expect(brief.content).toBe('Brief content');
    expect(brief.status).toBe('active');  // Default status
  });

  it('uses fallback ID when title sanitizes to empty', async () => {
    const brief = await saveBrief({
      title: '!!!',
      content: 'Content',
      workspace: TEST_DIR
    });

    expect(brief.id).toBeTruthy();
    expect(brief.id.startsWith('brief-')).toBe(true);
    expect(brief.id).toMatch(/^[a-z0-9-]+$/);

    const briefs = await listBriefs(TEST_DIR);
    expect(briefs.map(b => b.id)).toContain(brief.id);
  });

  it('saves brief with provided ID', async () => {
    const input: BriefInput = {
      id: 'custom-id',
      title: 'Custom ID Brief',
      content: 'Content',
      workspace: TEST_DIR
    };

    const brief = await saveBrief(input);
    expect(brief.id).toBe('custom-id');
  });

  it('creates new brief writes in briefs/ directory', async () => {
    const input: BriefInput = {
      id: 'test-brief',
      title: 'Test',
      content: 'Content',
      workspace: TEST_DIR
    };

    await saveBrief(input);

    const briefPath = join(getBriefsDir(TEST_DIR), 'test-brief.md');

    const exists = await Bun.file(briefPath).exists();
    expect(exists).toBe(true);
  });

  it('throws if brief with same ID already exists', async () => {
    await saveBrief({
      id: 'duplicate',
      title: 'First',
      content: 'Content',
      workspace: TEST_DIR
    });

    await expect(
      saveBrief({
        id: 'duplicate',
        title: 'Second',
        content: 'Content',
        workspace: TEST_DIR
      })
    ).rejects.toThrow();
  });

  it('sets default status to active', async () => {
    const brief = await saveBrief({
      title: 'Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    expect(brief.status).toBe('active');
  });

  it('allows custom status', async () => {
    const brief = await saveBrief({
      title: 'Test',
      content: 'Content',
      status: 'completed',
      workspace: TEST_DIR
    });

    expect(brief.status).toBe('completed');
  });

  it('rejects invalid status at save time', async () => {
    await expect(
      saveBrief({
        title: 'Bad Status Brief',
        content: 'Content',
        status: 'banana' as any,
        workspace: TEST_DIR
      })
    ).rejects.toThrow(/invalid.*status/i);
  });

  it('uses atomic write (no leftover .tmp files)', async () => {
    await saveBrief({
      id: 'atomic-test',
      title: 'Atomic Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    const { readdir } = await import('fs/promises');
    const briefsDir = getBriefsDir(TEST_DIR);
    const files = await readdir(briefsDir);
    const tmpFiles = files.filter(f => f.includes('.tmp'));

    expect(tmpFiles).toEqual([]);
  });

  it('saves brief file with trailing newline', async () => {
    await saveBrief({
      id: 'newline-test',
      title: 'Newline Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    const { readFile } = await import('fs/promises');
    const briefPath = join(getBriefsDir(TEST_DIR), 'newline-test.md');
    const content = await readFile(briefPath, 'utf-8');

    expect(content.endsWith('\n')).toBe(true);
  });
});

describe('Brief retrieval', () => {
  beforeEach(async () => {
    await saveBrief({
      id: 'brief-1',
      title: 'First Brief',
      content: 'Content 1',
      workspace: TEST_DIR
    });

    await saveBrief({
      id: 'brief-2',
      title: 'Second Brief',
      content: 'Content 2',
      workspace: TEST_DIR
    });
  });

  it('gets brief by ID', async () => {
    const brief = await getBrief(TEST_DIR, 'brief-1');

    expect(brief).toBeTruthy();
    expect(brief!.id).toBe('brief-1');
    expect(brief!.title).toBe('First Brief');
  });

  it('returns null for non-existent brief', async () => {
    const brief = await getBrief(TEST_DIR, 'nonexistent');
    expect(brief).toBeNull();
  });

  it('reads legacy plan files from .memories/plans/', async () => {
    const legacyDir = getPlansDir(TEST_DIR);
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      join(legacyDir, 'legacy-brief.md'),
      `---
id: legacy-brief
title: Legacy Brief
status: active
created: 2026-04-16T10:00:00.000Z
updated: 2026-04-16T10:00:00.000Z
tags: []
---

Legacy content
`,
      'utf-8'
    );

    const brief = await getBrief(TEST_DIR, 'legacy-brief');
    expect(brief?.title).toBe('Legacy Brief');
    expect(brief?.content).toBe('Legacy content');
  });

  it('lists all briefs in workspace', async () => {
    const briefs = await listBriefs(TEST_DIR);

    expect(briefs).toHaveLength(2);
    expect(briefs.map(b => b.id)).toContain('brief-1');
    expect(briefs.map(b => b.id)).toContain('brief-2');
  });

  it('sorts briefs by updated date (newest first)', async () => {
    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update brief-1 to make it newer
    await updateBrief(TEST_DIR, 'brief-1', {
      content: 'Updated content'
    });

    const briefs = await listBriefs(TEST_DIR);

    expect(briefs[0]!.id).toBe('brief-1');  // Most recently updated
    expect(briefs[1]!.id).toBe('brief-2');
  });

  it('returns empty array when no briefs exist', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'test-empty-'));
    await ensureMemoriesDir(emptyDir);

    const briefs = await listBriefs(emptyDir);
    expect(briefs).toEqual([]);

    await rm(emptyDir, { recursive: true, force: true });
  });
});

describe('Active brief management', () => {
  beforeEach(async () => {
    await saveBrief({
      id: 'brief-1',
      title: 'First Brief',
      content: 'Content',
      workspace: TEST_DIR,
      activate: false
    });

    await saveBrief({
      id: 'brief-2',
      title: 'Second Brief',
      content: 'Content',
      workspace: TEST_DIR,
      activate: false
    });
  });

  it('sets active brief', async () => {
    await setActiveBrief(TEST_DIR, 'brief-1');

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('brief-1');
  });

  it('writes new active marker to .active-brief', async () => {
    await setActiveBrief(TEST_DIR, 'brief-1');

    const activeMarker = join(TEST_DIR, '.memories', '.active-brief');
    expect(await Bun.file(activeMarker).text()).toBe('brief-1');
  });

  it('switches active brief', async () => {
    await setActiveBrief(TEST_DIR, 'brief-1');
    await setActiveBrief(TEST_DIR, 'brief-2');

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('brief-2');
  });

  it('returns null when no active brief set', async () => {
    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief).toBeNull();
  });

  it('falls back to legacy .active-plan marker', async () => {
    await writeFile(join(TEST_DIR, '.memories', '.active-plan'), 'brief-2', 'utf-8');

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('brief-2');
  });

  it('returns null when active brief has status completed', async () => {
    await setActiveBrief(TEST_DIR, 'brief-1');
    await updateBrief(TEST_DIR, 'brief-1', { status: 'completed' });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief).toBeNull();
  });

  it('returns null when active brief has status archived', async () => {
    await setActiveBrief(TEST_DIR, 'brief-1');
    await updateBrief(TEST_DIR, 'brief-1', { status: 'archived' });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief).toBeNull();
  });

  it('throws when setting non-existent brief as active', async () => {
    await expect(
      setActiveBrief(TEST_DIR, 'nonexistent')
    ).rejects.toThrow();
  });

  it('rejects activating a completed brief', async () => {
    await updateBrief(TEST_DIR, 'brief-1', { status: 'completed' });

    await expect(
      setActiveBrief(TEST_DIR, 'brief-1')
    ).rejects.toThrow(/cannot activate.*completed/i);
  });

  it('auto-activates brief when activate flag is true', async () => {
    await saveBrief({
      id: 'auto-active',
      title: 'Auto Active Brief',
      content: 'Content',
      workspace: TEST_DIR,
      activate: true
    });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('auto-active');
  });

  it('auto-activates brief when activate is omitted', async () => {
    await saveBrief({
      id: 'default-active',
      title: 'Default Active Brief',
      content: 'Content',
      workspace: TEST_DIR
    });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('default-active');
  });

  it('does not auto-activate when activate flag is false', async () => {
    await saveBrief({
      id: 'not-active',
      title: 'Not Active Brief',
      content: 'Content',
      workspace: TEST_DIR,
      activate: false
    });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief).toBeNull();
  });

  it('does not replace the active brief when saving a completed brief without activate', async () => {
    await saveBrief({
      id: 'current-active',
      title: 'Current Active Brief',
      content: 'Content',
      workspace: TEST_DIR
    });

    await saveBrief({
      id: 'completed-brief',
      title: 'Completed Brief',
      content: 'Content',
      status: 'completed',
      workspace: TEST_DIR
    });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('current-active');
  });

  it('does not replace the active brief when saving an archived brief without activate', async () => {
    await saveBrief({
      id: 'current-active',
      title: 'Current Active Brief',
      content: 'Content',
      workspace: TEST_DIR
    });

    await saveBrief({
      id: 'archived-brief',
      title: 'Archived Brief',
      content: 'Content',
      status: 'archived',
      workspace: TEST_DIR
    });

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('current-active');
  });
});

describe('Brief updates', () => {
  beforeEach(async () => {
    await saveBrief({
      id: 'test-brief',
      title: 'Original Title',
      content: 'Original content',
      tags: ['original'],
      workspace: TEST_DIR
    });
  });

  it('updates brief title', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      title: 'New Title'
    });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.title).toBe('New Title');
    expect(brief!.content).toBe('Original content');  // Unchanged
  });

  it('updates brief content', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      content: 'New content'
    });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.content).toBe('New content');
    expect(brief!.title).toBe('Original Title');  // Unchanged
  });

  it('updates brief status', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      status: 'completed'
    });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.status).toBe('completed');
  });

  it('rejects invalid status during update', async () => {
    await expect(
      updateBrief(TEST_DIR, 'test-brief', {
        status: 'banana' as any
      })
    ).rejects.toThrow(/invalid.*status/i);
  });

  it('checks all unchecked boxes when status transitions to completed', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      content: '## Tasks\n- [ ] First task\n- [x] Already done\n- [ ] Third task'
    });

    await updateBrief(TEST_DIR, 'test-brief', { status: 'completed' });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.content).toBe('## Tasks\n- [x] First task\n- [x] Already done\n- [x] Third task');
  });

  it('does not modify checkboxes when status is not completed', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      content: '## Tasks\n- [ ] Incomplete task'
    });

    await updateBrief(TEST_DIR, 'test-brief', { status: 'archived' });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.content).toBe('## Tasks\n- [ ] Incomplete task');
  });

  it('updates brief tags', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      tags: ['new', 'tags']
    });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.tags).toEqual(['new', 'tags']);
  });

  it('updates multiple fields at once', async () => {
    await updateBrief(TEST_DIR, 'test-brief', {
      title: 'Updated Title',
      content: 'Updated content',
      status: 'archived',
      tags: ['updated']
    });

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief!.title).toBe('Updated Title');
    expect(brief!.content).toBe('Updated content');
    expect(brief!.status).toBe('archived');
    expect(brief!.tags).toEqual(['updated']);
  });

  it('updates the updated timestamp', async () => {
    const originalBrief = await getBrief(TEST_DIR, 'test-brief');
    const originalUpdated = originalBrief!.updated;

    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    await updateBrief(TEST_DIR, 'test-brief', {
      content: 'New content'
    });

    const updatedBrief = await getBrief(TEST_DIR, 'test-brief');
    expect(updatedBrief!.updated).not.toBe(originalUpdated);
    expect(new Date(updatedBrief!.updated).getTime())
      .toBeGreaterThan(new Date(originalUpdated).getTime());
  });

  it('throws when updating non-existent brief', async () => {
    await expect(
      updateBrief(TEST_DIR, 'nonexistent', { title: 'New' })
    ).rejects.toThrow();
  });
});

describe('Brief deletion', () => {
  beforeEach(async () => {
    await saveBrief({
      id: 'test-brief',
      title: 'Test Brief',
      content: 'Content',
      workspace: TEST_DIR
    });
  });

  it('deletes brief file', async () => {
    await deleteBrief(TEST_DIR, 'test-brief');

    const brief = await getBrief(TEST_DIR, 'test-brief');
    expect(brief).toBeNull();
  });

  it('clears active brief if deleted brief was active', async () => {
    await setActiveBrief(TEST_DIR, 'test-brief');
    await deleteBrief(TEST_DIR, 'test-brief');

    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief).toBeNull();
  });

  it('does not affect other briefs', async () => {
    await saveBrief({
      id: 'other-brief',
      title: 'Other',
      content: 'Content',
      workspace: TEST_DIR
    });

    await deleteBrief(TEST_DIR, 'test-brief');

    const otherBrief = await getBrief(TEST_DIR, 'other-brief');
    expect(otherBrief).toBeTruthy();
  });

  it('waits for in-flight updates before deleting brief', async () => {
    const briefPath = join(getBriefsDir(TEST_DIR), 'test-brief.md');

    const release = await acquireLock(briefPath);
    const deletePromise = deleteBrief(TEST_DIR, 'test-brief');

    // Allow deleteBrief to attempt deletion while lock is held
    await new Promise(resolve => setTimeout(resolve, 20));
    const existsDuringLock = await Bun.file(briefPath).exists();
    expect(existsDuringLock).toBe(true);

    await release();
    await deletePromise;

    const existsAfterDelete = await Bun.file(briefPath).exists();
    expect(existsAfterDelete).toBe(false);
  });

  it('throws when deleting non-existent brief', async () => {
    await expect(
      deleteBrief(TEST_DIR, 'nonexistent')
    ).rejects.toThrow();
  });

  it('does not clear active brief if a different brief was activated after read', async () => {
    // Set test-brief as active, then create another brief
    await setActiveBrief(TEST_DIR, 'test-brief');
    await saveBrief({
      id: 'other-brief',
      title: 'Other Brief',
      content: 'Content',
      workspace: TEST_DIR
    });
    // Switch active to other-brief, then delete test-brief
    await setActiveBrief(TEST_DIR, 'other-brief');
    await deleteBrief(TEST_DIR, 'test-brief');

    // other-brief should still be active (not cleared by deleting test-brief)
    const activeBrief = await getActiveBrief(TEST_DIR);
    expect(activeBrief?.id).toBe('other-brief');
  });

  it('concurrent setActiveBrief and deleteBrief do not lose the new active brief', async () => {
    // Create brief-a (will be deleted) and brief-b (will become active)
    await saveBrief({ id: 'brief-a', title: 'A', content: 'A', workspace: TEST_DIR, activate: true });
    await saveBrief({ id: 'brief-b', title: 'B', content: 'B', workspace: TEST_DIR });

    // Run deleteBrief(brief-a) and setActiveBrief(brief-b) concurrently.
    // Without locking on .active-brief, deleteBrief can read "brief-a",
    // then setActiveBrief writes "brief-b", then deleteBrief unlinks .active-brief,
    // losing brief-b's activation.
    //
    // Run multiple times to increase chance of triggering the race.
    for (let i = 0; i < 10; i++) {
      // Reset state: recreate brief-a, set it active
      await saveBrief({ id: `race-del-${i}`, title: 'Del', content: 'Del', workspace: TEST_DIR, activate: true });
      await saveBrief({ id: `race-keep-${i}`, title: 'Keep', content: 'Keep', workspace: TEST_DIR });

      // Race: delete the active brief while switching active to the other
      await Promise.all([
        deleteBrief(TEST_DIR, `race-del-${i}`),
        setActiveBrief(TEST_DIR, `race-keep-${i}`)
      ]);

      const active = await getActiveBrief(TEST_DIR);
      expect(active?.id).toBe(`race-keep-${i}`);
    }
  });
});
