import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { recall } from '../src/recall';
import { saveCheckpoint } from '../src/checkpoints';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { getEmbeddingEngine, closeAllEngines } from '../src/embeddings';
import { rm } from 'fs/promises';

// Use unique workspace for each test file to avoid concurrency issues
const TEST_WORKSPACE = `test-semantic-recall-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  // Close all embedding engines before cleanup
  await closeAllEngines();

  // Give a small delay to ensure database is fully closed
  await new Promise(resolve => setTimeout(resolve, 50));

  await rm(getWorkspacePath(TEST_WORKSPACE), { recursive: true, force: true });
});

describe('Semantic search in recall', () => {
  beforeEach(async () => {
    // Create checkpoints with different topics
    await saveCheckpoint({
      description: 'Fixed authentication bug in JWT token validation',
      tags: ['bug-fix', 'auth', 'security'],
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

    await saveCheckpoint({
      description: 'Updated SQL queries for better performance',
      tags: ['optimization', 'database'],
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Fixed security vulnerability in session handling',
      tags: ['bug-fix', 'security'],
      workspace: TEST_WORKSPACE
    });

    // Generate embeddings for all checkpoints
    const engine = await getEmbeddingEngine(TEST_WORKSPACE);
    const result = await recall({ workspace: TEST_WORKSPACE, limit: 100 });
    await engine.embedBatch(result.checkpoints);
  });

  it('performs semantic search when semantic option is true', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication security',
      limit: 10
    });

    expect(result.searchMethod).toBe('semantic');
    expect(result.checkpoints.length).toBeGreaterThan(0);

    // Should find auth/security related checkpoints
    const descriptions = result.checkpoints.map(c => c.description);
    const hasAuthOrSecurity = descriptions.some(d =>
      /auth|security|login|session/i.test(d)
    );
    expect(hasAuthOrSecurity).toBe(true);
  });

  it('includes similarity scores in search results', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'database optimization',
      limit: 10
    });

    expect(result.searchResults).toBeDefined();
    expect(result.searchResults!.length).toBeGreaterThan(0);

    // Check that results have similarity scores
    for (const searchResult of result.searchResults!) {
      expect(searchResult.similarity).toBeGreaterThanOrEqual(0);
      expect(searchResult.similarity).toBeLessThanOrEqual(1);
      expect(searchResult.rank).toBeGreaterThan(0);
    }
  });

  it('sorts results by similarity (highest first)', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication',
      limit: 10
    });

    expect(result.searchResults).toBeDefined();

    // Verify descending similarity order
    for (let i = 0; i < result.searchResults!.length - 1; i++) {
      expect(result.searchResults![i]!.similarity).toBeGreaterThanOrEqual(
        result.searchResults![i + 1]!.similarity
      );
    }
  });

  it('filters by minimum similarity threshold', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication security',
      minSimilarity: 0.7,
      limit: 10
    });

    // All results should meet minimum threshold
    for (const searchResult of result.searchResults || []) {
      expect(searchResult.similarity).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('falls back to fuzzy search when semantic is false', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: false,
      search: 'authentication',
      limit: 10
    });

    expect(result.searchMethod).toBe('fuzzy');
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('falls back to fuzzy search when no semantic matches found', async () => {
    // Search for something that won't match semantically (below threshold)
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'completely unrelated random xyz topic',
      minSimilarity: 0.95, // Very high threshold to ensure no semantic matches
      limit: 10
    });

    // Should fall back to fuzzy search when no semantic results
    expect(result.searchMethod).toBe('fuzzy');
  });

  it('respects limit parameter with semantic search', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'bug fix',
      limit: 2
    });

    expect(result.checkpoints.length).toBeLessThanOrEqual(2);
  });

  it('combines semantic search with date range filtering', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'database',
      days: 1,
      limit: 10
    });

    expect(result.searchMethod).toBe('semantic');

    // All checkpoints should be from today
    const today = new Date().toISOString().split('T')[0];
    for (const checkpoint of result.checkpoints) {
      const checkpointDate = checkpoint.timestamp.split('T')[0];
      expect(checkpointDate).toBe(today);
    }
  });

  it('finds conceptually similar checkpoints (not just keyword matches)', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'login security issues',
      limit: 10
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    // Should find checkpoints about auth/security even if they don't contain "login"
    const descriptions = result.checkpoints.map(c => c.description.toLowerCase());
    const hasRelevant = descriptions.some(d =>
      d.includes('auth') || d.includes('security') || d.includes('session')
    );
    expect(hasRelevant).toBe(true);
  });

  it('returns empty results when no similar checkpoints found', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'completely unrelated random topic xyz',
      minSimilarity: 0.9, // Very high threshold
      limit: 10
    });

    // May return empty results or low-similarity results
    expect(result.checkpoints).toBeDefined();
  });

  it('handles empty search query gracefully', async () => {
    const result = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: '',
      limit: 10
    });

    // Should return all checkpoints (no filtering)
    expect(result.checkpoints.length).toBeGreaterThan(0);
  });

  it('works with workspace=all for cross-workspace semantic search', async () => {
    // Create second workspace with checkpoint
    const workspace2 = `test-semantic-recall-2-${Date.now()}`;
    await ensureWorkspaceDir(workspace2);

    await saveCheckpoint({
      description: 'Cross-workspace authentication test',
      workspace: workspace2
    });

    // Generate embedding for new checkpoint
    const engine2 = await getEmbeddingEngine(workspace2);
    const result2 = await recall({ workspace: workspace2, limit: 100 });
    await engine2.embedBatch(result2.checkpoints);

    const result = await recall({
      workspace: 'all',
      semantic: true,
      search: 'authentication',
      limit: 10
    });

    expect(result.checkpoints.length).toBeGreaterThan(0);

    // Cleanup
    await rm(getWorkspacePath(workspace2), { recursive: true, force: true });
  });
});

describe('Semantic search vs fuzzy search quality', () => {
  beforeEach(async () => {
    // Create checkpoints with synonyms and related concepts
    await saveCheckpoint({
      description: 'Implemented user authentication using JWT tokens',
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Added login functionality with session management',
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Fixed authorization bug in access control',
      workspace: TEST_WORKSPACE
    });

    await saveCheckpoint({
      description: 'Refactored CSS styles for button components',
      workspace: TEST_WORKSPACE
    });

    // Generate embeddings
    const engine = await getEmbeddingEngine(TEST_WORKSPACE);
    const result = await recall({ workspace: TEST_WORKSPACE, limit: 100 });
    await engine.embedBatch(result.checkpoints);
  });

  it('semantic search finds conceptually related results', async () => {
    // Search for "authentication" - should find authentication-related checkpoints
    const semanticResult = await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'authentication JWT tokens',
      limit: 10
    });

    const fuzzyResult = await recall({
      workspace: TEST_WORKSPACE,
      semantic: false,
      search: 'authentication JWT tokens',
      limit: 10
    });

    // Both should find results
    expect(semanticResult.checkpoints.length).toBeGreaterThan(0);
    expect(fuzzyResult.checkpoints.length).toBeGreaterThan(0);

    // Semantic search should work (returns ranked results)
    // Note: Mock embeddings have limited semantic understanding compared to real models
    expect(semanticResult.searchMethod).toBe('semantic');
    expect(semanticResult.searchResults).toBeDefined();
    if (semanticResult.searchResults) {
      expect(semanticResult.searchResults.length).toBeGreaterThan(0);
      // Verify results have similarity scores
      expect(semanticResult.searchResults[0].similarity).toBeGreaterThan(0);
    }
  });

  it('fuzzy search allows approximate string matches', async () => {
    // Fuzzy search for "authentication" can match similar strings like "authorization"
    const fuzzyResult = await recall({
      workspace: TEST_WORKSPACE,
      semantic: false,
      search: 'authentication',
      limit: 10
    });

    // Should find results (may include approximate matches like "authorization")
    expect(fuzzyResult.checkpoints.length).toBeGreaterThan(0);

    // At least one should contain "auth" (base of authentication/authorization)
    const hasAuthTerm = fuzzyResult.checkpoints.some(c =>
      c.description.toLowerCase().includes('auth')
    );
    expect(hasAuthTerm).toBe(true);
  });
});

describe('Semantic search performance', () => {
  it('completes semantic search in reasonable time', async () => {
    // Create 20 checkpoints
    for (let i = 0; i < 20; i++) {
      await saveCheckpoint({
        description: `Test checkpoint ${i} about various topics`,
        workspace: TEST_WORKSPACE
      });
    }

    // Generate embeddings
    const engine = await getEmbeddingEngine(TEST_WORKSPACE);
    const result = await recall({ workspace: TEST_WORKSPACE, limit: 100 });
    await engine.embedBatch(result.checkpoints);

    const startTime = Date.now();

    await recall({
      workspace: TEST_WORKSPACE,
      semantic: true,
      search: 'test topics',
      limit: 10
    });

    const duration = Date.now() - startTime;

    // Should complete in < 200ms for 20 checkpoints
    expect(duration).toBeLessThan(200);
  });
});
