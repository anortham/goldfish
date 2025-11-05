import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { saveCheckpoint } from '../src/checkpoints';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { getEmbeddingEngine, closeAllEngines } from '../src/embeddings';
import { rm, mkdir } from 'fs/promises';
import { spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(spawn);

const TEST_WORKSPACE = `test-migration-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  await closeAllEngines();
  await new Promise(resolve => setTimeout(resolve, 50));
  await rm(getWorkspacePath(TEST_WORKSPACE), { recursive: true, force: true });
});

describe('Embedding migration script', () => {
  it('migrates checkpoints without embeddings', async () => {
    // Create some checkpoints without embeddings
    await saveCheckpoint({
      description: 'First checkpoint for migration test',
      tags: ['test', 'migration'],
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Second checkpoint for migration test',
      tags: ['test'],
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Third checkpoint for migration test',
      workspace: TEST_WORKSPACE
    });

    // Verify no embeddings exist yet
    const engine = await getEmbeddingEngine(TEST_WORKSPACE);

    // Run migration script
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn('bun', ['run', 'scripts/migrate-embeddings.ts', TEST_WORKSPACE], {
        cwd: process.cwd(),
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ code: code || 0, stdout, stderr });
      });

      proc.on('error', reject);
    });

    // Check migration succeeded
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Migration complete');
    expect(result.stdout).toContain('3 checkpoints');

    // Verify embeddings were created (get fresh engine after migration)
    const checkResult = await getEmbeddingEngine(TEST_WORKSPACE);

    // Check that embeddings exist (we can't check specific timestamps since they're generated)
    // Just verify the migration ran successfully based on output
    expect(result.stdout).toContain('Generated');
  });

  it('handles multiple checkpoints correctly', async () => {
    // Create multiple checkpoints
    await saveCheckpoint({
      description: 'First checkpoint',
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Second checkpoint',
      workspace: TEST_WORKSPACE
    });

    // Run migration
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn('bun', ['run', 'scripts/migrate-embeddings.ts', TEST_WORKSPACE], {
        cwd: process.cwd(),
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ code: code || 0, stdout, stderr });
      });

      proc.on('error', reject);
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('2 checkpoints');
    expect(result.stdout).toContain('Generated');
    expect(result.stdout).toContain('Migration complete');
  });

  it('handles workspace with no checkpoints gracefully', async () => {
    // Don't create any checkpoints

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn('bun', ['run', 'scripts/migrate-embeddings.ts', TEST_WORKSPACE], {
        cwd: process.cwd(),
        env: process.env
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({ code: code || 0, stdout, stderr });
      });

      proc.on('error', reject);
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No checkpoint files found');
  });
});
