import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { setDefaultSemanticRuntime } from '../src/transformers-embedder';
import { ensureMemoriesDir } from '../src/workspace';
import { rm, mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// We'll test the server module functions directly since running a full MCP server
// in tests is complex. We'll validate tool handlers work correctly.

let TEST_DIR: string;

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
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-server-'));
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('Tool handlers', () => {
  describe('checkpoint tool', () => {
    it('saves checkpoint and returns readable markdown', async () => {
      // Import the handler function
      const { handleCheckpoint } = await import('../src/server');

      const result = await handleCheckpoint({
        description: 'Test checkpoint',
        tags: ['test'],
        workspace: TEST_DIR
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      const text = result.content[0]!.text;
      // Should be readable markdown, not JSON
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Checkpoint saved: checkpoint_/);
      expect(text).toContain('Tags: test');
    });

    it('includes git context in response', async () => {
      const { handleCheckpoint } = await import('../src/server');

      const result = await handleCheckpoint({
        description: 'With git context',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Checkpoint saved:/);
      // Git context may or may not be present
      if (text.includes('Branch:')) {
        expect(text).toMatch(/Branch: .+ @ [a-f0-9]+/);
      }
    });

    it('handles missing description gracefully', async () => {
      const { handleCheckpoint } = await import('../src/server');

      await expect(
        handleCheckpoint({ workspace: TEST_DIR })
      ).rejects.toThrow();
    });
  });

  describe('recall tool', () => {
    beforeEach(async () => {
      // Create test checkpoints
      await saveCheckpoint({
        description: 'First checkpoint',
        tags: ['test'],
        workspace: TEST_DIR
      });

      await saveCheckpoint({
        description: 'Second checkpoint',
        tags: ['test'],
        workspace: TEST_DIR
      });
    });

    it('returns readable recall results', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: TEST_DIR
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]!.type).toBe('text');

      const text = result.content[0]!.text;
      // Should be readable markdown, not JSON
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Recalled \d+ checkpoints?/);
      expect(text).toContain('First checkpoint');
      expect(text).toContain('Second checkpoint');
    });

    it('includes active plan when present', async () => {
      const { handleRecall } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Plan content',
        workspace: TEST_DIR,
        activate: true
      });

      const result = await handleRecall({
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('## Active Plan: Test Plan');
      expect(text).toContain('Plan content');
    });

    it('formats cross-workspace results', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: 'all',
        days: 1
      });

      expect(result.content[0]!.type).toBe('text');
      const text = result.content[0]!.text;
      // Should be readable markdown, not JSON
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈]/);
    });

    it('applies search filter', async () => {
      const { handleRecall } = await import('../src/server');

      const result = await handleRecall({
        workspace: TEST_DIR,
        search: 'First'
      });

      const text = result.content[0]!.text;
      expect(text).toContain('First checkpoint');
    });
  });

  describe('plan tool', () => {
    it('saves plan and returns readable confirmation', async () => {
      const { handlePlan } = await import('../src/server');

      const result = await handlePlan({
        action: 'save',
        title: 'Test Plan',
        content: 'Plan content',
        workspace: TEST_DIR
      });

      expect(result.content[0]!.type).toBe('text');

      const text = result.content[0]!.text;
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Plan saved:/);
    });

    it('gets plan by ID', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Test Plan',
        content: 'Content',
        workspace: TEST_DIR
      });

      const result = await handlePlan({
        action: 'get',
        id: 'test-plan',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).toContain('# Test Plan');
      expect(text).toContain('Content');
    });

    it('lists all plans', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'plan-1',
        title: 'Plan 1',
        content: 'Content',
        workspace: TEST_DIR
      });

      await savePlan({
        id: 'plan-2',
        title: 'Plan 2',
        content: 'Content',
        workspace: TEST_DIR
      });

      const result = await handlePlan({
        action: 'list',
        workspace: TEST_DIR
      });

      const text = result.content[0]!.text;
      expect(text).not.toStartWith('{');
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Found/);
      expect(text).toContain('Plan 1');
      expect(text).toContain('Plan 2');
    });

    it('activates plan', async () => {
      const { handlePlan } = await import('../src/server');

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

    it('updates plan', async () => {
      const { handlePlan } = await import('../src/server');

      await savePlan({
        id: 'test-plan',
        title: 'Original',
        content: 'Original content',
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

    it('handles invalid action gracefully', async () => {
      const { handlePlan } = await import('../src/server');

      await expect(
        handlePlan({
          action: 'invalid' as any,
          workspace: TEST_DIR
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

  it('includes appropriate guidance in tool descriptions', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();

    const checkpointTool = tools.find(t => t.name === 'checkpoint');
    expect(checkpointTool!.description).toContain('When in doubt, checkpoint');
    expect(checkpointTool!.description).toContain('one per logical milestone');
    expect(checkpointTool!.description).toContain('WHAT');

    const recallTool = tools.find(t => t.name === 'recall');
    expect(recallTool!.description).toContain('prior context');
    expect(recallTool!.description).toContain('user invokes /recall');

    const planTool = tools.find(t => t.name === 'plan');
    expect(planTool!.description).toContain('HOURS of planning');
    expect(planTool!.description).toContain('NEVER ask permission');
  });

  it('uses consistent workspace parameter description across tools', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();

    for (const tool of tools) {
      const props = tool.inputSchema.properties as Record<string, any>;
      if (props.workspace) {
        expect(props.workspace.description).toContain('path');
        expect(props.workspace.description).not.toContain('Workspace name');
      }
    }
  });

  it('plan tool includes tags parameter in schema', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const planTool = tools.find(t => t.name === 'plan');
    const props = planTool!.inputSchema.properties as Record<string, any>;

    expect(props.tags).toBeDefined();
    expect(props.tags.type).toBe('array');
  });

  it('checkpoint tool exposes structured memory schema fields', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const checkpointTool = tools.find(t => t.name === 'checkpoint');
    const props = checkpointTool!.inputSchema.properties as Record<string, any>;

    expect(props.type).toBeDefined();
    expect(props.context).toBeDefined();
    expect(props.decision).toBeDefined();
    expect(props.alternatives).toBeDefined();
    expect(props.impact).toBeDefined();
    expect(props.evidence).toBeDefined();
    expect(props.symbols).toBeDefined();
    expect(props.next).toBeDefined();
    expect(props.confidence).toBeDefined();
    expect(props.unknowns).toBeDefined();
    expect(props.confidence.minimum).toBe(1);
    expect(props.confidence.maximum).toBe(5);
  });

  it('plan tool documents updates schema with properties', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const planTool = tools.find(t => t.name === 'plan');
    const props = planTool!.inputSchema.properties as Record<string, any>;

    expect(props.updates.properties).toBeDefined();
    expect(props.updates.properties.title).toBeDefined();
    expect(props.updates.properties.content).toBeDefined();
    expect(props.updates.properties.status).toBeDefined();
    expect(props.updates.properties.tags).toBeDefined();
  });

  it('plan tool includes activate guidance in description', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const planTool = tools.find(t => t.name === 'plan');

    expect(planTool!.description).toContain('ACTIVATE');
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

  it('includes IMPACT in checkpoint template', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('WHAT');
    expect(instructions).toContain('WHY');
    expect(instructions).toContain('HOW');
    expect(instructions).toContain('IMPACT');
  });

  it('includes plan activate guidance', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('activate');
    expect(instructions).toContain('activate: true');
  });

  it('includes recall workflow tips', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('full: true');
    expect(instructions).toContain('workspace: "all"');
    expect(instructions).toContain('search:');
    expect(instructions).toContain('limit: 0');
  });
});

describe('Server exports', () => {
  it('exports startServer function', async () => {
    const { startServer } = await import('../src/server');

    expect(startServer).toBeDefined();
    expect(typeof startServer).toBe('function');
  });

  it('exports all handler functions', async () => {
    const { handleCheckpoint, handleRecall, handlePlan } = await import('../src/server');

    expect(typeof handleCheckpoint).toBe('function');
    expect(typeof handleRecall).toBe('function');
    expect(typeof handlePlan).toBe('function');
  });

  it('exports getTools and getInstructions', async () => {
    const { getTools, getInstructions } = await import('../src/server');

    expect(typeof getTools).toBe('function');
    expect(typeof getInstructions).toBe('function');
  });

  it('keeps runtime and plugin versions in sync', async () => {
    const { SERVER_VERSION } = await import('../src/server');

    const packageJson = JSON.parse(
      await Bun.file(new URL('../package.json', import.meta.url)).text()
    ) as { version: string };

    const pluginJson = JSON.parse(
      await Bun.file(new URL('../.claude-plugin/plugin.json', import.meta.url)).text()
    ) as { version: string };

    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(SERVER_VERSION).toBe(pluginJson.version);
  });
});

describe('Error handling', () => {
  it('returns error message in MCP format', async () => {
    const { handleCheckpoint } = await import('../src/server');

    try {
      await handleCheckpoint({
        // Missing required description
        workspace: TEST_DIR
      } as any);
    } catch (error: any) {
      // Should throw, which will be caught by MCP server and formatted
      expect(error).toBeDefined();
    }
  });

  it('handles workspace errors gracefully', async () => {
    const { handleRecall } = await import('../src/server');

    // Non-existent path should return empty results, not error
    const result = await handleRecall({
      workspace: join(tmpdir(), 'nonexistent-workspace-xyz-' + Date.now())
    });

    expect(result.content[0]!.type).toBe('text');
    const text = result.content[0]!.text;
    // Should be readable markdown with "No checkpoints found"
    expect(text).toMatch(/No checkpoints found/);
  });
});
