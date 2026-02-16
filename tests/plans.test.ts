import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  savePlan,
  getPlan,
  getActivePlan,
  setActivePlan,
  listPlans,
  updatePlan,
  deletePlan,
  parsePlanFile,
  formatPlanFile
} from '../src/plans';
import { acquireLock } from '../src/lock';
import type { Plan, PlanInput } from '../src/types';
import { getPlansDir, ensureMemoriesDir } from '../src/workspace';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let TEST_DIR: string;

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-plans-'));
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('Plan file formatting', () => {
  it('formats plan with YAML frontmatter', () => {
    const plan: Plan = {
      id: 'test-plan',
      title: 'Test Plan',
      content: '## Goals\n- Goal 1\n- Goal 2',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T14:00:00.000Z',
      tags: ['test', 'example']
    };

    const formatted = formatPlanFile(plan);

    expect(formatted).toContain('---');
    expect(formatted).toContain('id: test-plan');
    expect(formatted).toContain('title: Test Plan');
    expect(formatted).toContain('status: active');
    expect(formatted).toContain('tags:');
    expect(formatted).toContain('  - test');
    expect(formatted).toContain('  - example');
    expect(formatted).toContain('## Goals');
  });

  it('formats plan with empty tags', () => {
    const plan: Plan = {
      id: 'simple',
      title: 'Simple',
      content: 'Content',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T10:00:00.000Z',
      tags: []
    };

    const formatted = formatPlanFile(plan);
    expect(formatted).toContain('tags: []');
  });

  it('ends with a trailing newline', () => {
    const plan: Plan = {
      id: 'newline-test',
      title: 'Newline Test',
      content: 'Content here',
      status: 'active',
      created: '2025-10-13T10:00:00.000Z',
      updated: '2025-10-13T10:00:00.000Z',
      tags: []
    };

    const formatted = formatPlanFile(plan);
    expect(formatted.endsWith('\n')).toBe(true);
  });
});

describe('Plan file parsing', () => {
  it('parses plan with YAML frontmatter', () => {
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

    const plan = parsePlanFile(content);

    expect(plan.id).toBe('auth-system');
    expect(plan.title).toBe('Authentication System Redesign');
    expect(plan.status).toBe('active');
    expect(plan.tags).toEqual(['backend', 'security']);
    expect(plan.content).toContain('## Goals');
    expect(plan.content).toContain('## Progress');
  });

  it('handles plan with empty tags', () => {
    const content = `---
id: test
title: Test
status: active
created: 2025-10-13T10:00:00.000Z
updated: 2025-10-13T10:00:00.000Z
tags: []
---

Content here.`;

    const plan = parsePlanFile(content);
    expect(plan.tags).toEqual([]);
  });

  it('throws on invalid YAML', () => {
    const content = `---
invalid yaml {{{
---
Content`;

    expect(() => parsePlanFile(content)).toThrow();
  });

  it('throws on missing frontmatter', () => {
    const content = 'Just content, no frontmatter';
    expect(() => parsePlanFile(content)).toThrow();
  });

  it('handles CRLF line endings (Windows git checkout)', () => {
    const content = "---\r\nid: crlf-plan\r\ntitle: CRLF Plan\r\nstatus: active\r\ncreated: \"2026-02-14T10:00:00.000Z\"\r\nupdated: \"2026-02-14T10:00:00.000Z\"\r\ntags:\r\n  - windows\r\n---\r\n\r\nPlan with Windows line endings.\r\n";

    const plan = parsePlanFile(content);

    expect(plan.id).toBe('crlf-plan');
    expect(plan.title).toBe('CRLF Plan');
    expect(plan.status).toBe('active');
    expect(plan.content).toBe('Plan with Windows line endings.');
  });

  it('parses plan with single newline between frontmatter and body', () => {
    const content = `---
id: single-newline
title: Single Newline
status: active
created: "2026-02-14T10:00:00.000Z"
updated: "2026-02-14T10:00:00.000Z"
tags: []
---
Content with single newline separator.`;

    const plan = parsePlanFile(content);
    expect(plan.id).toBe('single-newline');
    expect(plan.content).toBe('Content with single newline separator.');
  });

  it('strips BOM from plan files (Windows Notepad)', () => {
    const content = `\uFEFF---
id: bom-plan
title: BOM Plan
status: active
created: "2026-02-14T10:00:00.000Z"
updated: "2026-02-14T10:00:00.000Z"
tags: []
---

Plan with BOM.`;

    const plan = parsePlanFile(content);
    expect(plan.id).toBe('bom-plan');
    expect(plan.content).toBe('Plan with BOM.');
  });
});

describe('Plan storage', () => {
  it('saves plan with auto-generated ID', async () => {
    const input: PlanInput = {
      title: 'Test Plan',
      content: 'Plan content',
      workspace: TEST_DIR
    };

    const plan = await savePlan(input);

    expect(plan.id).toBeTruthy();
    expect(plan.title).toBe('Test Plan');
    expect(plan.content).toBe('Plan content');
    expect(plan.status).toBe('active');  // Default status
  });

  it('uses fallback ID when title sanitizes to empty', async () => {
    const plan = await savePlan({
      title: '!!!',
      content: 'Content',
      workspace: TEST_DIR
    });

    expect(plan.id).toBeTruthy();
    expect(plan.id.startsWith('plan-')).toBe(true);
    expect(plan.id).toMatch(/^[a-z0-9-]+$/);

    const plans = await listPlans(TEST_DIR);
    expect(plans.map(p => p.id)).toContain(plan.id);
  });

  it('saves plan with provided ID', async () => {
    const input: PlanInput = {
      id: 'custom-id',
      title: 'Custom ID Plan',
      content: 'Content',
      workspace: TEST_DIR
    };

    const plan = await savePlan(input);
    expect(plan.id).toBe('custom-id');
  });

  it('creates plan file in plans/ directory', async () => {
    const input: PlanInput = {
      id: 'test-plan',
      title: 'Test',
      content: 'Content',
      workspace: TEST_DIR
    };

    await savePlan(input);

    const planPath = join(
      getPlansDir(TEST_DIR),
      'test-plan.md'
    );

    const exists = await Bun.file(planPath).exists();
    expect(exists).toBe(true);
  });

  it('throws if plan with same ID already exists', async () => {
    await savePlan({
      id: 'duplicate',
      title: 'First',
      content: 'Content',
      workspace: TEST_DIR
    });

    await expect(
      savePlan({
        id: 'duplicate',
        title: 'Second',
        content: 'Content',
        workspace: TEST_DIR
      })
    ).rejects.toThrow();
  });

  it('sets default status to active', async () => {
    const plan = await savePlan({
      title: 'Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    expect(plan.status).toBe('active');
  });

  it('allows custom status', async () => {
    const plan = await savePlan({
      title: 'Test',
      content: 'Content',
      status: 'completed',
      workspace: TEST_DIR
    });

    expect(plan.status).toBe('completed');
  });

  it('uses atomic write (no leftover .tmp files)', async () => {
    await savePlan({
      id: 'atomic-test',
      title: 'Atomic Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    const { readdir } = await import('fs/promises');
    const plansDir = getPlansDir(TEST_DIR);
    const files = await readdir(plansDir);
    const tmpFiles = files.filter(f => f.includes('.tmp'));

    expect(tmpFiles).toEqual([]);
  });

  it('saves plan file with trailing newline', async () => {
    await savePlan({
      id: 'newline-test',
      title: 'Newline Test',
      content: 'Content',
      workspace: TEST_DIR
    });

    const { readFile } = await import('fs/promises');
    const planPath = join(getPlansDir(TEST_DIR), 'newline-test.md');
    const content = await readFile(planPath, 'utf-8');

    expect(content.endsWith('\n')).toBe(true);
  });
});

describe('Plan retrieval', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'plan-1',
      title: 'First Plan',
      content: 'Content 1',
      workspace: TEST_DIR
    });

    await savePlan({
      id: 'plan-2',
      title: 'Second Plan',
      content: 'Content 2',
      workspace: TEST_DIR
    });
  });

  it('gets plan by ID', async () => {
    const plan = await getPlan(TEST_DIR, 'plan-1');

    expect(plan).toBeTruthy();
    expect(plan!.id).toBe('plan-1');
    expect(plan!.title).toBe('First Plan');
  });

  it('returns null for non-existent plan', async () => {
    const plan = await getPlan(TEST_DIR, 'nonexistent');
    expect(plan).toBeNull();
  });

  it('lists all plans in workspace', async () => {
    const plans = await listPlans(TEST_DIR);

    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id)).toContain('plan-1');
    expect(plans.map(p => p.id)).toContain('plan-2');
  });

  it('sorts plans by updated date (newest first)', async () => {
    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update plan-1 to make it newer
    await updatePlan(TEST_DIR, 'plan-1', {
      content: 'Updated content'
    });

    const plans = await listPlans(TEST_DIR);

    expect(plans[0]!.id).toBe('plan-1');  // Most recently updated
    expect(plans[1]!.id).toBe('plan-2');
  });

  it('returns empty array when no plans exist', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'test-empty-'));
    await ensureMemoriesDir(emptyDir);

    const plans = await listPlans(emptyDir);
    expect(plans).toEqual([]);

    await rm(emptyDir, { recursive: true, force: true });
  });
});

describe('Active plan management', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'plan-1',
      title: 'First Plan',
      content: 'Content',
      workspace: TEST_DIR
    });

    await savePlan({
      id: 'plan-2',
      title: 'Second Plan',
      content: 'Content',
      workspace: TEST_DIR
    });
  });

  it('sets active plan', async () => {
    await setActivePlan(TEST_DIR, 'plan-1');

    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan?.id).toBe('plan-1');
  });

  it('switches active plan', async () => {
    await setActivePlan(TEST_DIR, 'plan-1');
    await setActivePlan(TEST_DIR, 'plan-2');

    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan?.id).toBe('plan-2');
  });

  it('returns null when no active plan set', async () => {
    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan).toBeNull();
  });

  it('throws when setting non-existent plan as active', async () => {
    await expect(
      setActivePlan(TEST_DIR, 'nonexistent')
    ).rejects.toThrow();
  });

  it('auto-activates plan when activate flag is true', async () => {
    await savePlan({
      id: 'auto-active',
      title: 'Auto Active Plan',
      content: 'Content',
      workspace: TEST_DIR,
      activate: true
    });

    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan?.id).toBe('auto-active');
  });

  it('does not auto-activate when activate flag is false', async () => {
    await savePlan({
      id: 'not-active',
      title: 'Not Active Plan',
      content: 'Content',
      workspace: TEST_DIR,
      activate: false
    });

    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan).toBeNull();
  });
});

describe('Plan updates', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'test-plan',
      title: 'Original Title',
      content: 'Original content',
      tags: ['original'],
      workspace: TEST_DIR
    });
  });

  it('updates plan title', async () => {
    await updatePlan(TEST_DIR, 'test-plan', {
      title: 'New Title'
    });

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan!.title).toBe('New Title');
    expect(plan!.content).toBe('Original content');  // Unchanged
  });

  it('updates plan content', async () => {
    await updatePlan(TEST_DIR, 'test-plan', {
      content: 'New content'
    });

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan!.content).toBe('New content');
    expect(plan!.title).toBe('Original Title');  // Unchanged
  });

  it('updates plan status', async () => {
    await updatePlan(TEST_DIR, 'test-plan', {
      status: 'completed'
    });

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan!.status).toBe('completed');
  });

  it('updates plan tags', async () => {
    await updatePlan(TEST_DIR, 'test-plan', {
      tags: ['new', 'tags']
    });

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan!.tags).toEqual(['new', 'tags']);
  });

  it('updates multiple fields at once', async () => {
    await updatePlan(TEST_DIR, 'test-plan', {
      title: 'Updated Title',
      content: 'Updated content',
      status: 'archived',
      tags: ['updated']
    });

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan!.title).toBe('Updated Title');
    expect(plan!.content).toBe('Updated content');
    expect(plan!.status).toBe('archived');
    expect(plan!.tags).toEqual(['updated']);
  });

  it('updates the updated timestamp', async () => {
    const originalPlan = await getPlan(TEST_DIR, 'test-plan');
    const originalUpdated = originalPlan!.updated;

    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    await updatePlan(TEST_DIR, 'test-plan', {
      content: 'New content'
    });

    const updatedPlan = await getPlan(TEST_DIR, 'test-plan');
    expect(updatedPlan!.updated).not.toBe(originalUpdated);
    expect(new Date(updatedPlan!.updated).getTime())
      .toBeGreaterThan(new Date(originalUpdated).getTime());
  });

  it('throws when updating non-existent plan', async () => {
    await expect(
      updatePlan(TEST_DIR, 'nonexistent', { title: 'New' })
    ).rejects.toThrow();
  });
});

describe('Plan deletion', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Content',
      workspace: TEST_DIR
    });
  });

  it('deletes plan file', async () => {
    await deletePlan(TEST_DIR, 'test-plan');

    const plan = await getPlan(TEST_DIR, 'test-plan');
    expect(plan).toBeNull();
  });

  it('clears active plan if deleted plan was active', async () => {
    await setActivePlan(TEST_DIR, 'test-plan');
    await deletePlan(TEST_DIR, 'test-plan');

    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan).toBeNull();
  });

  it('does not affect other plans', async () => {
    await savePlan({
      id: 'other-plan',
      title: 'Other',
      content: 'Content',
      workspace: TEST_DIR
    });

    await deletePlan(TEST_DIR, 'test-plan');

    const otherPlan = await getPlan(TEST_DIR, 'other-plan');
    expect(otherPlan).toBeTruthy();
  });

  it('waits for in-flight updates before deleting plan', async () => {
    const planPath = join(
      getPlansDir(TEST_DIR),
      'test-plan.md'
    );

    const release = await acquireLock(planPath);
    const deletePromise = deletePlan(TEST_DIR, 'test-plan');

    // Allow deletePlan to attempt deletion while lock is held
    await new Promise(resolve => setTimeout(resolve, 20));
    const existsDuringLock = await Bun.file(planPath).exists();
    expect(existsDuringLock).toBe(true);

    await release();
    await deletePromise;

    const existsAfterDelete = await Bun.file(planPath).exists();
    expect(existsAfterDelete).toBe(false);
  });

  it('throws when deleting non-existent plan', async () => {
    await expect(
      deletePlan(TEST_DIR, 'nonexistent')
    ).rejects.toThrow();
  });

  it('does not clear active plan if a different plan was activated after read', async () => {
    // Set test-plan as active, then create another plan
    await setActivePlan(TEST_DIR, 'test-plan');
    await savePlan({
      id: 'other-plan',
      title: 'Other Plan',
      content: 'Content',
      workspace: TEST_DIR
    });
    // Switch active to other-plan, then delete test-plan
    await setActivePlan(TEST_DIR, 'other-plan');
    await deletePlan(TEST_DIR, 'test-plan');

    // other-plan should still be active (not cleared by deleting test-plan)
    const activePlan = await getActivePlan(TEST_DIR);
    expect(activePlan?.id).toBe('other-plan');
  });
});
