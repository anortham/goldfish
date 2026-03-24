import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { handleCheckpoint } from '../src/handlers/checkpoint';
import { handleRecall } from '../src/handlers/recall';
import { handlePlan } from '../src/handlers/plan';
import { getCheckpointsForDay, saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { setDefaultSemanticRuntime } from '../src/transformers-embedder';
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
let restoreDeps: (() => void) | undefined;

const TEST_DEFAULT_RUNTIME = {
  isReady: () => false,
  getModelInfo: () => ({ id: 'test-default-model', version: '1' }),
  embedTexts: async () => [[1, 0]]
};

beforeAll(() => {
  setDefaultSemanticRuntime(TEST_DEFAULT_RUNTIME);
});

afterAll(() => {
  setDefaultSemanticRuntime(undefined);
});

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-handlers-'));
  restoreDeps = __setCheckpointDependenciesForTests({
    getGitContext: () => ({ branch: 'main', commit: 'abc1234' })
  });
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  restoreDeps?.();
  restoreDeps = undefined;
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

    it('formats files line sensibly when git files are present', async () => {
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

    it('warns when decision checkpoint missing decision field', async () => {
      const result = await handleCheckpoint({
        description: 'Chose REST over GraphQL',
        type: 'decision',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('decision');
      expect(text).toContain('alternatives');
    });

    it('warns when incident checkpoint missing context and evidence', async () => {
      const result = await handleCheckpoint({
        description: 'Production outage from bad deploy',
        type: 'incident',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('context');
      expect(text).toContain('evidence');
    });

    it('warns when learning checkpoint missing impact', async () => {
      const result = await handleCheckpoint({
        description: 'Discovered bun test runs 3x faster with --preload',
        type: 'learning',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('impact');
    });

    it('does not warn when decision checkpoint has all recommended fields', async () => {
      const result = await handleCheckpoint({
        description: 'Chose REST over GraphQL',
        type: 'decision',
        decision: 'Use REST for simplicity',
        alternatives: ['GraphQL - too complex for our needs'],
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).not.toMatch(/💡/);
    });

    it('does not warn when no type is specified', async () => {
      const result = await handleCheckpoint({
        description: 'Generic checkpoint',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).not.toMatch(/💡/);
    });

    it('rejects out-of-range confidence values', async () => {
      await expect(
        handleCheckpoint({
          description: 'Invalid confidence checkpoint',
          confidence: 7,
          workspace: TEST_DIR
        })
      ).rejects.toThrow('confidence must be a number between 1 and 5');
    });

    it('rounds non-integer confidence to nearest integer', async () => {
      // Should not throw (previously rejected non-integers)
      await handleCheckpoint({
        description: 'Fractional confidence checkpoint',
        confidence: 3.7,
        workspace: TEST_DIR
      });

      // Verify the saved checkpoint has rounded confidence
      const today = new Date().toISOString().split('T')[0]!;
      const checkpoints = await getCheckpointsForDay(TEST_DIR, today);
      const saved = checkpoints.find(c => c.description === 'Fractional confidence checkpoint');
      expect(saved).toBeDefined();
      expect(saved!.confidence).toBe(4);
    });

    it('throws error for missing description', async () => {
      await expect(
        handleCheckpoint({ workspace: TEST_DIR })
      ).rejects.toThrow('Description is required');
    });

    it('handles tags passed as JSON string', async () => {
      const result = await handleCheckpoint({
        description: 'String tags checkpoint',
        tags: '["release", "v3.9.0", "bug-fix"]',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('Tags: release, v3.9.0, bug-fix');
    });

    it('handles symbols passed as JSON string', async () => {
      const result = await handleCheckpoint({
        description: 'String symbols checkpoint',
        symbols: '["resolve_workspace_path", "load_agent_instructions"]',
        workspace: TEST_DIR
      });

      // Should not throw - symbols are passed through to saveCheckpoint
      expect(result.content[0]!.text).toContain('Checkpoint saved');
    });

    it('handles alternatives passed as JSON string', async () => {
      const result = await handleCheckpoint({
        description: 'String alternatives checkpoint',
        type: 'decision',
        decision: 'Use REST',
        alternatives: '["GraphQL", "gRPC"]',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      // Should not warn about missing alternatives
      expect(text).not.toContain('alternatives');
    });

    it('handles evidence passed as JSON string', async () => {
      const result = await handleCheckpoint({
        description: 'String evidence checkpoint',
        type: 'incident',
        context: 'Server crashed',
        evidence: '["stack trace", "logs"]',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      // Should not warn about missing evidence
      expect(text).not.toContain('consider adding');
    });

    it('persists unknowns passed as JSON string', async () => {
      await handleCheckpoint({
        description: 'String unknowns checkpoint',
        unknowns: '["Whether the rollout needs a flag"]',
        workspace: TEST_DIR
      });

      const date = new Date().toISOString().split('T')[0]!;
      const checkpoints = await getCheckpointsForDay(TEST_DIR, date);

      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0]!.unknowns).toEqual(['Whether the rollout needs a flag']);
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
      try {
        await ensureMemoriesDir(emptyDir);

        const result = await handleRecall({
          workspace: emptyDir,
          days: 1
        });

        const text = result.content[0]!.text;

        expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] No checkpoints found/);
        expect(text).not.toStartWith('{');
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
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

    it('shows structured fields in checkpoint output when present', async () => {
      await saveCheckpoint({
        description: 'Structured recall checkpoint',
        workspace: TEST_DIR,
        type: 'decision',
        context: 'Need to simplify auth retry behavior',
        decision: 'Use bounded retries with jitter',
        alternatives: ['Disable retries', 'Keep unbounded backoff'],
        evidence: ['Staging retry logs', 'Support escalation notes'],
        impact: 'Reduced retry storms in staging',
        symbols: ['retryAuthRequest'],
        next: 'Track retry metrics for one week',
        confidence: 4,
        unknowns: ['Whether mobile clients need longer retry windows']
      });

      const result = await handleRecall({
        workspace: TEST_DIR,
        full: true,
        search: 'bounded retries'
      });

      const text = result.content[0]!.text;
      expect(text).toContain('Type: decision');
      expect(text).toContain('Context: Need to simplify auth retry behavior');
      expect(text).toContain('Decision: Use bounded retries with jitter');
      expect(text).toContain('Alternatives: Disable retries, Keep unbounded backoff');
      expect(text).toContain('Evidence: Staging retry logs, Support escalation notes');
      expect(text).toContain('Impact: Reduced retry storms in staging');
      expect(text).toContain('Symbols: retryAuthRequest');
      expect(text).toContain('Next: Track retry metrics for one week');
      expect(text).toContain('Confidence: 4/5');
      expect(text).toContain('Unknowns: Whether mobile clients need longer retry windows');
    });

    it('strips structured fields in non-full mode for token efficiency', async () => {
      await saveCheckpoint({
        description: 'Structured compact checkpoint',
        workspace: TEST_DIR,
        type: 'decision',
        context: 'Need to simplify auth retry behavior',
        decision: 'Use bounded retries with jitter',
        alternatives: ['Disable retries', 'Keep unbounded backoff'],
        evidence: ['Staging retry logs', 'Support escalation notes'],
        impact: 'Reduced retry storms in staging',
        symbols: ['retryAuthRequest'],
        next: 'Track retry metrics for one week',
        confidence: 4,
        unknowns: ['Whether mobile clients need longer retry windows'],
        tags: ['decision', 'auth']
      });

      const result = await handleRecall({
        workspace: TEST_DIR,
        full: false
      });

      const text = result.content[0]!.text;

      // Should keep orientation fields
      expect(text).toContain('Tags: decision, auth');
      expect(text).toContain('Type: decision');
      expect(text).toContain('Next: Track retry metrics for one week');

      // Should strip verbose forensic fields
      expect(text).not.toContain('Context: Need to simplify');
      expect(text).not.toContain('Decision: Use bounded retries');
      expect(text).not.toContain('Alternatives:');
      expect(text).not.toContain('Evidence:');
      expect(text).not.toContain('Impact:');
      expect(text).not.toContain('Symbols:');
      expect(text).not.toContain('Confidence:');
      expect(text).not.toContain('Unknowns:');
    });

    it('search mode uses same default limit (5) as non-search mode', async () => {
      for (let i = 0; i < 6; i++) {
        await saveCheckpoint({
          description: `Searchable checkpoint ${i}`,
          workspace: TEST_DIR
        });
      }

      const result = await handleRecall({
        workspace: TEST_DIR,
        search: 'checkpoint'
      });

      const text = result.content[0]!.text;
      expect(text.match(/^### /gm)?.length).toBe(5);
    });

    it('respects explicit limit for search requests', async () => {
      for (let i = 0; i < 4; i++) {
        await saveCheckpoint({
          description: `Explicit limit checkpoint ${i}`,
          workspace: TEST_DIR
        });
      }

      const result = await handleRecall({
        workspace: TEST_DIR,
        search: 'checkpoint',
        limit: 4
      });

      const text = result.content[0]!.text;
      expect(text.match(/^### /gm)?.length).toBe(4);
    });

    it('does not tighten full search requests', async () => {
      for (let i = 0; i < 4; i++) {
        await saveCheckpoint({
          description: `Full search checkpoint ${i}`,
          workspace: TEST_DIR
        });
      }

      const result = await handleRecall({
        workspace: TEST_DIR,
        search: 'checkpoint',
        full: true
      });

      const text = result.content[0]!.text;
      expect(text.match(/^### /gm)?.length).toBe(5);
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

      it('falls back to active plan when no id provided', async () => {
        await savePlan({
          id: 'active-plan',
          title: 'Active Plan',
          content: 'Active content',
          workspace: TEST_DIR,
          activate: true
        });

        const result = await handlePlan({
          action: 'get',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toContain('# Active Plan');
        expect(text).toContain('Active content');
      });

      it('throws helpful error when no id and no active plan', async () => {
        expect(handlePlan({
          action: 'get',
          workspace: TEST_DIR
        })).rejects.toThrow('No active plan found');
      });
    });

    describe('list action', () => {
      it('does not contain em dashes in plan list output', async () => {
        await savePlan({
          id: 'emdash-plan',
          title: 'Em Dash Test',
          content: 'Content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'list',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).not.toContain('\u2014'); // em dash
      });

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
        try {
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
        } finally {
          await rm(filterDir, { recursive: true, force: true });
        }
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

    describe('planId alias', () => {
      it('accepts planId as alias for id across all actions', async () => {
        await savePlan({
          id: 'alias-test',
          title: 'Alias Test',
          content: 'Content',
          workspace: TEST_DIR
        });

        // get with planId
        const getResult = await handlePlan({
          action: 'get',
          planId: 'alias-test',
          workspace: TEST_DIR
        });
        expect(getResult.content[0]!.text).toContain('# Alias Test');

        // activate with planId
        const activateResult = await handlePlan({
          action: 'activate',
          planId: 'alias-test',
          workspace: TEST_DIR
        });
        expect(activateResult.content[0]!.text).toContain('Plan activated: alias-test');

        // update with planId
        const updateResult = await handlePlan({
          action: 'update',
          planId: 'alias-test',
          updates: { title: 'Updated' },
          workspace: TEST_DIR
        });
        expect(updateResult.content[0]!.text).toContain('Plan updated: alias-test');

        // complete with planId
        const completeResult = await handlePlan({
          action: 'complete',
          planId: 'alias-test',
          workspace: TEST_DIR
        });
        expect(completeResult.content[0]!.text).toContain('Plan completed: alias-test');
      });
    });

    describe('activate action', () => {
      it('throws when no ID provided and no active plan', async () => {
        await expect(
          handlePlan({
            action: 'activate',
            workspace: TEST_DIR
          })
        ).rejects.toThrow('Plan ID is required');
      });

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

      it('constructs updates from top-level properties when updates object is missing', async () => {
        await savePlan({
          id: 'toplevel-test',
          title: 'Original Title',
          content: 'Original content',
          workspace: TEST_DIR
        });

        const result = await handlePlan({
          action: 'update',
          planId: 'toplevel-test',
          content: 'Updated content from top level',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toContain('Plan updated: toplevel-test');

        // Verify the content was actually updated
        const getResult = await handlePlan({
          action: 'get',
          id: 'toplevel-test',
          workspace: TEST_DIR
        });
        expect(getResult.content[0]!.text).toContain('Updated content from top level');
      });

      it('falls back to active plan when no id provided', async () => {
        await savePlan({
          id: 'active-update-test',
          title: 'Active Plan',
          content: 'Original',
          workspace: TEST_DIR,
          activate: true
        });

        const result = await handlePlan({
          action: 'update',
          updates: { content: 'Updated via active' },
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toContain('Plan updated: active-update-test');
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

      it('falls back to active plan when no id provided', async () => {
        await savePlan({
          id: 'active-complete-test',
          title: 'Active Plan',
          content: 'Content',
          workspace: TEST_DIR,
          activate: true
        });

        const result = await handlePlan({
          action: 'complete',
          workspace: TEST_DIR
        });

        const text = result.content[0]!.text;
        expect(text).toContain('Plan completed: active-complete-test');
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
