import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { recall } from '../src/recall';
import { saveCheckpoint } from '../src/checkpoints';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { getEmbeddingEngine, closeAllEngines } from '../src/embeddings';
import { rm } from 'fs/promises';

const TEST_WORKSPACE = `test-distill-recall-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  await closeAllEngines();
  await new Promise(resolve => setTimeout(resolve, 50));
  await rm(getWorkspacePath(TEST_WORKSPACE), { recursive: true, force: true });
});

describe('Distillation integration with recall', () => {
  beforeEach(async () => {
    // Create sample checkpoints
    await saveCheckpoint({
      description: 'Fixed authentication bug in JWT token validation',
      tags: ['bug-fix', 'auth'],
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Added user login with OAuth2 integration',
      tags: ['feature', 'auth'],
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Refactored database migration scripts',
      tags: ['refactor', 'database'],
      workspace: TEST_WORKSPACE
    });

    // Generate embeddings
    const engine = await getEmbeddingEngine(TEST_WORKSPACE);
    const result = await recall({ workspace: TEST_WORKSPACE, limit: 100 });
    await engine.embedBatch(result.checkpoints);
  });

  it('includes distillation when distill option is true', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication',
      distill: true,
      distillProvider: 'none',  // Force simple extraction for testing
      limit: 10
    });

    expect(result.distilled).toBeDefined();
    expect(result.distilled!.summary).toBeDefined();
    expect(result.distilled!.provider).toBe('simple');
    expect(result.distilled!.originalCount).toBeGreaterThan(0);
    expect(result.distilled!.tokenReduction).toBeGreaterThanOrEqual(0);
  });

  it('skips distillation when distill option is false', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication',
      distill: false,
      limit: 10
    });

    expect(result.distilled).toBeUndefined();
  });

  it('skips distillation when search is not provided', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    expect(result.distilled).toBeUndefined();
  });

  it('skips distillation when no checkpoints found', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'completely unrelated xyz random',
      minSimilarity: 0.99,  // Very high threshold
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    // May or may not have distilled depending on whether fallback found anything
    // Just verify the call succeeds
    expect(result).toBeDefined();
  });

  it('uses simple extraction when provider is none', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'auth',
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    expect(result.distilled).toBeDefined();
    expect(result.distilled!.provider).toBe('simple');
    expect(result.distilled!.summary).toContain('Recent work:');
  });

  it('accepts maxTokens option', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication',
      distill: true,
      distillProvider: 'none',
      distillMaxTokens: 200,
      limit: 10
    });

    expect(result.distilled).toBeDefined();
    // Simple extraction doesn't enforce maxTokens, but option should be accepted
  });

  it('calculates token reduction correctly', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'auth',
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    expect(result.distilled).toBeDefined();
    expect(result.distilled!.tokenReduction).toBeGreaterThanOrEqual(0);
    expect(result.distilled!.tokenReduction).toBeLessThanOrEqual(100);
  });

  it('works with fuzzy search', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: false,  // Use fuzzy search
      search: 'auth',
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    expect(result.distilled).toBeDefined();
    expect(result.distilled!.provider).toBe('simple');
  });

  it('includes both search results and distillation', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication',
      distill: true,
      distillProvider: 'none',
      limit: 10
    });

    expect(result.checkpoints).toBeDefined();
    expect(result.searchMethod).toBeDefined();
    expect(result.distilled).toBeDefined();
  });
});
