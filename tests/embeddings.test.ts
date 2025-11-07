import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  EmbeddingEngine,
  buildEmbeddingText,
  cosineSimilarity
} from '../src/embeddings';
import type { Checkpoint } from '../src/types';
import { getWorkspacePath, ensureWorkspaceDir } from '../src/workspace';
import { rm } from 'fs/promises';
import { join } from 'path';

const TEST_WORKSPACE = `test-embeddings-${Date.now()}`;

beforeEach(async () => {
  await ensureWorkspaceDir(TEST_WORKSPACE);
});

afterEach(async () => {
  const workspacePath = getWorkspacePath(TEST_WORKSPACE);
  await rm(workspacePath, { recursive: true, force: true });
});

describe('buildEmbeddingText', () => {
  it('builds text from checkpoint with all fields', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Fixed authentication bug in JWT validation',
      tags: ['bug-fix', 'auth', 'security'],
      gitBranch: 'feature/auth-fix',
      files: ['src/auth/jwt.ts']
    };

    const text = buildEmbeddingText(checkpoint);

    expect(text).toContain('Fixed authentication bug');
    expect(text).toContain('bug-fix auth security');
    expect(text).toContain('feature/auth-fix');
  });

  it('builds text from minimal checkpoint', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Simple checkpoint'
    };

    const text = buildEmbeddingText(checkpoint);

    expect(text).toContain('Simple checkpoint');
    expect(text.trim()).toBe('Simple checkpoint');
  });

  it('filters out undefined fields', () => {
    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Testing filtering',
      tags: undefined,
      gitBranch: undefined
    };

    const text = buildEmbeddingText(checkpoint);

    expect(text).toBe('Testing filtering');
    expect(text).not.toContain('undefined');
  });
});

describe('cosineSimilarity', () => {
  it('calculates similarity for identical vectors', () => {
    const vec1 = new Float32Array([1, 0, 0, 0]);
    const vec2 = new Float32Array([1, 0, 0, 0]);

    const similarity = cosineSimilarity(vec1, vec2);

    expect(similarity).toBeCloseTo(1.0, 5);
  });

  it('calculates similarity for orthogonal vectors', () => {
    const vec1 = new Float32Array([1, 0, 0, 0]);
    const vec2 = new Float32Array([0, 1, 0, 0]);

    const similarity = cosineSimilarity(vec1, vec2);

    expect(similarity).toBeCloseTo(0.0, 5);
  });

  it('calculates similarity for opposite vectors', () => {
    const vec1 = new Float32Array([1, 0, 0, 0]);
    const vec2 = new Float32Array([-1, 0, 0, 0]);

    const similarity = cosineSimilarity(vec1, vec2);

    expect(similarity).toBeCloseTo(-1.0, 5);
  });

  it('calculates similarity for partially similar vectors', () => {
    const vec1 = new Float32Array([1, 1, 0, 0]);
    const vec2 = new Float32Array([1, 0, 0, 0]);

    const similarity = cosineSimilarity(vec1, vec2);

    // cos(45°) ≈ 0.707
    expect(similarity).toBeCloseTo(0.707, 2);
  });

  it('throws error for vectors of different dimensions', () => {
    const vec1 = new Float32Array([1, 0, 0]);
    const vec2 = new Float32Array([1, 0, 0, 0]);

    expect(() => cosineSimilarity(vec1, vec2)).toThrow();
  });
});

describe('EmbeddingEngine', () => {
  it('initializes with default config', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);

    await engine.initialize();

    expect(engine.isInitialized()).toBe(true);
    expect(engine.getDimensions()).toBe(384); // BGE-Small default
  });

  it('creates database schema on initialization', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);

    await engine.initialize();

    const workspacePath = getWorkspacePath(TEST_WORKSPACE);
    const embeddingsPath = join(workspacePath, 'embeddings');
    const dbPath = join(embeddingsPath, 'db.sqlite');

    // Check that database file exists
    const { Database } = await import('bun:sqlite');
    const db = new Database(dbPath);

    // Check tables exist
    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map((t: any) => t.name);

    expect(tableNames).toContain('checkpoint_embeddings');
    expect(tableNames).toContain('embedding_vectors');

    db.close();
  });

  it('embeds a checkpoint and stores vector', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Testing embedding generation for authentication bug fix'
    };

    await engine.embedCheckpoint(checkpoint);

    // Verify embedding was stored
    const embedding = await engine.getEmbedding(checkpoint.timestamp);

    expect(embedding).not.toBeNull();
    expect(embedding?.vector).toBeInstanceOf(Float32Array);
    expect(embedding?.vector.length).toBe(384);
    expect(embedding?.checkpointId).toBe(checkpoint.timestamp);
  });

  it('embeds batch of checkpoints efficiently', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoints: Checkpoint[] = [
      {
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'Fixed auth bug'
      },
      {
        timestamp: '2025-11-05T11:00:00.000Z',
        description: 'Added user validation'
      },
      {
        timestamp: '2025-11-05T12:00:00.000Z',
        description: 'Updated session handling'
      }
    ];

    const startTime = Date.now();
    await engine.embedBatch(checkpoints);
    const duration = Date.now() - startTime;

    // Batch should be faster than individual embeds
    expect(duration).toBeLessThan(10000); // 10s for 3 checkpoints

    // Verify all were stored
    for (const checkpoint of checkpoints) {
      const embedding = await engine.getEmbedding(checkpoint.timestamp);
      expect(embedding).not.toBeNull();
    }
  });

  it('finds semantically similar checkpoints', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoints: Checkpoint[] = [
      {
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'Fixed authentication bug in JWT token validation'
      },
      {
        timestamp: '2025-11-05T11:00:00.000Z',
        description: 'Updated database migration scripts'
      },
      {
        timestamp: '2025-11-05T12:00:00.000Z',
        description: 'Added security checks to auth middleware'
      }
    ];

    await engine.embedBatch(checkpoints);

    // Search for auth-related checkpoints
    const results = await engine.searchSemantic(
      'authentication security issues',
      checkpoints,
      10
    );

    // Should find auth-related checkpoints ranked higher
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].checkpoint.description).toMatch(/auth|security/i);
    expect(results[0].similarity).toBeGreaterThan(0.5);

    // Results should be sorted by similarity (highest first)
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
    }
  });

  it('returns empty results when no embeddings exist', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const results = await engine.searchSemantic('test query', [], 10);

    expect(results).toEqual([]);
  });

  it('handles HNSW index rebuild correctly', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoints: Checkpoint[] = [
      {
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'First checkpoint'
      },
      {
        timestamp: '2025-11-05T11:00:00.000Z',
        description: 'Second checkpoint'
      }
    ];

    await engine.embedBatch(checkpoints);

    // Rebuild index
    await engine.rebuildIndex();

    // Search should still work
    const results = await engine.searchSemantic('checkpoint', checkpoints, 10);

    expect(results.length).toBe(2);
  });

  it('filters by minimum similarity threshold', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoints: Checkpoint[] = [
      {
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'Authentication bug fix'
      },
      {
        timestamp: '2025-11-05T11:00:00.000Z',
        description: 'Completely unrelated database work'
      }
    ];

    await engine.embedBatch(checkpoints);

    const results = await engine.searchSemantic(
      'auth security',
      checkpoints,
      10,
      0.5 // Realistic threshold for real embeddings (0.5-0.8 is typical for related text)
    );

    // Should return at least one semantically similar result
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3); // At most 3 of the 4 checkpoints (unrelated one should be filtered)

    // All returned results should meet similarity threshold
    for (const result of results) {
      expect(result.similarity).toBeGreaterThanOrEqual(0.5);
    }

    // The unrelated database work should NOT be in results
    const descriptions = results.map(r => r.checkpoint.description);
    expect(descriptions).not.toContain('Completely unrelated database work');
  });

  it('handles embedding generation errors gracefully', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: '' // Empty description should still work
    };

    // Should not throw - just call it directly
    await engine.embedCheckpoint(checkpoint);

    // Verify it was stored
    const embedding = await engine.getEmbedding(checkpoint.timestamp);
    expect(embedding).not.toBeNull();
  });

  it('retrieves embedding by checkpoint ID', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Test checkpoint'
    };

    await engine.embedCheckpoint(checkpoint);

    const embedding = await engine.getEmbedding(checkpoint.timestamp);

    expect(embedding).not.toBeNull();
    expect(embedding?.checkpointId).toBe(checkpoint.timestamp);
    expect(embedding?.modelName).toBe('bge-small-en-v1.5');
  });

  it('returns null for non-existent embedding', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const embedding = await engine.getEmbedding('nonexistent-id');

    expect(embedding).toBeNull();
  });

  it('handles concurrent embedding generation safely', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoints: Checkpoint[] = Array.from({ length: 10 }, (_, i) => ({
      timestamp: `2025-11-05T${String(i).padStart(2, '0')}:00:00.000Z`,
      description: `Checkpoint ${i}`
    }));

    // Embed all concurrently
    await Promise.all(
      checkpoints.map(cp => engine.embedCheckpoint(cp))
    );

    // Verify all were stored correctly
    for (const checkpoint of checkpoints) {
      const embedding = await engine.getEmbedding(checkpoint.timestamp);
      expect(embedding).not.toBeNull();
    }
  });

  it('measures embedding generation performance', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Performance test checkpoint with reasonable length description'
    };

    const startTime = Date.now();
    await engine.embedCheckpoint(checkpoint);
    const duration = Date.now() - startTime;

    // Should be fast (< 100ms target, but allow 500ms for CI)
    expect(duration).toBeLessThan(500);
  });

  it('cleans up resources on close', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    await engine.close();

    expect(engine.isInitialized()).toBe(false);

    // Further operations should throw or fail gracefully
    await expect(
      engine.embedCheckpoint({
        timestamp: '2025-11-05T10:00:00.000Z',
        description: 'Test'
      })
    ).rejects.toThrow();
  });
});

describe('EmbeddingEngine integration with checkpoints', () => {
  it('embeds checkpoints with git context', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Fixed bug in authentication',
      gitBranch: 'feature/auth-fix',
      gitCommit: 'a1b2c3d',
      files: ['src/auth/jwt.ts']
    };

    await engine.embedCheckpoint(checkpoint);

    // Search should find it using git-related terms
    const results = await engine.searchSemantic('auth-fix branch', [checkpoint], 10);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].checkpoint.description).toContain('authentication');
  });

  it('embeds checkpoints with tags', async () => {
    const engine = new EmbeddingEngine(TEST_WORKSPACE);
    await engine.initialize();

    const checkpoint: Checkpoint = {
      timestamp: '2025-11-05T10:00:00.000Z',
      description: 'Fixed critical bug',
      tags: ['bug-fix', 'critical', 'security']
    };

    await engine.embedCheckpoint(checkpoint);

    // Search using tag terms
    const results = await engine.searchSemantic('security critical', [checkpoint], 10);

    expect(results.length).toBeGreaterThan(0);
  });
});
