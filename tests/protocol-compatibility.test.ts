import { describe, it, expect } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parseCheckpointFile } from '../src/checkpoints';

const REPO_ROOT = join(import.meta.dir, '..');
const SERVER_PATH = join(REPO_ROOT, 'src', 'server.ts');

function getFirstTextContent(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    return '';
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  const firstText = content.find(
    item => item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
  ) as { text?: unknown } | undefined;
  return typeof firstText?.text === 'string' ? firstText.text : '';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function connectModernServer(options: {
  cwd: string;
  home: string;
  goldfishHome: string;
  workspace?: string;
}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['run', SERVER_PATH],
    cwd: options.cwd,
    env: {
      HOME: options.home,
      GOLDFISH_HOME: options.goldfishHome,
      ...(options.workspace ? { GOLDFISH_WORKSPACE: options.workspace } : {})
    },
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: 'goldfish-modern-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close();
    throw new Error(`Modern stdio connection failed:\n${stderr}`, { cause: error });
  }
}

async function connectLegacyServer(options: {
  cwd: string;
  home: string;
  goldfishHome: string;
}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['run', SERVER_PATH],
    cwd: options.cwd,
    env: {
      HOME: options.home,
      GOLDFISH_HOME: options.goldfishHome
    },
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: 'goldfish-legacy-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: 'legacy' } }
  );

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close();
    throw new Error(`Legacy stdio connection failed:\n${stderr}`, { cause: error });
  }
}

describe('MCP 2026-07-28 stdio compatibility', () => {
  it('lists tools and honors env and explicit workspace precedence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-modern-tools-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    const envWorkspace = join(root, 'env-workspace');
    const explicitWorkspace = join(root, 'explicit-workspace');
    await Promise.all([
      mkdir(home),
      mkdir(goldfishHome),
      mkdir(envWorkspace),
      mkdir(explicitWorkspace)
    ]);

    let client: Client | undefined;
    try {
      client = await connectModernServer({
        cwd: home,
        home,
        goldfishHome,
        workspace: envWorkspace
      });

      expect(client.getProtocolEra()).toBe('modern');
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name).sort()).toEqual([
        'brief',
        'checkpoint',
        'recall'
      ]);

      const fromEnv = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'modern checkpoint from env workspace' }
      });
      expect(fromEnv.isError).not.toBe(true);

      const fromExplicit = await client.callTool({
        name: 'checkpoint',
        arguments: {
          description: 'modern checkpoint from explicit workspace',
          workspace: explicitWorkspace
        }
      });
      expect(fromExplicit.isError).not.toBe(true);

      expect(await pathExists(join(envWorkspace, '.memories'))).toBe(true);
      expect(await pathExists(join(explicitWorkspace, '.memories'))).toBe(true);
      expect(await pathExists(join(home, '.memories'))).toBe(false);
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('modern spawned 2026-07-28 Client({ name }) records harness from the envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-modern-actor-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    const workspace = join(root, 'workspace');
    await Promise.all([mkdir(home), mkdir(goldfishHome), mkdir(workspace)]);

    let client: Client | undefined;
    try {
      client = await connectModernServer({ cwd: home, home, goldfishHome });

      const result = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'modern actor capture', workspace }
      });
      expect(result.isError).not.toBe(true);

      const memoriesDir = join(workspace, '.memories');
      const [date] = (await readdir(memoriesDir)).filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry));
      const [file] = await readdir(join(memoriesDir, date!));
      const checkpoint = parseCheckpointFile(await readFile(join(memoriesDir, date!, file!), 'utf-8'));

      expect(checkpoint.actor?.harness).toBe('goldfish-modern-test-client');
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips push roots and safely refuses an untrusted cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-modern-refusal-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    await Promise.all([mkdir(home), mkdir(goldfishHome)]);

    let client: Client | undefined;
    try {
      client = await connectModernServer({ cwd: home, home, goldfishHome });

      const result = await client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });

      expect(result.isError).toBe(true);
      expect(getFirstTextContent(result).toLowerCase()).toContain('home directory');
      expect(await pathExists(join(home, '.memories'))).toBe(false);
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('MCP legacy stdio compatibility', () => {
  it('serves legacy clients over the real stdio entry point', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-legacy-tools-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    await Promise.all([mkdir(home), mkdir(goldfishHome)]);

    let client: Client | undefined;
    try {
      client = await connectLegacyServer({ cwd: home, home, goldfishHome });

      expect(client.getProtocolEra()).toBe('legacy');
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name).sort()).toEqual([
        'brief',
        'checkpoint',
        'recall'
      ]);
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
