import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { rm } from 'fs/promises';

// We'll test the server module functions directly since running a full MCP server
// in tests is complex. We'll validate tool handlers work correctly.

const TEST_WORKSPACE = `test-server-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  await rm(getWorkspacePath(TEST_WORKSPACE), { recursive: true, force: true });
});

describe('Tool handlers', () => {
  describe('checkpoint tool', () => {
    it('saves checkpoint and returns confirmation', async () => {
      // Import the handler function
      const { handleCheckpoint } = await import('../src/server');

      const result = await handleCheckpoint({
        description: 'Test checkpoint',
        tags: ['test'],
        workspace: TEST_WORKSPACE
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      // Response should be JSON
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(parsed.checkpoint.description).toBe('Test checkpoint');
      expect(parsed.checkpoint.tags).toEqual(['test']);
    });

    it('includes git context in response', async () => {
      const { handleCheckpoint } = await import('../src/server');

      const result = await handleCheckpoint({
        description: 'With git context',
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(parsed.checkpoint.description).toBe('With git context');
      // Git context may or may not be present
      if (parsed.checkpoint.gitBranch) {
        expect(typeof parsed.checkpoint.gitBranch).toBe('string');
      }
    });

    it('handles missing description gracefully', async () => {
      const { handleCheckpoint } = await import('../src/server');

      await expect(
        handleCheckpoint({ workspace: TEST_WORKSPACE })
      ).rejects.toThrow();
    });
  });

  describe('recall tool', () => {
    beforeEach(async () => {
      // Create test checkpoints
      await saveCheckpoint({
        description: 'First checkpoint',
        tags: ['test'],
        workspace: TEST_WORKSPACE
      });

      await saveCheckpoint({
        description: 'Second checkpoint',
        tags: ['test'],
        workspace: TEST_WORKSPACE
      });
    });

    it('returns formatted recall results', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: TEST_WORKSPACE
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      // Response should be JSON
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.checkpoints).toBeInstanceOf(Array);
      expect(parsed.checkpoints.length).toBeGreaterThanOrEqual(2);

      const descriptions = parsed.checkpoints.map((c: any) => c.description);
      expect(descriptions).toContain('First checkpoint');
      expect(descriptions).toContain('Second checkpoint');
    });

    it('includes active plan when present', async () => {
      const { handleRecall } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Plan content',
        workspace: TEST_WORKSPACE,
        activate: true
      });

      const result = await handleRecall({
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.activePlan).toBeDefined();
      expect(parsed.activePlan.title).toBe('Test Plan');
      expect(parsed.activePlan.content).toBe('Plan content');
    });

    it('formats cross-workspace results', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: 'all',
        days: 1
      });

      expect(result.content[0]!.type).toBe('text');
      const text = result.content[0]!.text;
      // Should contain workspace summaries
      expect(text.length).toBeGreaterThan(0);
    });

    it('applies search filter', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: TEST_WORKSPACE,
        search: 'First'
      });

      const text = result.content[0]!.text;
      expect(text).toContain('First checkpoint');
    });
  });

  describe('plan tool', () => {
    it('saves plan and returns confirmation', async () => {
      const { handlePlan } = await import('../src/server');

      const result = await handlePlan({
        action: 'save',
        title: 'Test Plan',
        content: 'Plan content',
        workspace: TEST_WORKSPACE
      });

      expect(result.content[0]!.type).toBe('text');

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.success).toBe(true);
      expect(parsed.plan.title).toBe('Test Plan');
      expect(parsed.plan.content).toBe('Plan content');
    });

    it('gets plan by ID', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Content',
        workspace: TEST_WORKSPACE
      });

      const result = await handlePlan({
        action: 'get',
        id: 'test-plan',
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.plan.title).toBe('Test Plan');
      expect(parsed.plan.content).toBe('Content');
    });

    it('lists all plans', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'plan-1',
        title: 'Plan 1',
        content: 'Content',
        workspace: TEST_WORKSPACE
      });

      await savePlan({
        id: 'plan-2',
        title: 'Plan 2',
        content: 'Content',
        workspace: TEST_WORKSPACE
      });

      const result = await handlePlan({
        action: 'list',
        workspace: TEST_WORKSPACE
      });

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.plans).toBeInstanceOf(Array);
      expect(parsed.count).toBeGreaterThanOrEqual(2);

      const titles = parsed.plans.map((p: any) => p.title);
      expect(titles).toContain('Plan 1');
      expect(titles).toContain('Plan 2');
    });

    it('activates plan', async () => {
      const { handlePlan } = await import('../src/server');

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
    });

    it('updates plan', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Original',
        content: 'Original content',
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
    });

    it('handles invalid action gracefully', async () => {
      const { handlePlan } = await import('../src/server');

      await expect(
        handlePlan({
          action: 'invalid' as any,
          workspace: TEST_WORKSPACE
        })
      ).rejects.toThrow();
    });
  });
});

describe('Tool descriptions', () => {
  it('exports tool definitions with descriptions', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();

    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['checkpoint', 'recall', 'plan']);

    // Each tool should have description and inputSchema
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(50);
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it('includes aggressive behavioral language in descriptions', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();

    const checkpointTool = tools.find(t => t.name === 'checkpoint');
    expect(checkpointTool!.description).toContain('MANDATORY');
    expect(checkpointTool!.description).toContain('MUST checkpoint');
    expect(checkpointTool!.description).toContain('DO NOT SKIP');
    expect(checkpointTool!.description).toContain('CRITICAL');

    const recallTool = tools.find(t => t.name === 'recall');
    expect(recallTool!.description).toContain('MANDATORY');
    expect(recallTool!.description).toContain('FIRST action');

    const planTool = tools.find(t => t.name === 'plan');
    expect(planTool!.description).toContain('HOURS of planning');
  });
});

describe('Server instructions', () => {
  it('exports behavioral instructions', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toBeTruthy();
    expect(instructions.length).toBeGreaterThan(100);
  });

  it('includes guidance on when to use tools', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('checkpoint');
    expect(instructions).toContain('recall');
    expect(instructions).toContain('plan');
  });
});

describe('Error handling', () => {
  it('returns error message in MCP format', async () => {
    const { handleCheckpoint } = await import('../src/server');

    try {
      await handleCheckpoint({
        // Missing required description
        workspace: TEST_WORKSPACE
      } as any);
    } catch (error: any) {
      // Should throw, which will be caught by MCP server and formatted
      expect(error).toBeDefined();
    }
  });

  it('handles workspace errors gracefully', async () => {
    const { handleRecall } = await import('../src/server');

    // Non-existent workspace should return empty results, not error
    const result = await handleRecall({
      workspace: 'nonexistent-workspace-xyz'
    });

    expect(result.content[0]!.type).toBe('text');
    // Should indicate no results found
    expect(result.content[0]!.text.length).toBeGreaterThan(0);
  });
});
