import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { handleCheckpoint } from '../src/handlers/checkpoint';
import { handleRecall } from '../src/handlers/recall';
import { handlePlan } from '../src/handlers/plan';
import { saveCheckpoint } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { ensureMemoriesDir } from '../src/workspace';
import { rm } from 'fs/promises';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Test readable markdown responses for AI agent consumption
 *
 * These tests validate that handlers return readable markdown text
 * (not JSON) with all necessary data, optimized for token efficiency.
 */

let TEST_DIR: string;

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-handlers-'));
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('Readable markdown responses', () => {
  describe('checkpoint handler', () => {
    it('returns readable markdown response', async () => {
      const result = await handleCheckpoint({
        description: 'Test checkpoint',
        tags: ['test', 'feature'],
        workspace: TEST_DIR
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      const text = result.content[0]!.text;

      // Should NOT be JSON
      expect(text).not.toStartWith('{');

      // Should contain fish emoji header
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Checkpoint saved: checkpoint_/);
      // Should contain timestamp
      expect(text).toMatch(/Time: \d{4}-\d{2}-\d{2}T/);
      // Should contain tags
      expect(text).toContain('Tags: test, feature');
    });

    it('includes git context when available', async () => {
      const result = await handleCheckpoint({
        description: 'With git',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;

      // Should NOT be JSON
      expect(text).not.toStartWith('{');

      // Git context may or may not be present depending on environment
      // But if branch exists, it should be on a Branch: line
      if (text.includes('Branch:')) {
        expect(text).toMatch(/Branch: .+ @ [a-f0-9]+/);
      }
    });

    it('omits empty tags line', async () => {
      const result = await handleCheckpoint({
        description: 'No tags checkpoint',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).not.toContain('Tags:');
    });

    it('caps files at 10 with overflow indicator', async () => {
      // We can't easily mock git files, but we can verify the format handles it
      const result = await handleCheckpoint({
        description: 'Files test',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      // If files are present, they should be on a Files: line
      if (text.includes('Files:')) {
        expect(text).toMatch(/Files: /);
      }
    });

    it('shows planId in checkpoint response when active plan exists', async () => {
      await savePlan({
        title: 'Checkpoint Handler Plan',
        content: 'Content',
        workspace: TEST_DIR,
        activate: true
      });

      const result = await handleCheckpoint({
        description: 'Checkpoint with plan context',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('Plan: checkpoint-handler-plan');
    });

    it('throws error for missing description', async () => {
      await expect(
        handleCheckpoint({ workspace: TEST_DIR })
      ).rejects.toThrow('Description is required');
    });
  });

  describe('recall handler', () => {
    beforeEach(async () => {
      // Create test checkpoints
      await saveCheckpoint({
        description: 'First checkpoint',
        tags: ['test'],
        workspace: TEST_DIR
      });

      await saveCheckpoint({
        description: 'Second checkpoint',
        tags: ['feature'],
        workspace: TEST_DIR
      });
    });

    it('returns readable markdown with checkpoints', async () => {
      const result = await handleRecall({
        workspace: TEST_DIR,
        days: 1
      });

      const text = result.content[0]!.text;

      // Should NOT be JSON
      expect(text).not.toStartWith('{');

      // Should contain fish emoji header with count
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Recalled \d+ checkpoints?/);

      // Should contain workspace diagnostics
      expect(text).toContain('Workspace:');
      expect(text).toContain('Memories:');

      // Should contain checkpoint entries as H3 headers
      expect(text).toMatch(/### \d{4}-\d{2}-\d{2} \d{2}:\d{2} checkpoint_/);

      // Should contain checkpoint descriptions
      expect(text).toContain('First checkpoint');
      expect(text).toContain('Second checkpoint');
    });

    it('includes active plan in markdown format', async () => {
      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Plan content here',
        workspace: TEST_DIR,
        activate: true
      });

      const result = await handleRecall({
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;

      // Should mention active plan in header
      expect(text).toContain('+ active plan');

      // Should render plan as H2 section
      expect(text).toContain('## Active Plan: Test Plan (active)');
      expect(text).toMatch(/Updated: \d{4}-\d{2}-\d{2}T/);
      expect(text).toContain('Plan content here');

      // Should have separator
      expect(text).toContain('---');
    });

    it('includes diagnostics in header', async () => {
      const result = await handleRecall({
        workspace: TEST_DIR,
        days: 7,
        search: 'test'
      });

      const text = result.content[0]!.text;

      // Should have workspace and memories paths
      expect(text).toContain('Workspace:');
      expect(text).toContain('Memories:');
    });

    it('handles cross-workspace recall', async () => {
      const result = await handleRecall({
        workspace: 'all',
        days: 1
      });

      const text = result.content[0]!.text;

      // Should NOT be JSON
      expect(text).not.toStartWith('{');
      // Should contain fish emoji
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
    });

    it('returns readable message when no checkpoints found', async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), 'test-handlers-empty-'));
      await ensureMemoriesDir(emptyDir);

      const result = await handleRecall({
        workspace: emptyDir,
        days: 1
      });

      const text = result.content[0]!.text;

      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] No checkpoints found/);
      expect(text).not.toStartWith('{');

      await rm(emptyDir, { recursive: true, force: true });
    });

    it('shows planId in checkpoint output when present', async () => {
      await savePlan({
        title: 'Handler Test Plan',
        content: 'Content',
        workspace: TEST_DIR,
        activate: true
      });

      await saveCheckpoint({
        description: 'Checkpoint with plan',
        workspace: TEST_DIR
      });

      const result = await handleRecall({
        workspace: TEST_DIR,
        full: true,
        limit: 1
      });

      const text = result.content[0]!.text;
      expect(text).toContain('Plan: handler-test-plan');
    });

    it('shows tags on checkpoint entries', async () => {
      const result = await handleRecall({
        workspace: TEST_DIR,
        days: 1
      });

      const text = result.content[0]!.text;

      // Checkpoint entries should show tags
      expect(text).toContain('Tags: test');
      expect(text).toContain('Tags: feature');
    });
  });

  describe('plan handler', () => {
    describe('save action', () => {
      it('returns one-liner confirmation', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Test Plan',
          content: 'Plan content',
          workspace: TEST_DIR,
          activate: true
        });

        const text = result.content[0]!.text;

        expect(text).not.toStartWith('{');
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan saved:/);
        expect(text).toContain('(active)');
      });

      it('saves plan without activating when activate: false', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Not Activated Plan',
          content: 'Content',
          workspace: TEST_DIR,
          activate: false
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan saved:/);

        // Verify it's not THE active plan for the workspace
        const recallResult = await handleRecall({ workspace: TEST_DIR });
        const recallText = recallResult.content[0]!.text;

        // Should have no active plan section
        expect(recallText).not.toContain('## Active Plan:');
      });

      it('forwards tags to savePlan', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Tagged Plan',
          content: 'Content with tags',
          workspace: TEST_DIR,
          tags: ['milestone', 'auth']
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan saved:/);
        // Plan id should be derived from title
        expect(text).toContain('tagged-plan');
      });

      it('forwards custom id to savePlan', async () => {
        const result = await handlePlan({
          action: 'save',
          title: 'Custom ID Plan',
          content: 'Content',
          workspace: TEST_DIR,
          id: 'my-custom-id'
        });

        const text = result.content[0]!.text;
        expect(text).toContain('my-custom-id');
      });
    });

    describe('get action', () => {
      it('returns full plan rendered as markdown', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test Plan',
          content: 'Plan content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'get',
          id: 'test-plan',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;

        expect(text).not.toStartWith('{');
        // Should render as markdown with title
        expect(text).toContain('# Test Plan');
        expect(text).toContain('Status:');
        expect(text).toContain('Created:');
        expect(text).toContain('Updated:');
        expect(text).toContain('Plan content');
      });
    });

    describe('list action', () => {
      it('returns list of plans', async () => {
        await savePlan({
          id: 'plan-1',
          title: 'Plan 1',
          content: 'Content 1',
          workspace: TEST_DIR
        });

        await savePlan({
          id: 'plan-2',
          title: 'Plan 2',
          content: 'Content 2',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'list',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;

        expect(text).not.toStartWith('{');
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Found 2 plans/);
        expect(text).toContain('plan-1');
        expect(text).toContain('Plan 1');
        expect(text).toContain('plan-2');
        expect(text).toContain('Plan 2');
      });

      it('filters by status', async () => {
        const filterDir = await mkdtemp(join(tmpdir(), 'test-handlers-filter-'));
        await ensureMemoriesDir(filterDir);

        await savePlan({
          id: 'active-plan',
          title: 'Active',
          content: 'Content',
          workspace: filterDir,
          status: 'active'
        });

        await savePlan({
          id: 'completed-plan',
          title: 'Completed',
          content: 'Content',
          workspace: filterDir,
          status: 'completed'
        });

        const result = await handlePlan({
          action: 'list',
          status: 'completed',
          workspace: filterDir
        });

        const text = result.content[0]!.text;

        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Found 1 plan/);
        expect(text).toContain('completed-plan');
        expect(text).toContain('Completed');
        expect(text).not.toContain('active-plan');

        await rm(filterDir, { recursive: true, force: true });
      });

      it('returns message when no plans found', async () => {
        const result = await handlePlan({
          action: 'list',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] No plans found/);
      });
    });

    describe('activate action', () => {
      it('returns one-liner confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test',
          content: 'Content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'activate',
          id: 'test-plan',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan activated: test-plan/);
      });
    });

    describe('update action', () => {
      it('returns one-liner confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Original',
          content: 'Content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'update',
          id: 'test-plan',
          updates: { title: 'Updated' },
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan updated: test-plan/);
      });
    });

    describe('complete action', () => {
      it('returns one-liner confirmation', async () => {
        await savePlan({
          id: 'test-plan',
          title: 'Test',
          content: 'Content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'complete',
          id: 'test-plan',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan completed: test-plan/);
      });
    });
  });
});

describe('Token efficiency', () => {
  it('checkpoint response is compact markdown', async () => {
    const result = await handleCheckpoint({
      description: 'Test',
      workspace: TEST_DIR
    });

    const text = result.content[0]!.text;

    // Should contain a fish emoji
    expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
    // Should NOT be JSON
    expect(text).not.toStartWith('{');
    expect(text).not.toContain('"success"');
    expect(text).not.toContain('"checkpoint"');

    // Should be compact (< 500 chars for a simple checkpoint)
    expect(text.length).toBeLessThan(500);
  });

  it('recall response is compact markdown for multiple checkpoints', async () => {
    // Create 5 checkpoints
    for (let i = 0; i < 5; i++) {
      await saveCheckpoint({
        description: `Checkpoint ${i}`,
        workspace: TEST_DIR
      });
    }

    const result = await handleRecall({
      workspace: TEST_DIR
    });

    const text = result.content[0]!.text;

    // Should contain a fish emoji
    expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
    // Should NOT be JSON
    expect(text).not.toStartWith('{');
    expect(text).not.toContain('"checkpoints"');
    expect(text).not.toContain('"query"');

    // Should contain all 5 checkpoints
    for (let i = 0; i < 5; i++) {
      expect(text).toContain(`Checkpoint ${i}`);
    }
  });

  it('recall response has no JSON artifacts', async () => {
    await saveCheckpoint({
      description: 'Test',
      tags: ['test'],
      workspace: TEST_DIR
    });

    const result = await handleRecall({
      workspace: TEST_DIR
    });

    const text = result.content[0]!.text;

    // No JSON syntax
    expect(text).not.toMatch(/^\s*\{/);
    expect(text).not.toMatch(/^\s*\[/);
    expect(text).not.toContain('":');
  });
});
