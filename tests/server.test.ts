import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { savePlan } from '../src/plans';
import { ensureMemoriesDir } from '../src/workspace';
import { rm, mkdtemp, mkdir, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// We'll test the server module functions directly since running a full MCP server
// in tests is complex. We'll validate tool handlers work correctly.

let TEST_DIR: string;
let restoreDeps: (() => void) | undefined;
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_GOLDFISH_WORKSPACE = process.env.GOLDFISH_WORKSPACE;

function getFirstTextContent(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    return '';
  }

  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }

  const first = content[0];
  if (first && typeof first === 'object' && 'type' in first && 'text' in first) {
    const typed = first as { type?: unknown; text?: unknown };
    if (typed.type === 'text' && typeof typed.text === 'string') {
      return typed.text;
    }
  }

  return '';
}

beforeEach(async () => {
  TEST_DIR = await mkdtemp(join(tmpdir(), 'test-server-'));
  restoreDeps = __setCheckpointDependenciesForTests({
    getGitContext: () => ({ branch: 'main', commit: 'abc1234' })
  });
  delete process.env.GOLDFISH_WORKSPACE;
  process.chdir(ORIGINAL_CWD);
  await ensureMemoriesDir(TEST_DIR);
});

afterEach(async () => {
  restoreDeps?.();
  restoreDeps = undefined;
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_GOLDFISH_WORKSPACE === undefined) delete process.env.GOLDFISH_WORKSPACE;
  else process.env.GOLDFISH_WORKSPACE = ORIGINAL_GOLDFISH_WORKSPACE;
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
        handleCheckpoint({ workspace: TEST_DIR } as any)
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

    it('includes active brief when present', async () => {
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
      expect(text).toContain('## Active Brief: Test Plan');
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
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Brief saved:/);
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
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Brief activated: test-plan/);
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
      expect(text).toMatch(/[🐠🐟🐡🐋🐳🦈] Brief updated: test-plan/);
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

    expect(tools).toHaveLength(5);
    expect(tools.map(t => t.name)).toEqual(['checkpoint', 'recall', 'brief', 'plan', 'consolidate']);

    // Each tool should have description and inputSchema
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description!.length).toBeGreaterThan(50);
      // Claude Code caps MCP tool descriptions at 2000 characters
      expect(tool.description!.length).toBeLessThanOrEqual(2000);
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

    const briefTool = tools.find(t => t.name === 'brief');
    const planTool = tools.find(t => t.name === 'plan');
    expect(briefTool!.description).toContain('strategic context');
    expect(planTool!.description).toContain('Compatibility alias');
    expect(planTool!.description).toContain('Use `brief` for new work');
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

  it('publishes brief as the canonical forward-looking tool', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const briefTool = tools.find(t => t.name === 'brief');

    expect(briefTool).toBeDefined();
    expect(briefTool!.description).toContain('brief');
  });

  it('plan tool includes activate guidance in description', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const planTool = tools.find(t => t.name === 'plan');

    expect(planTool!.description).toContain('Saving an active plan makes it active by default');
    expect(planTool!.description).toContain('activate: false preserves the opt-out');
  });
});

describe('Server instructions', () => {
  it('exports behavioral instructions', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toBeTruthy();
    expect(instructions.length).toBeGreaterThan(100);
    // Claude Code caps MCP server instructions at 2000 characters
    expect(instructions.length).toBeLessThanOrEqual(2000);
  });

  it('includes guidance on when to use tools', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('checkpoint');
    expect(instructions).toContain('recall');
    expect(instructions).toContain('plan');
  });

  it('defers checkpoint formatting guidance to tool description', async () => {
    const { getInstructions } = await import('../src/server');
    const { getTools } = await import('../src/tools');

    const instructions = getInstructions();
    const checkpointTool = getTools().find(t => t.name === 'checkpoint')!;

    // Instructions reference the tool, not duplicate content
    expect(instructions).toContain('checkpoint tool description');
    // Quality guidance lives in the tool description
    expect(checkpointTool.description).toContain('WHAT');
    expect(checkpointTool.description).toContain('IMPACT');
  });

  it('includes plan activate guidance', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('activate');
    expect(instructions).toContain('activate: true');
  });

  it('defers recall parameter tips to tool description', async () => {
    const { getInstructions } = await import('../src/server');
    const { getTools } = await import('../src/tools');

    const instructions = getInstructions();
    const recallTool = getTools().find(t => t.name === 'recall')!;

    // Instructions keep behavioral guidance
    expect(instructions).toContain('Trust recalled context');
    // Parameter details live in the tool description
    expect(recallTool.description).toContain('full:');
    expect(recallTool.description).toContain('workspace:');
    expect(recallTool.description).toContain('search:');
  });
});

describe('Server exports', () => {
  it('exports startServer function', async () => {
    const { createServer, startServer } = await import('../src/server');

    expect(createServer).toBeDefined();
    expect(typeof createServer).toBe('function');
    expect(startServer).toBeDefined();
    expect(typeof startServer).toBe('function');
  });

  it('exports all handler functions', async () => {
    const { handleCheckpoint, handleRecall, handleBrief, handlePlan, handleConsolidate } = await import('../src/server');

    expect(typeof handleCheckpoint).toBe('function');
    expect(typeof handleRecall).toBe('function');
    expect(typeof handleBrief).toBe('function');
    expect(typeof handlePlan).toBe('function');
    expect(typeof handleConsolidate).toBe('function');
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

  it('keeps marketplace metadata and README inventory aligned with the current release', async () => {
    const { SERVER_VERSION } = await import('../src/server');
    const { readdir } = await import('fs/promises');

    const marketplaceJson = JSON.parse(
      await Bun.file(new URL('../.claude-plugin/marketplace.json', import.meta.url)).text()
    ) as { plugins: Array<{ version: string }> };

    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
    const skillDirs = (await readdir(new URL('../skills/', import.meta.url), { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    const readmeSkillTable = Array.from(
      readme.matchAll(/^\| `\/([^`]+)` \|/gm),
      match => match[1]!
    );

    expect(marketplaceJson.plugins[0]!.version).toBe(SERVER_VERSION);
    expect(readme).toContain(`**Version ${SERVER_VERSION}**`);
    expect(readme).toContain(`${skillDirs.length} skills`);
    expect(readmeSkillTable).toEqual(skillDirs);
  });

  it('includes a script to sync repo-local agent skills', async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL('../package.json', import.meta.url)).text()
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts!['sync:agent-skills']).toBeDefined();
    expect(packageJson.scripts!['sync:agent-skills']).toContain('scripts/sync-agent-skills.ts');
  });

  it('keeps canonical skills and repo-local agent skills mirrored', async () => {
    const { readdir } = await import('fs/promises');

    const canonicalSkillsDir = new URL('../skills/', import.meta.url);
    const mirroredSkillsDir = new URL('../.agents/skills/', import.meta.url);

    const canonicalSkillDirs = (await readdir(canonicalSkillsDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    const mirroredSkillDirs = (await readdir(mirroredSkillsDir, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    expect(mirroredSkillDirs).toEqual(canonicalSkillDirs);

    for (const skillDir of canonicalSkillDirs) {
      const canonicalContent = await Bun.file(new URL(`../skills/${skillDir}/SKILL.md`, import.meta.url)).text();
      const mirroredContent = await Bun.file(new URL(`../.agents/skills/${skillDir}/SKILL.md`, import.meta.url)).text();
      expect(mirroredContent).toBe(canonicalContent);
    }
  });

  it('documents Goldfish as a cross-client memory system with first-class client setup guides', async () => {
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();

    expect(readme).toContain('Persistent developer memory for MCP-compatible coding clients.');
    expect(readme).toContain('### Claude Code');
    expect(readme).toContain('### Codex Desktop');
    expect(readme).toContain('### OpenCode');
    expect(readme).toContain('### VS Code with GitHub Copilot');
  });

  it('keeps package and plugin metadata client-neutral', async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL('../package.json', import.meta.url)).text()
    ) as { description: string };
    const pluginJson = JSON.parse(
      await Bun.file(new URL('../.claude-plugin/plugin.json', import.meta.url)).text()
    ) as { description: string };
    const marketplaceJson = JSON.parse(
      await Bun.file(new URL('../.claude-plugin/marketplace.json', import.meta.url)).text()
    ) as { metadata: { description: string }, plugins: Array<{ description: string }> };

    expect(packageJson.description).toContain('MCP');
    expect(packageJson.description).not.toContain('Claude Code plugin');
    expect(pluginJson.description).not.toContain('Claude Code plugin');
    expect(marketplaceJson.metadata.description).not.toContain('Claude Code plugin');
    expect(marketplaceJson.plugins[0]!.description).not.toContain('Claude Code plugin');
  });

  it('documents VS Code roots support as an optional workspace override', async () => {
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
    const vscodeInstructions = await Bun.file(new URL('../docs/goldfish-checkpoint.instructions-vs-code.md', import.meta.url)).text();

    expect(readme).toContain('`GOLDFISH_WORKSPACE` is optional');
    expect(readme).toContain('agent plugins preview can also load Claude-format plugins');
    expect(vscodeInstructions).toContain('`GOLDFISH_WORKSPACE` is optional');
  });

  it('keeps standup focused on briefs and checkpoints', async () => {
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
    const standupSkill = await Bun.file(new URL('../skills/standup/SKILL.md', import.meta.url)).text();

    expect(readme).toContain('Standup reports are built from briefs and checkpoints, not `docs/plans/`.');
    expect(standupSkill).toContain('brief');
    expect(standupSkill).toContain('checkpoint');
    expect(standupSkill).not.toContain('docs/plans/');
  });
});

describe('Request-time workspace hydration', () => {
  async function connectServerWithRoots(getRoots: () => Array<{ uri: string }>, rootsCapability = true) {
    const { createServer } = await import('../src/server');

    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      rootsCapability ? { capabilities: { roots: { listChanged: true } } } : {}
    );
    let rootsCalls = 0;

    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsCalls += 1;
      return { roots: getRoots() };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    return {
      client,
      server,
      get rootsCalls() {
        return rootsCalls;
      }
    };
  }

  it('does not request roots until a tool call needs a default workspace', async () => {
    const connection = await connectServerWithRoots(() => [{ uri: pathToFileURL(TEST_DIR).href }]);

    try {
      expect(connection.rootsCalls).toBe(0);

      const result = await connection.client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint through lazy roots lookup' }
      });

      expect(result.isError).not.toBe(true);
      expect(connection.rootsCalls).toBe(1);
    } finally {
      await Promise.all([connection.client.close(), connection.server.close()]);
    }
  });

  it('hydrates missing and current workspace arguments from roots', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'test-server-root-'));
    const connection = await connectServerWithRoots(() => [{ uri: pathToFileURL(rootDir).href }]);

    try {
      const firstCheckpoint = await connection.client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint without workspace' }
      });
      expect(firstCheckpoint.isError).not.toBe(true);

      const secondCheckpoint = await connection.client.callTool({
        name: 'checkpoint',
        arguments: {
          description: 'checkpoint with current workspace',
          workspace: 'current'
        }
      });
      expect(secondCheckpoint.isError).not.toBe(true);

      expect((await stat(join(rootDir, '.memories'))).isDirectory()).toBe(true);
      expect(connection.rootsCalls).toBe(1);

      const recall = await connection.client.callTool({
        name: 'recall',
        arguments: { workspace: rootDir, full: true }
      });

      const text = getFirstTextContent(recall);
      expect(text).toContain('checkpoint without workspace');
      expect(text).toContain('checkpoint with current workspace');
    } finally {
      await Promise.all([connection.client.close(), connection.server.close()]);
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('refreshes cached roots after notifications/roots/list_changed', async () => {
    const rootDirA = await mkdtemp(join(tmpdir(), 'test-server-root-a-'));
    const rootDirB = await mkdtemp(join(tmpdir(), 'test-server-root-b-'));
    let activeRoot = rootDirA;

    const connection = await connectServerWithRoots(() => [{ uri: pathToFileURL(activeRoot).href }]);

    try {
      const firstCheckpoint = await connection.client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint on root A' }
      });
      expect(firstCheckpoint.isError).not.toBe(true);

      expect(connection.rootsCalls).toBe(1);

      activeRoot = rootDirB;
      await connection.client.notification({ method: 'notifications/roots/list_changed' });

      const secondCheckpoint = await connection.client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint on root B' }
      });
      expect(secondCheckpoint.isError).not.toBe(true);

      expect(connection.rootsCalls).toBe(2);

      const recallA = await connection.client.callTool({
        name: 'recall',
        arguments: { workspace: rootDirA, full: true }
      });
      const recallB = await connection.client.callTool({
        name: 'recall',
        arguments: { workspace: rootDirB, full: true }
      });

      const textA = getFirstTextContent(recallA);
      const textB = getFirstTextContent(recallB);

      expect(textA).toContain('checkpoint on root A');
      expect(textA).not.toContain('checkpoint on root B');
      expect(textB).toContain('checkpoint on root B');
    } finally {
      await Promise.all([connection.client.close(), connection.server.close()]);
      await rm(rootDirA, { recursive: true, force: true });
      await rm(rootDirB, { recursive: true, force: true });
    }
  });

  it('falls back to cwd when roots lookup is unavailable', async () => {
    const cwdFallback = await mkdtemp(join(tmpdir(), 'test-server-cwd-'));
    process.chdir(cwdFallback);

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      {}
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ]);

      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint through cwd fallback' }
      });
      expect(checkpoint.isError).not.toBe(true);

      const recall = await client.callTool({
        name: 'recall',
        arguments: { workspace: cwdFallback, full: true }
      });

      const text = getFirstTextContent(recall);
      expect(text).toContain('checkpoint through cwd fallback');
      expect((await stat(join(cwdFallback, '.memories'))).isDirectory()).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      await rm(cwdFallback, { recursive: true, force: true });
    }
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

describe('v7.0 legacy directory cleanup', () => {
  let tempGoldfishHome: string;
  const originalGoldfishHome = process.env.GOLDFISH_HOME;

  beforeEach(async () => {
    tempGoldfishHome = await mkdtemp(join(tmpdir(), 'goldfish-v7-cleanup-'));
    process.env.GOLDFISH_HOME = tempGoldfishHome;
  });

  afterEach(async () => {
    if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
    else process.env.GOLDFISH_HOME = originalGoldfishHome;
    await rm(tempGoldfishHome, { recursive: true, force: true });
  });

  it('removes ~/.goldfish/cache/semantic and ~/.goldfish/models/transformers when present', async () => {
    const { cleanupV7LegacyDirectories } = await import('../src/server');

    const semanticDir = join(tempGoldfishHome, 'cache', 'semantic');
    const modelsDir = join(tempGoldfishHome, 'models', 'transformers');

    await mkdir(join(semanticDir, 'workspace-hash-1'), { recursive: true });
    await writeFile(join(semanticDir, 'workspace-hash-1', 'records.jsonl'), '{"id":"x"}\n');
    await writeFile(join(semanticDir, 'workspace-hash-1', 'manifest.json'), '{}');
    await mkdir(join(modelsDir, 'Xenova', 'all-MiniLM-L6-v2'), { recursive: true });
    await writeFile(join(modelsDir, 'Xenova', 'all-MiniLM-L6-v2', 'model.bin'), 'fake-weights');

    await cleanupV7LegacyDirectories();

    await expect(stat(semanticDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(modelsDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('is a no-op when neither directory exists', async () => {
    const { cleanupV7LegacyDirectories } = await import('../src/server');

    // Directories intentionally absent — temp goldfish home is empty.
    await expect(cleanupV7LegacyDirectories()).resolves.toBeUndefined();

    await expect(stat(join(tempGoldfishHome, 'cache', 'semantic'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(tempGoldfishHome, 'models', 'transformers'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('swallows deletion errors silently', async () => {
    const { cleanupV7LegacyDirectories } = await import('../src/server');

    // Point GOLDFISH_HOME at a path that resolves to a file, not a directory.
    // rm({ recursive: true, force: true }) on a missing nested path is a no-op,
    // but on a path whose parent is a regular file we get ENOTDIR. The helper
    // must swallow that and resolve.
    const filePath = join(tempGoldfishHome, 'home-as-file');
    await writeFile(filePath, 'not a directory');
    process.env.GOLDFISH_HOME = filePath;

    await expect(cleanupV7LegacyDirectories()).resolves.toBeUndefined();
  });

  it('is invoked from createServer() without throwing', async () => {
    const { createServer, cleanupV7LegacyDirectories } = await import('../src/server');

    const semanticDir = join(tempGoldfishHome, 'cache', 'semantic');
    const modelsDir = join(tempGoldfishHome, 'models', 'transformers');
    await mkdir(semanticDir, { recursive: true });
    await mkdir(modelsDir, { recursive: true });

    // Trigger fire-and-forget cleanup via createServer(), then await directly
    // to deterministically observe the result without racing the background work.
    expect(() => createServer()).not.toThrow();
    await cleanupV7LegacyDirectories();

    await expect(stat(semanticDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(modelsDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
