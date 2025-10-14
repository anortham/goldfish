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
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { rm } from 'fs/promises';
import { join } from 'path';

const TEST_WORKSPACE = `test-plans-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  const workspacePath = getWorkspacePath(TEST_WORKSPACE);
  await rm(workspacePath, { recursive: true, force: true });
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
});

describe('Plan storage', () => {
  it('saves plan with auto-generated ID', async () => {
    const input: PlanInput = {
      title: 'Test Plan',
      content: 'Plan content',
      workspace: TEST_WORKSPACE
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
      workspace: TEST_WORKSPACE
    });

    expect(plan.id).toBeTruthy();
    expect(plan.id.startsWith('plan-')).toBe(true);
    expect(plan.id).toMatch(/^[a-z0-9-]+$/);

    const plans = await listPlans(TEST_WORKSPACE);
    expect(plans.map(p => p.id)).toContain(plan.id);
  });

  it('saves plan with provided ID', async () => {
    const input: PlanInput = {
      id: 'custom-id',
      title: 'Custom ID Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE
    };

    const plan = await savePlan(input);
    expect(plan.id).toBe('custom-id');
  });

  it('creates plan file in plans/ directory', async () => {
    const input: PlanInput = {
      id: 'test-plan',
      title: 'Test',
      content: 'Content',
      workspace: TEST_WORKSPACE
    };

    await savePlan(input);

    const planPath = join(
      getWorkspacePath(TEST_WORKSPACE),
      'plans',
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
      workspace: TEST_WORKSPACE
    });

    await expect(
      savePlan({
        id: 'duplicate',
        title: 'Second',
        content: 'Content',
        workspace: TEST_WORKSPACE
      })
    ).rejects.toThrow();
  });

  it('sets default status to active', async () => {
    const plan = await savePlan({
      title: 'Test',
      content: 'Content',
      workspace: TEST_WORKSPACE
    });

    expect(plan.status).toBe('active');
  });

  it('allows custom status', async () => {
    const plan = await savePlan({
      title: 'Test',
      content: 'Content',
      status: 'completed',
      workspace: TEST_WORKSPACE
    });

    expect(plan.status).toBe('completed');
  });
});

describe('Plan retrieval', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'plan-1',
      title: 'First Plan',
      content: 'Content 1',
      workspace: TEST_WORKSPACE
    });

    await savePlan({
      id: 'plan-2',
      title: 'Second Plan',
      content: 'Content 2',
      workspace: TEST_WORKSPACE
    });
  });

  it('gets plan by ID', async () => {
    const plan = await getPlan(TEST_WORKSPACE, 'plan-1');

    expect(plan).toBeTruthy();
    expect(plan!.id).toBe('plan-1');
    expect(plan!.title).toBe('First Plan');
  });

  it('returns null for non-existent plan', async () => {
    const plan = await getPlan(TEST_WORKSPACE, 'nonexistent');
    expect(plan).toBeNull();
  });

  it('lists all plans in workspace', async () => {
    const plans = await listPlans(TEST_WORKSPACE);

    expect(plans).toHaveLength(2);
    expect(plans.map(p => p.id)).toContain('plan-1');
    expect(plans.map(p => p.id)).toContain('plan-2');
  });

  it('sorts plans by updated date (newest first)', async () => {
    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    // Update plan-1 to make it newer
    await updatePlan(TEST_WORKSPACE, 'plan-1', {
      content: 'Updated content'
    });

    const plans = await listPlans(TEST_WORKSPACE);

    expect(plans[0]!.id).toBe('plan-1');  // Most recently updated
    expect(plans[1]!.id).toBe('plan-2');
  });

  it('returns empty array when no plans exist', async () => {
    const emptyWorkspace = `test-empty-${Date.now()}`;
    await ensureWorkspaceDir(emptyWorkspace);

    const plans = await listPlans(emptyWorkspace);
    expect(plans).toEqual([]);

    await rm(getWorkspacePath(emptyWorkspace), { recursive: true, force: true });
  });
});

describe('Active plan management', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'plan-1',
      title: 'First Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE
    });

    await savePlan({
      id: 'plan-2',
      title: 'Second Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE
    });
  });

  it('sets active plan', async () => {
    await setActivePlan(TEST_WORKSPACE, 'plan-1');

    const activePlan = await getActivePlan(TEST_WORKSPACE);
    expect(activePlan?.id).toBe('plan-1');
  });

  it('switches active plan', async () => {
    await setActivePlan(TEST_WORKSPACE, 'plan-1');
    await setActivePlan(TEST_WORKSPACE, 'plan-2');

    const activePlan = await getActivePlan(TEST_WORKSPACE);
    expect(activePlan?.id).toBe('plan-2');
  });

  it('returns null when no active plan set', async () => {
    const activePlan = await getActivePlan(TEST_WORKSPACE);
    expect(activePlan).toBeNull();
  });

  it('throws when setting non-existent plan as active', async () => {
    await expect(
      setActivePlan(TEST_WORKSPACE, 'nonexistent')
    ).rejects.toThrow();
  });

  it('auto-activates plan when activate flag is true', async () => {
    await savePlan({
      id: 'auto-active',
      title: 'Auto Active Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE,
      activate: true
    });

    const activePlan = await getActivePlan(TEST_WORKSPACE);
    expect(activePlan?.id).toBe('auto-active');
  });

  it('does not auto-activate when activate flag is false', async () => {
    await savePlan({
      id: 'not-active',
      title: 'Not Active Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE,
      activate: false
    });

    const activePlan = await getActivePlan(TEST_WORKSPACE);
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
      workspace: TEST_WORKSPACE
    });
  });

  it('updates plan title', async () => {
    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      title: 'New Title'
    });

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan!.title).toBe('New Title');
    expect(plan!.content).toBe('Original content');  // Unchanged
  });

  it('updates plan content', async () => {
    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      content: 'New content'
    });

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan!.content).toBe('New content');
    expect(plan!.title).toBe('Original Title');  // Unchanged
  });

  it('updates plan status', async () => {
    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      status: 'completed'
    });

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan!.status).toBe('completed');
  });

  it('updates plan tags', async () => {
    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      tags: ['new', 'tags']
    });

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan!.tags).toEqual(['new', 'tags']);
  });

  it('updates multiple fields at once', async () => {
    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      title: 'Updated Title',
      content: 'Updated content',
      status: 'archived',
      tags: ['updated']
    });

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan!.title).toBe('Updated Title');
    expect(plan!.content).toBe('Updated content');
    expect(plan!.status).toBe('archived');
    expect(plan!.tags).toEqual(['updated']);
  });

  it('updates the updated timestamp', async () => {
    const originalPlan = await getPlan(TEST_WORKSPACE, 'test-plan');
    const originalUpdated = originalPlan!.updated;

    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    await updatePlan(TEST_WORKSPACE, 'test-plan', {
      content: 'New content'
    });

    const updatedPlan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(updatedPlan!.updated).not.toBe(originalUpdated);
    expect(new Date(updatedPlan!.updated).getTime())
      .toBeGreaterThan(new Date(originalUpdated).getTime());
  });

  it('throws when updating non-existent plan', async () => {
    await expect(
      updatePlan(TEST_WORKSPACE, 'nonexistent', { title: 'New' })
    ).rejects.toThrow();
  });
});

describe('Plan deletion', () => {
  beforeEach(async () => {
    await savePlan({
      id: 'test-plan',
      title: 'Test Plan',
      content: 'Content',
      workspace: TEST_WORKSPACE
    });
  });

  it('deletes plan file', async () => {
    await deletePlan(TEST_WORKSPACE, 'test-plan');

    const plan = await getPlan(TEST_WORKSPACE, 'test-plan');
    expect(plan).toBeNull();
  });

  it('clears active plan if deleted plan was active', async () => {
    await setActivePlan(TEST_WORKSPACE, 'test-plan');
    await deletePlan(TEST_WORKSPACE, 'test-plan');

    const activePlan = await getActivePlan(TEST_WORKSPACE);
    expect(activePlan).toBeNull();
  });

  it('does not affect other plans', async () => {
    await savePlan({
      id: 'other-plan',
      title: 'Other',
      content: 'Content',
      workspace: TEST_WORKSPACE
    });

    await deletePlan(TEST_WORKSPACE, 'test-plan');

    const otherPlan = await getPlan(TEST_WORKSPACE, 'other-plan');
    expect(otherPlan).toBeTruthy();
  });

  it('waits for in-flight updates before deleting plan', async () => {
    const planPath = join(
      getWorkspacePath(TEST_WORKSPACE),
      'plans',
      'test-plan.md'
    );

    const release = await acquireLock(planPath);
    const deletePromise = deletePlan(TEST_WORKSPACE, 'test-plan');

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
      deletePlan(TEST_WORKSPACE, 'nonexistent')
    ).rejects.toThrow();
  });
});
