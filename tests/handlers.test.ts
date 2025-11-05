import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleCheckpoint } from '../src/handlers/checkpoint';
import { handleRecall } from '../src/handlers/recall';
import { handlePlan } from '../src/handlers/plan';
import { saveCheckpoint } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { rm } from 'fs/promises';

/**
 * Test structured JSON responses for AI agent consumption
 *
 * These tests validate that handlers return parseable JSON
 * with all necessary data, optimized for token efficiency.
 */

const TEST_WORKSPACE = `test-handlers-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  await rm(getWorkspacePath(TEST_WORKSPACE), { recursive: true, force: true });
});

describe('Structured JSON responses', () => {
  describe('checkpoint handler', () => {
    it('returns structured JSON response', async () => {
      const result = await handleCheckpoint({
        description: 'Test checkpoint',
        tags: ['test', 'feature'],
        workspace: TEST_WORKSPACE
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      // Should be parseable JSON
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.success).toBe(true);
      expect(parsed.summary).toBeDefined();
      // Should contain a fish emoji (random)
      expect(parsed.summary).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
      expect(parsed.summary).toContain('Test checkpoint');
      expect(parsed.checkpoint).toBeDefined();
      expect(parsed.checkpoint.description).toBe('Test checkpoint');
      expect(parsed.checkpoint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(parsed.checkpoint.tags).toEqual(['test', 'feature']);
      expect(parsed.checkpoint.workspace).toBe(TEST_WORKSPACE);
    });

    it('includes git context when available', async () => {
      const result = await handleCheckpoint({
        description: 'With git',
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);

      // Git context may or may not be present, but structure should be there
      if (parsed.checkpoint.gitBranch) {
        expect(typeof parsed.checkpoint.gitBranch).toBe('string');
      }
      if (parsed.checkpoint.gitCommit) {
        expect(typeof parsed.checkpoint.gitCommit).toBe('string');
      }
    });

    it('throws error for missing description', async () => {
      await expect(
        handleCheckpoint({ workspace: TEST_WORKSPACE })
      ).rejects.toThrow('Description is required');
    });
  });

  describe('recall handler', () => {
    beforeEach(async () => {
      // Create test checkpoints
      await saveCheckpoint({
        description: 'First checkpoint',
        tags: ['test'],
        workspace: TEST_WORKSPACE
      });

      await saveCheckpoint({
        description: 'Second checkpoint',
        tags: ['feature'],
        workspace: TEST_WORKSPACE
      });
    });

    it('returns structured JSON with checkpoints array', async () => {
      const result = await handleRecall({
        workspace: TEST_WORKSPACE,
        days: 1
      });

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.summary).toBeDefined();
      // Should contain a fish emoji (random)
      expect(parsed.summary).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
      expect(parsed.checkpoints).toBeInstanceOf(Array);
      expect(parsed.checkpoints.length).toBeGreaterThanOrEqual(2);

      const checkpoint = parsed.checkpoints[0];
      expect(checkpoint.timestamp).toBeDefined();
      expect(checkpoint.description).toBeDefined();
      expect(checkpoint.tags).toBeInstanceOf(Array);
    });

    it('includes active plan in structured format', async () => {
      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Plan content here',
        workspace: TEST_WORKSPACE,
        activate: true
      });

      const result = await handleRecall({
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.activePlan).toBeDefined();
      expect(parsed.activePlan.id).toBe('test-plan');
      expect(parsed.activePlan.title).toBe('Test Plan');
      expect(parsed.activePlan.content).toBe('Plan content here');
      expect(parsed.activePlan.status).toBe('active');
    });

    it('includes query parameters for context', async () => {
      const result = await handleRecall({
        workspace: TEST_WORKSPACE,
        days: 7,
        search: 'test'
      });

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.query).toBeDefined();
      expect(parsed.query.days).toBe(7);
      expect(parsed.query.search).toBe('test');
    });

    it('includes workspace summaries for cross-workspace recall', async () => {
      const result = await handleRecall({
        workspace: 'all',
        days: 1
      });

      const parsed = JSON.parse(result.content[0]!.text);

      if (parsed.workspaces) {
        expect(parsed.workspaces).toBeInstanceOf(Array);
        for (const ws of parsed.workspaces) {
          expect(ws.name).toBeDefined();
          expect(typeof ws.checkpointCount).toBe('number');
        }
      }
    });

    it('returns empty array when no checkpoints found', async () => {
      const result = await handleRecall({
        workspace: 'nonexistent-workspace',
        days: 1
      });

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.checkpoints).toEqual([]);
    });
  });

  describe('plan handler', () => {
    describe('save action', () => {
      it('returns structured plan data', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Test Plan',
          content: 'Plan content',
          workspace: TEST_WORKSPACE,
          activate: true
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.success).toBe(true);
        expect(parsed.summary).toBeDefined();
        // Should contain a fish emoji (random)
        expect(parsed.summary).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
        expect(parsed.summary).toContain('Test Plan');
        expect(parsed.plan).toBeDefined();
        expect(parsed.plan.id).toBeDefined();
        expect(parsed.plan.title).toBe('Test Plan');
        expect(parsed.plan.status).toBe('active');
        expect(parsed.plan.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(parsed.plan.updated).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      });

      it('saves plan without activating when activate: false', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Not Activated Plan',
          content: 'Content',
          workspace: TEST_WORKSPACE,
          activate: false
        });

        const parsed = JSON.parse(result.content[0]!.text);

        // Plan is saved with default status 'active' but not set as THE active plan
        expect(parsed.plan.status).toBe('active');
        expect(parsed.success).toBe(true);

        // Verify it's not THE active plan for the workspace
        const recallResult = await handleRecall({ workspace: TEST_WORKSPACE });
        const recallParsed = JSON.parse(recallResult.content[0]!.text);

        // Should have no activePlan since we didn't activate it
        expect(recallParsed.activePlan).toBeUndefined();
      });
    });

    describe('get action', () => {
      it('returns complete plan data', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test Plan',
          content: 'Plan content',
          workspace: TEST_WORKSPACE
        });

        const result = await handlePlan({
          action: 'get',
          id: 'test-plan',
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.plan).toBeDefined();
        expect(parsed.plan.id).toBe('test-plan');
        expect(parsed.plan.title).toBe('Test Plan');
        expect(parsed.plan.content).toBe('Plan content');
        expect(parsed.plan.status).toBeDefined();
      });
    });

    describe('list action', () => {
      it('returns array of plans', async () => {
        await savePlan({
          id: 'plan-1',
          title: 'Plan 1',
          content: 'Content 1',
          workspace: TEST_WORKSPACE
        });

        await savePlan({
          id: 'plan-2',
          title: 'Plan 2',
          content: 'Content 2',
          workspace: TEST_WORKSPACE
        });

        const result = await handlePlan({
          action: 'list',
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.plans).toBeInstanceOf(Array);
        expect(parsed.plans.length).toBe(2);
        expect(parsed.count).toBe(2);

        for (const plan of parsed.plans) {
          expect(plan.id).toBeDefined();
          expect(plan.title).toBeDefined();
          expect(plan.status).toBeDefined();
          expect(plan.updated).toBeDefined();
        }
      });

      it('filters by status', async () => {
        // Create separate test workspace to avoid interference
        const filterTestWorkspace = `${TEST_WORKSPACE}-filter`;

        await savePlan({
          id: 'active-plan',
          title: 'Active',
          content: 'Content',
          workspace: filterTestWorkspace,
          status: 'active'
        });

        await savePlan({
          id: 'completed-plan',
          title: 'Completed',
          content: 'Content',
          workspace: filterTestWorkspace,
          status: 'completed'
        });

        const result = await handlePlan({
          action: 'list',
          status: 'completed',
          workspace: filterTestWorkspace
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.plans.length).toBe(1);
        expect(parsed.plans[0].status).toBe('completed');
        expect(parsed.plans[0].id).toBe('completed-plan');
      });

      it('returns empty array when no plans found', async () => {
        const result = await handlePlan({
          action: 'list',
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.plans).toEqual([]);
        expect(parsed.count).toBe(0);
      });
    });

    describe('activate action', () => {
      it('returns success confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test',
          content: 'Content',
          workspace: TEST_WORKSPACE
        });

        const result = await handlePlan({
          action: 'activate',
          id: 'test-plan',
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.success).toBe(true);
        expect(parsed.action).toBe('activate');
        expect(parsed.planId).toBe('test-plan');
      });
    });

    describe('update action', () => {
      it('returns success confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Original',
          content: 'Content',
          workspace: TEST_WORKSPACE
        });

        const result = await handlePlan({
          action: 'update',
          id: 'test-plan',
          updates: { title: 'Updated' },
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.success).toBe(true);
        expect(parsed.action).toBe('update');
        expect(parsed.planId).toBe('test-plan');
      });
    });

    describe('complete action', () => {
      it('returns success confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test',
          content: 'Content',
          workspace: TEST_WORKSPACE
        });

        const result = await handlePlan({
          action: 'complete',
          id: 'test-plan',
          workspace: TEST_WORKSPACE
        });

        const parsed = JSON.parse(result.content[0]!.text);

        expect(parsed.success).toBe(true);
        expect(parsed.action).toBe('complete');
        expect(parsed.planId).toBe('test-plan');
      });
    });
  });
});

describe('Token efficiency', () => {
  it('checkpoint response is compact', async () => {
    const result = await handleCheckpoint({
      description: 'Test',
      workspace: TEST_WORKSPACE
    });

    const text = result.content[0]!.text;

    // Should be JSON with embedded fish emoji in summary
    expect(text).not.toContain('✅');
    expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/); // Should have a fish emoji in summary
    expect(text).not.toContain('**');

    // Should be compact JSON (< 700 chars for simple checkpoint with metadata + search fields)
    expect(text.length).toBeLessThan(700);
  });

  it('recall response is compact for multiple checkpoints', async () => {
    // Create 5 checkpoints
    for (let i = 0; i < 5; i++) {
      await saveCheckpoint({
        description: `Checkpoint ${i}`,
        workspace: TEST_WORKSPACE
      });
    }

    const result = await handleRecall({
      workspace: TEST_WORKSPACE
    });

    const text = result.content[0]!.text;

    // Should be JSON with fish emoji in summary
    expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/); // Should have a fish emoji in summary
    expect(text).not.toContain('🧠');
    expect(text).not.toContain('📅');
    expect(text).not.toContain('Context Restored');

    // Parse to verify it's valid JSON
    const parsed = JSON.parse(text);
    expect(parsed.checkpoints.length).toBe(5);
  });
});
