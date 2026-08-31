import { describe, it, expect } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'bun';
import { getHookContext } from '../src/hook-context';
import { getInstructions } from '../src/instructions';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const HOOK_CONTEXT_CHAR_BUDGET = 10_000;

async function readJson<T>(...segments: string[]): Promise<T> {
  return JSON.parse(await readFile(join(repoRoot, ...segments), 'utf-8')) as T;
}

async function readJsonPath<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), 'utf-8')) as T;
}

interface HooksMap {
  hooks: Record<string, Array<{
    matcher?: string;
    hooks: Array<{
      type: string;
      command: string;
      commandWindows?: string;
      timeout?: number;
      statusMessage?: string;
    }>;
  }>>;
}

interface CursorPluginManifest {
  version: string;
  skills: string;
  hooks: string;
  mcpServers: string;
}

interface CursorHook {
  command: string;
  timeout: number;
}

interface CursorHooksMap {
  version: number;
  hooks: {
    sessionStart: CursorHook[];
    [event: string]: unknown;
  };
}

interface CursorMcpConfig {
  mcpServers: Record<string, { type: string; command: string; args: string[] }>;
}

describe('hook context content', () => {
  it('embeds the server instructions verbatim', () => {
    expect(getHookContext()).toContain(getInstructions());
  });

  it('carries the checkpoint-before-commit trigger', () => {
    expect(getHookContext()).toContain('BEFORE a git commit, not after');
  });

  it('advertises all three goldfish tools', () => {
    const context = getHookContext();

    expect(context).toContain('checkpoint');
    expect(context).toContain('recall');
    expect(context).toContain('brief');
  });

  it('warns that tools may be deferred rather than absent', () => {
    const context = getHookContext();

    expect(context.toLowerCase()).toContain('deferred');
    expect(context).toContain('mcp__goldfish__');
  });

  it('carries brief lifecycle guidance', () => {
    expect(getHookContext()).toContain('archive it when superseded');
  });

  it('carries the checkpoint quality format', () => {
    const context = getHookContext();

    expect(context).toContain('WHAT');
    expect(context).toContain('WHY');
    expect(context).toContain('HOW');
    expect(context).toContain('IMPACT');
  });

  it('recalls only when prior context is relevant', () => {
    const context = getHookContext();

    expect(context).not.toContain('Call recall() at session start');
    expect(context).not.toContain('Call at session start and after context loss');
    expect(context).toContain('when resuming prior work');
  });

  it('verifies current or drift-prone recalled facts against live sources', () => {
    const context = getHookContext();

    expect(context).not.toContain("don't re-verify");
    expect(context).toContain('drift-prone');
    expect(context).toContain('live sources');
  });

  it('carries verified workspace binding guidance without recovery behavior', () => {
    const context = getHookContext();

    expect(context).toContain('User-level MCP registrations must pass the conversation\'s host-native absolute project root');
    expect(context).toContain('host-native absolute project root');
    expect(context).toContain('fixed absolute GOLDFISH_WORKSPACE');
    expect(context).toContain('supported legacy Roots');
    expect(context).toContain('GOLDFISH_WORKSPACE');
    expect(context).toContain('legacy Roots');
    expect(context).toContain('workspace: "all"');
    expect(context).toContain('suggestions only');
    expect(context).not.toContain('automatic recovery');
    expect(context).not.toContain('process.cwd()');
  });

  it('stays within the Goldfish hook-context safety budget', () => {
    expect(getHookContext().length).toBeLessThanOrEqual(HOOK_CONTEXT_CHAR_BUDGET);
  });
});

describe('session-start hook script', () => {
  it('emits the hook context as raw stdout and exits 0', () => {
    const result = spawnSync(['bun', join(repoRoot, 'hooks', 'session-start.ts')], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(getHookContext());
  });

  it('reports setup failures and still exits 0', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'goldfish-hook-failure-'));

    try {
      const hooksDir = join(tempRoot, 'hooks');
      const scriptPath = join(hooksDir, 'session-start.ts');
      await mkdir(hooksDir);
      await copyFile(join(repoRoot, 'hooks', 'session-start.ts'), scriptPath);

      const result = spawnSync(['bun', scriptPath], {
        cwd: tempRoot,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe('');
      expect(result.stderr.toString()).toContain('goldfish session-start hook:');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('Cursor plugin assets', () => {
  it('emits Cursor hook JSON with the Goldfish context and exits 0', () => {
    const result = spawnSync(['bun', join(repoRoot, 'hooks', 'cursor-session-start.ts')], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({
      additional_context: getHookContext()
    });
  });

  it('keeps Cursor hook failures non-blocking', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'goldfish-cursor-hook-failure-'));
    const scriptPath = join(tempRoot, 'cursor-session-start.ts');

    try {
      await copyFile(join(repoRoot, 'hooks', 'cursor-session-start.ts'), scriptPath);

      const result = spawnSync(['bun', scriptPath], {
        cwd: tempRoot,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString()).toBe('');
      expect(result.stderr.toString()).toContain('goldfish cursor session-start hook:');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('declares only one versioned sessionStart command with a five-second timeout', async () => {
    const map = await readJson<CursorHooksMap>('hooks', 'cursor-hooks.json');

    expect(map.version).toBe(1);
    expect(Object.keys(map.hooks)).toEqual(['sessionStart']);
    expect(map.hooks.sessionStart).toHaveLength(1);
    expect(map.hooks.sessionStart[0]).toEqual({
      command: expect.stringContaining('cursor-session-start.ts'),
      timeout: 5
    });
  });

  it('registers a Cursor plugin manifest with current assets', async () => {
    const { SERVER_VERSION } = await import('../src/server');
    const manifest = await readJson<CursorPluginManifest>('.cursor-plugin', 'plugin.json');

    expect(manifest.version).toBe(SERVER_VERSION);
    expect(manifest.skills).toBe('./skills/');
    expect(manifest.hooks).toBe('./hooks/cursor-hooks.json');
    expect(manifest.mcpServers).toBe('./mcp.json');
    expect((await stat(resolve(repoRoot, manifest.skills))).isDirectory()).toBe(true);
    expect(await Bun.file(resolve(repoRoot, manifest.hooks)).exists()).toBe(true);
    expect(await Bun.file(resolve(repoRoot, manifest.mcpServers)).exists()).toBe(true);
  });

  it('launches the Cursor MCP server through Bun and the plugin root', async () => {
    const manifest = await readJson<CursorPluginManifest>('.cursor-plugin', 'plugin.json');
    const config = await readJsonPath<CursorMcpConfig>(manifest.mcpServers);
    const server = config.mcpServers.goldfish!;

    expect(server.type).toBe('stdio');
    expect(server.command).toBe('bun');
    expect(server.args.join(' ')).toContain('${PLUGIN_ROOT}/src/server.ts');
  });
});

describe('hooks map', () => {
  it('declares exactly one event with exactly one command', async () => {
    const map = await readJson<HooksMap>('hooks', 'goldfish-hooks.json');
    const events = Object.keys(map.hooks);

    expect(events).toEqual(['SessionStart']);
    expect(map.hooks.SessionStart!).toHaveLength(1);
    expect(map.hooks.SessionStart![0]!.hooks).toHaveLength(1);
  });

  it('fires on startup, clear, and compact but never resume', async () => {
    const map = await readJson<HooksMap>('hooks', 'goldfish-hooks.json');

    expect(map.hooks.SessionStart![0]!.matcher).toBe('startup|clear|compact');
  });

  it('runs the session-start script with a windows variant and a timeout', async () => {
    const map = await readJson<HooksMap>('hooks', 'goldfish-hooks.json');
    const hook = map.hooks.SessionStart![0]!.hooks[0]!;

    expect(hook.type).toBe('command');
    expect(hook.command).toContain('session-start.ts');
    expect(hook.command).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(hook.commandWindows).toContain('session-start.ts');
    expect(hook.commandWindows).toContain('Get-Command bun');
    expect(hook.timeout).toBe(5);
    expect(hook.statusMessage).toBeTruthy();
  });
});

describe('plugin manifests', () => {
  it('points both harnesses at the same hooks map', async () => {
    const claudePlugin = await readJson<{ hooks: string }>('.claude-plugin', 'plugin.json');
    const codexPlugin = await readJson<{ hooks: string }>('.codex-plugin', 'plugin.json');

    expect(codexPlugin.hooks).toBe(claudePlugin.hooks);
    expect(resolve(repoRoot, claudePlugin.hooks)).toBe(join(repoRoot, 'hooks', 'goldfish-hooks.json'));
    expect(await Bun.file(resolve(repoRoot, claudePlugin.hooks)).exists()).toBe(true);
  });

  it('registers the goldfish server for codex via bun', async () => {
    const codexPlugin = await readJson<{ mcpServers: string; skills: string }>('.codex-plugin', 'plugin.json');
    expect(codexPlugin.mcpServers).toBe('./.mcp.json');

    const mcpPath = resolve(repoRoot, codexPlugin.mcpServers);

    expect(await Bun.file(mcpPath).exists()).toBe(true);

    const payload = JSON.parse(await readFile(mcpPath, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[]; cwd?: string }>;
    };
    const server = payload.mcpServers.goldfish!;

    expect(server.command).toBe('bun');
    expect(server.args.join(' ')).toContain('src/server.ts');
    expect(server.cwd).toBe('.');
    expect(resolve(repoRoot, codexPlugin.skills)).toBe(join(repoRoot, 'skills'));
  });
});
