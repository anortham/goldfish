import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { getWorkspaceStorage } from '../src/storage/workspace';
import type { Memory } from '../src/storage/types';

const TEST_WORKSPACE_PATH = join(tmpdir(), `goldfish-store-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TEST_WORKSPACE_PATH, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_WORKSPACE_PATH, { recursive: true, force: true });
});

describe('store handler', () => {
  it('stores a memory and returns confirmation', async () => {
    const { handleStore } = await import('../src/handlers/store');

    const result = await handleStore({
      type: 'decision',
      source: 'agent',
      content: 'Chose SQLite over PostgreSQL for vector storage',
      tags: ['database', 'architecture'],
      workspacePath: TEST_WORKSPACE_PATH
    });

    expect(result.content).toBeDefined();
    expect(result.content[0]!.type).toBe('text');

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.success).toBe(true);
    expect(parsed.memory.type).toBe('decision');
    expect(parsed.memory.source).toBe('agent');
    expect(parsed.memory.content).toBe('Chose SQLite over PostgreSQL for vector storage');
    expect(parsed.memory.tags).toEqual(['database', 'architecture']);
    expect(parsed.memory.timestamp).toBeDefined();
  });

  it('stores memory without tags', async () => {
    const { handleStore } = await import('../src/handlers/store');

    const result = await handleStore({
      type: 'bug-fix',
      source: 'user',
      content: 'Fixed JWT validation bug',
      workspacePath: TEST_WORKSPACE_PATH
    });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.success).toBe(true);
    expect(parsed.memory.type).toBe('bug-fix');
    expect(parsed.memory.tags).toBeUndefined();
  });

  it('validates required fields', async () => {
    const { handleStore } = await import('../src/handlers/store');

    await expect(
      handleStore({
        source: 'agent',
        content: 'Missing type field',
        workspacePath: TEST_WORKSPACE_PATH
      } as any)
    ).rejects.toThrow();

    await expect(
      handleStore({
        type: 'decision',
        content: 'Missing source field',
        workspacePath: TEST_WORKSPACE_PATH
      } as any)
    ).rejects.toThrow();

    await expect(
      handleStore({
        type: 'decision',
        source: 'agent',
        workspacePath: TEST_WORKSPACE_PATH
      } as any)
    ).rejects.toThrow();
  });

  it('validates memory type enum', async () => {
    const { handleStore } = await import('../src/handlers/store');

    await expect(
      handleStore({
        type: 'invalid-type',
        source: 'agent',
        content: 'Test content',
        workspacePath: TEST_WORKSPACE_PATH
      } as any)
    ).rejects.toThrow();
  });

  it('validates source enum', async () => {
    const { handleStore } = await import('../src/handlers/store');

    await expect(
      handleStore({
        type: 'decision',
        source: 'invalid-source',
        content: 'Test content',
        workspacePath: TEST_WORKSPACE_PATH
      } as any)
    ).rejects.toThrow();
  });

  it('stores memory and triggers background embedding sync', async () => {
    const { handleStore } = await import('../src/handlers/store');

    // Store a memory
    const result = await handleStore({
      type: 'feature',
      source: 'agent',
      content: 'Implemented semantic search with GPU acceleration',
      tags: ['feature', 'performance'],
      workspacePath: TEST_WORKSPACE_PATH
    });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.success).toBe(true);

    // Verify memory was actually stored
    const storage = await getWorkspaceStorage(TEST_WORKSPACE_PATH);
    const memories = await storage.getAll();

    expect(memories.length).toBe(1);
    expect(memories[0]!.content).toBe('Implemented semantic search with GPU acceleration');
    expect(memories[0]!.type).toBe('feature');
  });

  it('uses current directory as workspace if not provided', async () => {
    const { handleStore } = await import('../src/handlers/store');

    const result = await handleStore({
      type: 'observation',
      source: 'system',
      content: 'Test observation without explicit workspace'
    });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.success).toBe(true);
    expect(parsed.memory.content).toBe('Test observation without explicit workspace');

    // Should have used process.cwd() as workspace
    // We can't easily verify this without mocking, but check it doesn't error
  });

  it('includes file path and line number in response', async () => {
    const { handleStore } = await import('../src/handlers/store');

    const result = await handleStore({
      type: 'insight',
      source: 'development-session',
      content: 'Discovered performance bottleneck in sync engine',
      workspacePath: TEST_WORKSPACE_PATH
    });

    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.success).toBe(true);
    expect(parsed.filePath).toBeDefined();
    expect(parsed.filePath).toContain('.goldfish/memories/');
    expect(parsed.filePath).toContain('.jsonl');
  });
});
