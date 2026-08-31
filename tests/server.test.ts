import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint, getCheckpointsForDay, __setCheckpointDependenciesForTests } from '../src/checkpoints';
import { saveBrief } from '../src/briefs';
import { ensureMemoriesDir, WORKSPACE_UNBOUND_MESSAGE } from '../src/workspace';
import { registerProject } from '../src/registry';
import { rm, mkdtemp, mkdir, readdir, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';

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
    getGitContext: () => ({ branch: 'main', commit: 'abc1234' }),
    getOsUsername: () => undefined,
    getGitIdentity: async () => ({})
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

  it('exposes description_file as an alternative to inline description', async () => {
    const { getTools } = await import('../src/server');

    const checkpointTool = getTools().find(t => t.name === 'checkpoint')!;
    const schema = checkpointTool.inputSchema as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(schema.properties.description_file).toBeDefined();
    expect(schema.required ?? []).not.toContain('description');
    expect(checkpointTool.description).toContain('description_file');
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

  it('documents verified workspace binding for user-level calls', async () => {
    const { getTools } = await import('../src/server');

    const descriptions = getTools()
      .map(tool => (tool.inputSchema.properties as Record<string, any>).workspace?.description)
      .filter(Boolean);

    expect(descriptions).toHaveLength(3);
    expect(new Set(descriptions).size).toBe(1);

    const description = descriptions[0] as string;
    expect(description).toContain('Host-native absolute project/workspace path');
    expect(description).toContain('User-level MCP registrations must pass the conversation\'s host-native absolute project root');
    expect(description).toContain('fixed absolute GOLDFISH_WORKSPACE');
    expect(description).toContain('supported legacy Roots');
    expect(description).toContain('GOLDFISH_WORKSPACE');
    expect(description).toContain('legacy Roots');
    expect(description).toContain('workspace: "all"');
    expect(description).toContain('suggestions only');
    expect(description).toContain('{"workspace":"<absolute-project-root>"}');
    expect(description).not.toContain('defaults to current');
    expect(description).not.toContain('defaults to current directory');

    for (const tool of getTools()) {
      const schema = tool.inputSchema as { required?: string[] };
      expect(schema.required ?? []).not.toContain('workspace');
    }
  });

  it('shows an absolute workspace in current-project recall examples', async () => {
    const { getTools } = await import('../src/server');

    const description = getTools().find(tool => tool.name === 'recall')!.description!;
    const examples = description.slice(description.indexOf('Examples'))
      .match(/recall\(\{[^\n]*\}\)/g) ?? [];
    const currentProjectExamples = examples.filter(example => !example.includes('workspace: "all"'));

    expect(currentProjectExamples.length).toBeGreaterThan(0);
    for (const example of currentProjectExamples) {
      expect(example).toContain('workspace: "/absolute/path/to/project"');
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

  it('explains user-level workspace binding and explicit cross-project recall', async () => {
    const { getInstructions } = await import('../src/server');

    const instructions = getInstructions();

    expect(instructions).toContain('User-level MCP registrations must pass the conversation\'s host-native absolute project root');
    expect(instructions).toContain('host-native absolute project root');
    expect(instructions).toContain('fixed absolute GOLDFISH_WORKSPACE');
    expect(instructions).toContain('supported legacy Roots');
    expect(instructions).toContain('GOLDFISH_WORKSPACE');
    expect(instructions).toContain('legacy Roots');
    expect(instructions).toContain('workspace: "all"');
    expect(instructions).toContain('suggestions only');
    expect(instructions).toContain('{"workspace":"<absolute-project-root>"}');
    expect(instructions).not.toContain('defaults to current workspace');
    expect(instructions).not.toContain('registry recovery');
  });

  it('includes an absolute workspace in the brief example', async () => {
    const { getInstructions } = await import('../src/server');

    expect(getInstructions()).toContain('brief({ workspace: "/absolute/path/to/project", action: "save", title: "...", content: "..." })');
  });

  it('defers recall parameter tips to tool description', async () => {
    const { getInstructions } = await import('../src/server');
    const { getTools } = await import('../src/tools');

    const instructions = getInstructions();
    const recallTool = getTools().find(t => t.name === 'recall')!;

    expect(instructions).toContain('Treat recalled context as historical evidence');
    expect(instructions).toContain('verify current or drift-prone facts against live sources');
    expect(recallTool.description).toContain('verify current or drift-prone facts against live sources');
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

    const cursorPluginJson = JSON.parse(
      await Bun.file(new URL('../.cursor-plugin/plugin.json', import.meta.url)).text()
    ) as { version: string };

    expect(SERVER_VERSION).toBe(packageJson.version);
    expect(SERVER_VERSION).toBe(pluginJson.version);
    expect(SERVER_VERSION).toBe(codexPluginJson.version);
    expect(SERVER_VERSION).toBe(cursorPluginJson.version);
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

  it('keeps the Codex plugin skill inventory explicit and complete', async () => {
    const { readdir } = await import('fs/promises');
    const codexPlugin = JSON.parse(
      await Bun.file(new URL('../.codex-plugin/plugin.json', import.meta.url)).text()
    ) as { skills: string };
    const skillDirs = (await readdir(new URL('../skills/', import.meta.url), { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();

    expect(codexPlugin.skills).toBe('./skills/');
    expect(skillDirs).toEqual([
      'brief',
      'brief-status',
      'checkpoint',
      'handoff',
      'recall',
      'standup'
    ]);
  });

  it('documents Goldfish as a cross-client memory system with first-class client setup guides', async () => {
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();

    expect(readme).toContain('cross-client MCP memory system');
    expect(readme).toContain('### Claude Code');
    expect(readme).toContain('### Codex');
    expect(readme).toContain('codex plugin marketplace add');
    expect(readme).toContain('trust Goldfish');
    expect(readme).toContain('`.agents/skills`');
    expect(readme).toContain('Manual alternative');
    expect(readme).toContain('### Cursor');
    expect(readme).toContain('local plugin');
    expect(readme).toContain('reload');
    expect(readme).toContain('native hook');
    expect(readme).toContain('project `.cursor/mcp.json`');
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

  it('documents VS Code roots support alongside user-level workspace binding', async () => {
    const readme = await Bun.file(new URL('../README.md', import.meta.url)).text();
    const vscodeInstructions = await Bun.file(new URL('../docs/goldfish-checkpoint.instructions-vs-code.md', import.meta.url)).text();

    expect(readme).toContain('With a user-level VS Code registration, pass `workspace`');
    expect(readme).toContain('agent plugins preview can also load Claude-format plugins');
    expect(vscodeInstructions).toContain('User-level calls must pass the conversation\'s host-native absolute project root');
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
      {
        ...(rootsCapability ? { capabilities: { roots: { listChanged: true } } } : {}),
        versionNegotiation: { mode: 'legacy' }
      }
    );
    let rootsCalls = 0;

    client.setRequestHandler('roots/list', async () => {
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

  it('refuses an omitted workspace when the protocol adapter disables roots', async () => {
    const launchDir = await mkdtemp(join(tmpdir(), 'test-server-modern-cwd-'));
    process.chdir(launchDir);
    delete process.env.GOLDFISH_WORKSPACE;
    const { hydrateWorkspaceArguments } = await import('../src/server');
    let rootsCalls = 0;

    try {
      await expect(hydrateWorkspaceArguments(
        'recall',
        { limit: 1 },
        new Map(),
        'modern',
        false,
        async () => {
          rootsCalls += 1;
          return { roots: [{ uri: pathToFileURL(TEST_DIR).href }] };
        }
      )).rejects.toThrow(WORKSPACE_UNBOUND_MESSAGE);

      expect(rootsCalls).toBe(0);
    } finally {
      process.chdir(ORIGINAL_CWD);
      await rm(launchDir, { recursive: true, force: true });
    }
  });

  it('allows workspace all only for recall', async () => {
    const { hydrateWorkspaceArguments } = await import('../src/server');
    let rootsCalls = 0;
    const sendRoots = async () => {
      rootsCalls += 1;
      return { roots: [] };
    };

    const recall = await hydrateWorkspaceArguments(
      'recall',
      { workspace: 'all', limit: 1 },
      new Map(),
      'modern',
      false,
      sendRoots
    );
    expect(recall.args).toEqual({ workspace: 'all', limit: 1 });

    for (const name of ['checkpoint', 'brief']) {
      await expect(hydrateWorkspaceArguments(
        name,
        { workspace: 'all' },
        new Map(),
        'modern',
        false,
        sendRoots
      )).rejects.toThrow(`workspace="all" is only valid for recall, not ${name}`);
    }
    expect(rootsCalls).toBe(0);
  });

  it('rejects empty and whitespace workspace arguments before fallback', async () => {
    const { hydrateWorkspaceArguments } = await import('../src/server');
    const originalWorkspace = process.env.GOLDFISH_WORKSPACE;
    let rootsCalls = 0;
    const sendRoots = async () => {
      rootsCalls += 1;
      return { roots: [{ uri: pathToFileURL(TEST_DIR).href }] };
    };

    try {
      for (const workspace of ['', '   ']) {
        process.env.GOLDFISH_WORKSPACE = TEST_DIR;
        await expect(hydrateWorkspaceArguments(
          'checkpoint',
          { workspace },
          new Map(),
          'modern',
          true,
          sendRoots
        )).rejects.toThrow(WORKSPACE_UNBOUND_MESSAGE);

        delete process.env.GOLDFISH_WORKSPACE;
        await expect(hydrateWorkspaceArguments(
          'checkpoint',
          { workspace },
          new Map(),
          'modern',
          true,
          sendRoots
        )).rejects.toThrow(WORKSPACE_UNBOUND_MESSAGE);
      }
      expect(rootsCalls).toBe(0);
    } finally {
      if (originalWorkspace === undefined) delete process.env.GOLDFISH_WORKSPACE;
      else process.env.GOLDFISH_WORKSPACE = originalWorkspace;
    }
  });

  it('returns registered paths as suggestions without selecting one', async () => {
    const originalGoldfishHome = process.env.GOLDFISH_HOME;
    const goldfishHome = await mkdtemp(join(tmpdir(), 'test-server-suggestions-home-'));
    const project = await mkdtemp(join(tmpdir(), 'test-server-suggestions-project-'));
    const launchDir = await mkdtemp(join(tmpdir(), 'test-server-suggestions-launch-'));
    try {
      process.env.GOLDFISH_HOME = goldfishHome;
      await mkdir(join(project, '.memories'));
      await registerProject(project);
      process.chdir(launchDir);

      const { createServer } = await import('../src/server');
      const server = createServer();
      const client = new Client(
        { name: 'goldfish-test-client', version: '1.0.0' },
        { versionNegotiation: { mode: 'legacy' } }
      );
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ]);

      try {
        const result = await client.callTool({
          name: 'checkpoint',
          arguments: { description: 'must choose a suggested project explicitly' }
        });
        const text = getFirstTextContent(result);
        expect(result.isError).toBe(true);
        expect(text).toContain(WORKSPACE_UNBOUND_MESSAGE);
        expect(text).toContain('Suggestions only; choose one explicitly:');
        expect(text).toContain(project);
        expect(text).not.toContain('recovered');
      } finally {
        await Promise.all([client.close(), server.close()]);
      }
    } finally {
      process.chdir(ORIGINAL_CWD);
      if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
      else process.env.GOLDFISH_HOME = originalGoldfishHome;
      await Promise.all([
        rm(goldfishHome, { recursive: true, force: true }),
        rm(project, { recursive: true, force: true }),
        rm(launchDir, { recursive: true, force: true })
      ]);
    }
  });

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
      // Empty roots must not be cached as a permanent failure.
      const firstAttempt = await connection.client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });
      expect(firstAttempt.isError).toBe(true);
      expect(getFirstTextContent(firstAttempt)).toContain(WORKSPACE_UNBOUND_MESSAGE);
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
      {
        capabilities: { roots: { listChanged: true } },
        versionNegotiation: { mode: 'legacy' }
      }
    );
    let rootsCalls = 0;
    client.setRequestHandler('roots/list', async () => {
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
      expect(getFirstTextContent(firstAttempt)).toContain(WORKSPACE_UNBOUND_MESSAGE);
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

  it('refuses the launch directory when roots lookup is unavailable', async () => {
    const launchDir = await mkdtemp(join(tmpdir(), 'test-server-cwd-'));
    await mkdir(join(launchDir, '.memories'));
    const before = await readdir(join(launchDir, '.memories'));
    process.chdir(launchDir);

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } }
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport)
      ]);

      const checkpoint = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'checkpoint must not use launch directory' }
      });
      expect(checkpoint.isError).toBe(true);
      const text = getFirstTextContent(checkpoint);
      expect(text).toContain(WORKSPACE_UNBOUND_MESSAGE);
      expect(text).toContain('Suggestions only; choose one explicitly:');
      expect(text).toContain(launchDir);
      expect(await readdir(join(launchDir, '.memories'))).toEqual(before);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      await rm(launchDir, { recursive: true, force: true });
    }
  });

  it('refuses after the legacy roots lookup timeout', async () => {
    const launchDir = await mkdtemp(join(tmpdir(), 'test-server-cwd-hung-roots-'));
    process.chdir(launchDir);

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      {
        capabilities: { roots: { listChanged: true } },
        versionNegotiation: { mode: 'legacy' }
      }
    );
    let rootsCalls = 0;
    client.setRequestHandler('roots/list', async () => {
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
          arguments: { description: 'checkpoint after hung roots' }
        }),
        new Promise<'timed out'>(resolve => setTimeout(() => resolve('timed out'), 1200))
      ]);

      if (checkpoint === 'timed out') {
        throw new Error('checkpoint call did not return when roots/list never settled');
      }
      expect(checkpoint.isError).toBe(true);
      expect(getFirstTextContent(checkpoint)).toContain(WORKSPACE_UNBOUND_MESSAGE);
      expect(rootsCalls).toBe(1);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      await rm(launchDir, { recursive: true, force: true });
    }
  });

  it('rejects omitted workspace from a filesystem-root launch directory', async () => {
    process.chdir('/');
    delete process.env.GOLDFISH_WORKSPACE;

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } }
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
      expect(getFirstTextContent(result)).toContain(WORKSPACE_UNBOUND_MESSAGE);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
    }
  });

  it('rejects omitted workspace from a home-directory launch directory', async () => {
    const originalHome = process.env.HOME;
    const homeFallback = await mkdtemp(join(tmpdir(), 'test-server-home-'));
    process.chdir(homeFallback);
    process.env.HOME = process.cwd();
    delete process.env.GOLDFISH_WORKSPACE;

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } }
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
      expect(getFirstTextContent(result)).toContain(WORKSPACE_UNBOUND_MESSAGE);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      await rm(homeFallback, { recursive: true, force: true });
    }
  });

  it('rejects an unsafe GOLDFISH_WORKSPACE override', async () => {
    process.chdir('/');
    process.env.GOLDFISH_WORKSPACE = '/';

    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } }
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

      expect(result.isError).toBe(true);
      expect(getFirstTextContent(result)).toContain(WORKSPACE_UNBOUND_MESSAGE);
    } finally {
      await Promise.all([client.close(), server.close()]);
      process.chdir(ORIGINAL_CWD);
      delete process.env.GOLDFISH_WORKSPACE;
    }
  });
});

describe('Observed actor identity', () => {
  async function connectLegacyClient(clientName: string) {
    const { createServer } = await import('../src/server');
    const server = createServer();
    const client = new Client(
      { name: clientName, version: '1.0.0' },
      { versionNegotiation: { mode: 'legacy' } }
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);
    return { client, server };
  }

  async function findSavedCheckpoint(description: string) {
    const today = new Date().toISOString().split('T')[0]!;
    const checkpoints = await getCheckpointsForDay(TEST_DIR, today);
    return checkpoints.find(c => c.description === description);
  }

  it('exports the default session sentinel', async () => {
    const { DEFAULT_SESSION_KEY } = await import('../src/server');
    expect(DEFAULT_SESSION_KEY).toBe('default');
  });

  it('legacy InMemoryTransport Client({ name }) records harness via getClientVersion()', async () => {
    const { client, server } = await connectLegacyClient('goldfish-test-client');

    try {
      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'legacy era actor capture', workspace: TEST_DIR }
      });
      expect(result.isError).not.toBe(true);

      const saved = await findSavedCheckpoint('legacy era actor capture');
      expect(saved!.actor?.harness).toBe('goldfish-test-client');
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('env GOLDFISH_HARNESS overrides the MCP-observed harness and a default session is omitted', async () => {
    process.env.GOLDFISH_HARNESS = 'env-harness';
    process.env.GOLDFISH_SESSION = 'default';
    const { client, server } = await connectLegacyClient('goldfish-test-client');

    try {
      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'env override actor capture', workspace: TEST_DIR }
      });
      expect(result.isError).not.toBe(true);

      const saved = await findSavedCheckpoint('env override actor capture');
      expect(saved!.actor?.harness).toBe('env-harness');
      expect(saved!.actor?.session).toBeUndefined();
    } finally {
      delete process.env.GOLDFISH_HARNESS;
      delete process.env.GOLDFISH_SESSION;
      await Promise.all([client.close(), server.close()]);
    }
  });

  it('checkpoint tool schema gains no actor fields and the description mentions actor auto-capture', async () => {
    const { getTools } = await import('../src/server');
    const checkpointTool = getTools().find(t => t.name === 'checkpoint');

    const properties = Object.keys(
      (checkpointTool!.inputSchema as { properties: Record<string, unknown> }).properties
    );
    expect(properties).not.toContain('actor');
    expect(properties).not.toContain('harness');
    expect(properties).not.toContain('model');
    expect(properties).not.toContain('session');
    expect(checkpointTool!.description).toContain('and observed actor identity');
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

    await expect(handleRecall({
      workspace: join(tmpdir(), 'nonexistent-workspace-xyz-' + Date.now())
    })).rejects.toThrow(WORKSPACE_UNBOUND_MESSAGE);
  });
});
