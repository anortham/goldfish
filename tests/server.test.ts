import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { saveBrief } from '../src/briefs';
import { ensureMemoriesDir } from '../src/workspace';
import { registerProject } from '../src/registry';
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

      await saveBrief({
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

});

describe('Tool descriptions', () => {
  it('exports tool definitions with descriptions', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();

    // Phase 2 deletes the `consolidate` tool. Phase 3 deletes the `plan`
    // compatibility alias. Pin the v7.0 final shape here so both phases see
    // the failure they need.
    expect(tools).toHaveLength(3);
    expect(tools.map(t => t.name)).toEqual(['checkpoint', 'recall', 'brief']);

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
    expect(recallTool!.description).not.toContain('Fuzzy search');
    expect(recallTool!.description).not.toContain('fuzzy search');

    const briefTool = tools.find(t => t.name === 'brief');
    expect(briefTool!.description).toContain('strategic context');

    // Phase 2/3: `plan` and `consolidate` are removed from the tool list.
    expect(tools.find(t => t.name === 'plan')).toBeUndefined();
    expect(tools.find(t => t.name === 'consolidate')).toBeUndefined();
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

  it('publishes brief as the canonical forward-looking tool', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const briefTool = tools.find(t => t.name === 'brief');

    expect(briefTool).toBeDefined();
    expect(briefTool!.description).toContain('brief');
  });

  it('documents the brief delete action and id requirement', async () => {
    const { getTools } = await import('../src/server');

    const tools = getTools();
    const briefTool = tools.find(t => t.name === 'brief')!;
    const props = briefTool.inputSchema.properties as Record<string, any>;

    expect(props.action.enum).toContain('delete');
    expect(props.id.description).toContain('delete');
    expect(briefTool.description).toContain('- delete:');
    expect(briefTool.description).toContain('requires an id');
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
    expect(instructions).toContain('brief');
    expect(instructions).not.toContain('plan({');
    expect(instructions).not.toContain('Active Plan');
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

  it('includes brief activate guidance', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('activate');
    expect(instructions).toContain('activate: true');
  });

  it('includes brief lifecycle triggers, not just save guidance', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('update it when goals or constraints shift');
    expect(instructions).toContain('complete it when the work lands');
    expect(instructions).toContain('archive it when superseded');
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

  it('migrates session-start hook nudges into the instructions string', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    // Nudge 1: checkpoint BEFORE git commits, not after, so the checkpoint
    // file is included in the commit and travels to other machines.
    expect(instructions).toContain('BEFORE a git commit');
    expect(instructions).toContain('other machines');

    // Nudge 2: always commit .memories/, never gitignore it. Already present
    // in the Source Control section but pinned here so the regression is loud.
    expect(instructions).toContain('.memories/');
    expect(instructions).toContain('.gitignore');

    // Nudge 3: don't ask permission to checkpoint or save briefs.
    expect(instructions).toContain("Don't ask permission");
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
    const serverModule = await import('../src/server');

    expect(typeof serverModule.handleCheckpoint).toBe('function');
    expect(typeof serverModule.handleRecall).toBe('function');
    expect(typeof serverModule.handleBrief).toBe('function');

    // Phase 2/3: plan and consolidate handlers are removed from the server.
    expect((serverModule as Record<string, unknown>).handlePlan).toBeUndefined();
    expect((serverModule as Record<string, unknown>).handleConsolidate).toBeUndefined();
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

    const codexPluginJson = JSON.parse(
      await Bun.file(new URL('../.codex-plugin/plugin.json', import.meta.url)).text()
    ) as { version: string };

    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(SERVER_VERSION).toBe(pluginJson.version);
    expect(SERVER_VERSION).toBe(codexPluginJson.version);
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

  it('documents the current release in the changelog', async () => {
    const { SERVER_VERSION } = await import('../src/server');

    const changelog = await Bun.file(new URL('../CHANGELOG.md', import.meta.url)).text();

    expect(changelog).toContain(`## [${SERVER_VERSION}]`);
  });

  it('includes a script to sync repo-local agent skills', async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL('../package.json', import.meta.url)).text()
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts!['sync:agent-skills']).toBeDefined();
    expect(packageJson.scripts!['sync:agent-skills']).toContain('scripts/sync-agent-skills.ts');
  });

  it('keeps prepare safe outside a git checkout', async () => {
    const packageJson = JSON.parse(
      await Bun.file(new URL('../package.json', import.meta.url)).text()
    ) as { scripts?: Record<string, string> };
    const tempDir = await mkdtemp(join(tmpdir(), 'test-prepare-no-git-'));
    await writeFile(join(tempDir, 'package.json'), JSON.stringify({
      name: 'prepare-smoke',
      scripts: { prepare: packageJson.scripts!['prepare'] }
    }));

    try {
      const result = Bun.spawnSync(['bun', 'run', 'prepare'], {
        cwd: tempDir,
        stdout: 'pipe',
        stderr: 'pipe'
      });

      expect(result.exitCode).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
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

    expect(readme).toContain('cross-client MCP memory system');
    expect(readme).toContain('### Claude Code');
    expect(readme).toContain('### Codex');
    expect(readme).toContain('Codex Desktop does not send MCP roots');
    expect(readme).toContain('project-local `.codex/config.toml`');
    expect(readme).toContain('env = { GOLDFISH_WORKSPACE = "/absolute/path/to/your/project" }');
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

  it('keeps recall guidance free of deleted consolidation concepts', async () => {
    const recallSkill = await Bun.file(new URL('../skills/recall/SKILL.md', import.meta.url)).text();

    expect(recallSkill).toContain('Active brief');
    expect(recallSkill).toContain('Checkpoints');
    expect(recallSkill).toContain('Workspace summaries');
    expect(recallSkill).not.toContain('Consolidated memory');
    expect(recallSkill).not.toContain('consolidation.needed');
    expect(recallSkill).not.toContain('/consolidate');
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

  it('retries roots lookup when the first call returns an empty list', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'test-server-root-late-'));
    const home = await mkdtemp(join(tmpdir(), 'test-server-home-late-'));
    const originalHome = process.env.HOME;
    process.chdir(home);
    process.env.HOME = process.cwd();
    const roots: Array<{ uri: string }> = [];
    const connection = await connectServerWithRoots(() => roots);

    try {
      // First tool call arrives before the client has populated roots. Empty
      // roots must not be cached as a permanent failure: the cwd fallback here
      // points at a home directory and is rejected.
      const firstAttempt = await connection.client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });
      expect(firstAttempt.isError).toBe(true);
      expect(getFirstTextContent(firstAttempt).toLowerCase()).toContain('home directory');
      expect(connection.rootsCalls).toBe(1);

      // Client now advertises the real project root.
      roots.push({ uri: pathToFileURL(rootDir).href });

      const checkpoint = await connection.client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint after roots populated' }
      });
      expect(checkpoint.isError).not.toBe(true);
      expect(connection.rootsCalls).toBe(2);

      const recall = await connection.client.callTool({
        name: 'recall',
        arguments: { workspace: rootDir, full: true }
      });
      expect(getFirstTextContent(recall)).toContain('checkpoint after roots populated');
      expect((await stat(join(rootDir, '.memories'))).isDirectory()).toBe(true);
    } finally {
      await Promise.all([connection.client.close(), connection.server.close()]);
      process.chdir(ORIGINAL_CWD);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(rootDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it('retries roots lookup after a failed first call', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'test-server-root-fail-'));
    const home = await mkdtemp(join(tmpdir(), 'test-server-home-fail-'));
    const originalHome = process.env.HOME;
    process.chdir(home);
    process.env.HOME = process.cwd();
    let roots: Array<{ uri: string }> | 'throw' = 'throw';
    const { createServer } = await import('../src/server');

    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } }
    );
    let rootsCalls = 0;
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsCalls += 1;
      if (roots === 'throw') {
        throw new Error('roots/list temporarily unavailable');
      }
      return { roots };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ]);

      const firstAttempt = await client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });
      expect(firstAttempt.isError).toBe(true);
      expect(getFirstTextContent(firstAttempt).toLowerCase()).toContain('home directory');
      expect(rootsCalls).toBe(1);

      roots = [{ uri: pathToFileURL(rootDir).href }];

      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint after roots recover' }
      });
      expect(checkpoint.isError).not.toBe(true);
      expect(rootsCalls).toBe(2);

      const recall = await client.callTool({
        name: 'recall',
        arguments: { workspace: rootDir, full: true }
      });
      expect(getFirstTextContent(recall)).toContain('checkpoint after roots recover');
      expect((await stat(join(rootDir, '.memories'))).isDirectory()).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(rootDir, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
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

  it('falls back to cwd when roots lookup never settles', async () => {
    const cwdFallback = await mkdtemp(join(tmpdir(), 'test-server-cwd-hung-roots-'));
    process.chdir(cwdFallback);

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } }
    );
    let rootsCalls = 0;
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsCalls += 1;
      return await new Promise<never>(() => {});
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ]);

      const checkpoint = await Promise.race([
        client.callTool({
          name: 'checkpoint',
          arguments: { description: 'checkpoint through hung roots fallback' }
        }),
        new Promise<'timed out'>(resolve => setTimeout(() => resolve('timed out'), 1200))
      ]);

      if (checkpoint === 'timed out') {
        throw new Error('checkpoint call did not return when roots/list never settled');
      }
      expect(checkpoint.isError).not.toBe(true);
      expect(rootsCalls).toBe(1);

      const recall = await client.callTool({
        name: 'recall',
        arguments: { workspace: cwdFallback, full: true }
      });

      const text = getFirstTextContent(recall);
      expect(text).toContain('checkpoint through hung roots fallback');
      expect((await stat(join(cwdFallback, '.memories'))).isDirectory()).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      await rm(cwdFallback, { recursive: true, force: true });
    }
  });

  it('rejects filesystem-root cwd fallback with a helpful error', async () => {
    process.chdir('/');
    delete process.env.GOLDFISH_WORKSPACE;

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

      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'should be rejected' }
      });

      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text).toContain('GOLDFISH_WORKSPACE');
      expect(text.toLowerCase()).toContain('filesystem root');
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
    }
  });

  it('rejects home-directory cwd fallback with a helpful error', async () => {
    const originalHome = process.env.HOME;
    const homeFallback = await mkdtemp(join(tmpdir(), 'test-server-home-'));
    process.chdir(homeFallback);
    process.env.HOME = process.cwd();
    delete process.env.GOLDFISH_WORKSPACE;

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

      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'should be rejected' }
      });

      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text).toContain('GOLDFISH_WORKSPACE');
      expect(text.toLowerCase()).toContain('home directory');
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(homeFallback, { recursive: true, force: true });
    }
  });

  it('allows GOLDFISH_WORKSPACE=/ as an explicit user override', async () => {
    process.chdir('/');
    process.env.GOLDFISH_WORKSPACE = '/';

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

      const result = await client.callTool({
        name: 'recall',
        arguments: { workspace: 'current', limit: 1 }
      });

      // We don't assert success of the storage operation (cwd=/ is read-only on
      // most CI machines anyway). The contract is: explicit env override is not
      // pre-rejected with the filesystem-root guard.
      const text = getFirstTextContent(result);
      expect(text.toLowerCase()).not.toContain('filesystem root');
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      delete process.env.GOLDFISH_WORKSPACE;
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

describe('Workspace recovery (registry + parent walk)', () => {
  const ORIGINAL_GOLDFISH_HOME = process.env.GOLDFISH_HOME;
  const ORIGINAL_HOME = process.env.HOME;
  const ORIGINAL_CWD = process.cwd();
  const isolatedDirs: string[] = [];

  async function isolatedGoldfishHome(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'test-goldfish-home-'));
    isolatedDirs.push(dir);
    process.env.GOLDFISH_HOME = dir;
    return dir;
  }

  async function makeProject(name: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), `test-recovery-${name}-`));
    isolatedDirs.push(dir);
    await mkdir(join(dir, '.memories'), { recursive: true });
    return dir;
  }

  // Registry-sourced workspace paths are reported with forward slashes (see
  // normalizePath in src/registry.ts), while mkdtemp returns native
  // separators on Windows — compare separator-insensitively.
  function expectTextToContainPath(text: string, p: string): void {
    expect(text.replace(/\\/g, '/')).toContain(p.replace(/\\/g, '/'));
  }

  async function connectWithoutRoots() {
    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      // No roots capability — simulates Cursor plugin installs.
      {}
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);
    return { server, client };
  }

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_GOLDFISH_HOME === undefined) delete process.env.GOLDFISH_HOME;
    else process.env.GOLDFISH_HOME = ORIGINAL_GOLDFISH_HOME;
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    delete process.env.GOLDFISH_WORKSPACE;
    for (const dir of isolatedDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    isolatedDirs.length = 0;
  });

  it('recovers via registry-ancestor when cwd is a subdir of a registered project (no roots)', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('ancestor');
    await registerProject(project);
    // chdir into a subdir of the project — no roots advertised.
    const sub = join(project, 'src', 'deep');
    await mkdir(sub, { recursive: true });
    process.chdir(sub);

    const { server, client } = await connectWithoutRoots();
    try {
      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'recovered via registry ancestor' }
      });
      expect(checkpoint.isError).not.toBe(true);
      // .memories/ should land in the project root, not the subdir.
      expect((await stat(join(project, '.memories'))).isDirectory()).toBe(true);
      expect(await stat(join(sub, '.memories')).catch(() => null)).toBeNull();
      // The agent must be told where recovery landed so a wrong-but-plausible
      // root is visible, not silent.
      const text = getFirstTextContent(checkpoint);
      expect(text).toContain('Workspace:');
      expectTextToContainPath(text, project);
      expect(text.toLowerCase()).toContain('recovered');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('recovers via parent walk when cwd is a subdir of an unregistered project with .memories/', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('walk');
    // NOT registered — recovery must come from the parent walk.
    const sub = join(project, 'pkg');
    await mkdir(sub, { recursive: true });
    process.chdir(sub);

    const { server, client } = await connectWithoutRoots();
    try {
      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'recovered via parent walk' }
      });
      expect(checkpoint.isError).not.toBe(true);
      expect((await stat(join(project, '.memories'))).isDirectory()).toBe(true);
      expect(await stat(join(sub, '.memories')).catch(() => null)).toBeNull();
      // Walk-sourced recovery is surfaced too, with the walk source label.
      const text = getFirstTextContent(checkpoint);
      expect(text).toContain('Workspace:');
      expectTextToContainPath(text, project);
      expect(text.toLowerCase()).toContain('recovered');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('surfaces the recovered workspace in a brief save response', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('briefsurf');
    await registerProject(project);
    const sub = join(project, 'doc');
    await mkdir(sub, { recursive: true });
    process.chdir(sub);

    const { server, client } = await connectWithoutRoots();
    try {
      const result = await client.callTool({
        name: 'brief',
        arguments: {
          action: 'save',
          title: 'Recovery surface test',
          content: 'Ensure brief writes show where they landed.'
        }
      });
      expect(result.isError).not.toBe(true);
      const text = getFirstTextContent(result);
      expect(text).toContain('Brief saved');
      expect(text).toContain('Workspace:');
      expectTextToContainPath(text, project);
      expect(text.toLowerCase()).toContain('recovered');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('recovers via parent walk for first use in a git repo with no .memories/ yet', async () => {
    await isolatedGoldfishHome();
    const repo = await mkdtemp(join(tmpdir(), 'test-recovery-git-'));
    isolatedDirs.push(repo);
    await writeFile(join(repo, '.git'), '');
    const sub = join(repo, 'app');
    await mkdir(sub, { recursive: true });
    process.chdir(sub);

    const { server, client } = await connectWithoutRoots();
    try {
      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'first use in a git repo' }
      });
      expect(checkpoint.isError).not.toBe(true);
      // .memories/ created at the repo root, not the subdir.
      expect((await stat(join(repo, '.memories'))).isDirectory()).toBe(true);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('recall resolves via single-registered recovery when cwd is home and no roots (Cursor plugin scenario)', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('single');
    await registerProject(project);
    // Seed a checkpoint so recall has something to find at the recovered path.
    await saveCheckpoint({ description: 'seed checkpoint', workspace: project });

    const home = await mkdtemp(join(tmpdir(), 'test-recovery-home-'));
    isolatedDirs.push(home);
    process.chdir(home);
    process.env.HOME = home;

    const { server, client } = await connectWithoutRoots();
    try {
      const recall = await client.callTool({
        name: 'recall',
        arguments: { full: true }
      });
      expect(recall.isError).not.toBe(true);
      const text = getFirstTextContent(recall);
      expect(text).toContain('seed checkpoint');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('checkpoint refuses with Known projects when cwd is home, single-registered, no roots', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('singlemut');
    await registerProject(project);

    const home = await mkdtemp(join(tmpdir(), 'test-recovery-home-mut-'));
    isolatedDirs.push(home);
    process.chdir(home);
    process.env.HOME = home;

    // Snapshot .memories/ before the call. makeProject created only .memories/
    // itself; a successful checkpoint would add a date dir (e.g. 2026-06-26/).
    const { readdir: readdirBefore } = await import('fs/promises');
    const before = await readdirBefore(join(project, '.memories')).catch(() => []);

    const { server, client } = await connectWithoutRoots();
    try {
      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'should be refused with known projects' }
      });
      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text.toLowerCase()).toContain('home directory');
      expect(text).toContain('Known projects');
      expectTextToContainPath(text, project);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    // Must NOT have written anything: .memories/ contents are unchanged (no
    // new date dir, no stray files). This is the real correctness check — the
    // earlier assertion only confirmed .memories/ existed, which makeProject
    // already guaranteed, so a buggy recovery that wrote here would have passed.
    const { readdir: readdirAfter } = await import('fs/promises');
    const after = await readdirAfter(join(project, '.memories')).catch(() => []);
    expect(after.sort()).toEqual(before.sort());
    expect(after.some(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry))).toBe(false);
  });

  it('brief refuses with Known projects when cwd is home, single-registered, no roots', async () => {
    // Mirror of the checkpoint refusal test for the other mutating tool. Brief
    // must also refuse (not 4b-recover) when cwd is unsafe and only one project
    // is registered, and must not write a brief file into the project.
    await isolatedGoldfishHome();
    const project = await makeProject('singlebrief');
    await registerProject(project);

    const home = await mkdtemp(join(tmpdir(), 'test-recovery-home-brief-'));
    isolatedDirs.push(home);
    process.chdir(home);
    process.env.HOME = home;

    const { readdir: readdirBefore } = await import('fs/promises');
    const before = await readdirBefore(join(project, '.memories')).catch(() => []);

    const { server, client } = await connectWithoutRoots();
    try {
      const result = await client.callTool({
        name: 'brief',
        arguments: { action: 'save', title: 'should be refused', content: 'nope' }
      });
      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text.toLowerCase()).toContain('home directory');
      expect(text).toContain('Known projects');
      expectTextToContainPath(text, project);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    // No briefs/ dir or brief file written by the refused call.
    const { readdir: readdirAfter, stat: statAfter } = await import('fs/promises');
    const after = await readdirAfter(join(project, '.memories')).catch(() => []);
    expect(after.sort()).toEqual(before.sort());
    const briefsDir = await statAfter(join(project, '.memories', 'briefs')).catch(() => null);
    expect(briefsDir?.isDirectory()).toBeFalsy();
  });

  it('checkpoint refuses when $HOME itself is the registered project (no silent home write)', async () => {
    // F1 regression guard (end-to-end): if home was registered as a project
    // (e.g. the user once ran goldfish from ~), a mutating tool with cwd=home
    // must still refuse — 4a must not recover to the unsafe registered home.
    await isolatedGoldfishHome();
    const home = await mkdtemp(join(tmpdir(), 'test-recovery-home-registered-'));
    isolatedDirs.push(home);
    await mkdir(join(home, '.memories'), { recursive: true });
    await registerProject(home);

    process.chdir(home);
    process.env.HOME = home;

    const { readdir: readdirBefore } = await import('fs/promises');
    const before = await readdirBefore(join(home, '.memories')).catch(() => []);

    const { server, client } = await connectWithoutRoots();
    try {
      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'must not recover to registered home' }
      });
      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text.toLowerCase()).toContain('home directory');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }

    // Nothing written into home/.memories/ by the refused call.
    const { readdir: readdirAfter } = await import('fs/promises');
    const after = await readdirAfter(join(home, '.memories')).catch(() => []);
    expect(after.sort()).toEqual(before.sort());
    expect(after.some(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry))).toBe(false);
  });

  it('does not read the real ~/.goldfish/registry.json — isolation via GOLDFISH_HOME', async () => {
    // With an isolated (empty) goldfish home and a home cwd with no markers,
    // recovery must find nothing and refuse — regardless of the real user's
    // registry. This proves tests never depend on real registry state.
    const home = await mkdtemp(join(tmpdir(), 'test-recovery-iso-'));
    isolatedDirs.push(home);
    await isolatedGoldfishHome();
    process.chdir(home);
    process.env.HOME = home;

    const { server, client } = await connectWithoutRoots();
    try {
      const result = await client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });
      // Empty isolated registry + no markers + unsafe cwd -> refuse, no 4b.
      expect(result.isError).toBe(true);
      const text = getFirstTextContent(result);
      expect(text.toLowerCase()).toContain('home directory');
      // No "Known projects" line because the isolated registry is empty.
      expect(text).not.toContain('Known projects');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('roots arriving after a recovery still win on the next call (late roots)', async () => {
    await isolatedGoldfishHome();
    const project = await makeProject('lateroots');
    await registerProject(project);
    const sub = join(project, 'src');
    await mkdir(sub, { recursive: true });
    process.chdir(sub);

    // Client advertises roots from the start but serves an EMPTY list first,
    // then populates it — mirrors the 7.2.1 "roots arrive late" scenario but
    // with recovery also in play. First call must recover via registry-ancestor
    // (empty roots are not cached as permanent); once roots populate, the cache
    // is consulted and roots win.
    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { capabilities: { roots: { listChanged: true } } }
    );
    let roots: Array<{ uri: string }> = [];
    let rootsCalls = 0;
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      rootsCalls += 1;
      return { roots };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    try {
      // First call: roots list is empty -> recovery via registry-ancestor must
      // place .memories/ at the project root.
      const first = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'recovered before roots populated' }
      });
      expect(first.isError).not.toBe(true);
      expect((await stat(join(project, '.memories'))).isDirectory()).toBe(true);
      expect(rootsCalls).toBe(1);

      // Roots now populate; notify the server so its cache clears.
      roots = [{ uri: pathToFileURL(project).href }];
      await client.notification({ method: 'notifications/roots/list_changed' });

      const second = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'after roots populated' }
      });
      expect(second.isError).not.toBe(true);
      expect(rootsCalls).toBe(2);

      const recall = await client.callTool({
        name: 'recall',
        arguments: { workspace: project, full: true }
      });
      expect(getFirstTextContent(recall)).toContain('after roots populated');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});
