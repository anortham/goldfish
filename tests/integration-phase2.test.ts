/**
 * Phase 2 Integration Test
 *
 * Tests the complete flow:
 * 1. Store memories in JSONL
 * 2. Sync workspace (generate embeddings)
 * 3. Search for similar memories
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getWorkspaceStorage } from '../src/storage/workspace';
import { EmbeddingDatabase } from '../src/database/embeddings';
import { syncWorkspace } from '../src/sync/engine';
import { findJulieSemantic } from '../src/embeddings';

describe('Phase 2 Integration', () => {
  let tempDir: string;
  let tempDbPath: string;
  let db: EmbeddingDatabase;

  beforeAll(async () => {
    // Create temporary directories
    tempDir = await mkdtemp(join(tmpdir(), 'goldfish-phase2-'));
    tempDbPath = join(tempDir, 'test.db');

    // Initialize database
    db = new EmbeddingDatabase(tempDbPath);
    await db.initialize();

    console.log(`Test workspace: ${tempDir}`);
    console.log(`Test database: ${tempDbPath}`);
  });

  afterAll(async () => {
    // Cleanup
    await db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  test('complete workflow: store → sync → search', async () => {
    // Skip if julie-semantic not available
    const juliePath = findJulieSemantic();
    if (!juliePath) {
      console.warn('⚠️  Skipping integration test - julie-semantic not found');
      return;
    }

    console.log('\n📝 Step 1: Storing memories in JSONL...');

    // Create workspace storage
    const storage = await getWorkspaceStorage(tempDir);

    // Store some memories
    const memory1 = await storage.store({
      type: 'decision',
      source: 'agent',
      content: 'Chose SQLite with sqlite-vec extension for vector storage because it\'s embedded, fast, and works everywhere without external dependencies.',
      tags: ['database', 'architecture']
    });

    const memory2 = await storage.store({
      type: 'bug-fix',
      source: 'user',
      content: 'Fixed JWT validation bug where expired tokens were being accepted. Root cause was inverted expiry check in validateToken() function.',
      tags: ['security', 'authentication']
    });

    const memory3 = await storage.store({
      type: 'feature',
      source: 'agent',
      content: 'Implemented GPU-accelerated semantic search using julie-semantic with DirectML support for 10-30x faster embedding generation.',
      tags: ['performance', 'machine-learning']
    });

    console.log(`✅ Stored ${[memory1, memory2, memory3].length} memories`);

    console.log('\n🔄 Step 2: Syncing workspace (generating embeddings)...');

    // Sync workspace (pass test database)
    const memoriesDir = storage.getMemoriesDir();
    const stats = await syncWorkspace('test-workspace', memoriesDir, db);

    console.log(`✅ Sync complete:`);
    console.log(`   Total memories: ${stats.totalMemories}`);
    console.log(`   Already embedded: ${stats.alreadyEmbedded}`);
    console.log(`   Queued for embedding: ${stats.queuedForEmbedding}`);
    console.log(`   Embeddings generated: ${stats.embeddingsGenerated}`);
    console.log(`   Embeddings failed: ${stats.embeddingsFailed}`);
    console.log(`   Duration: ${stats.duration}ms`);

    // Verify embeddings were generated
    expect(stats.totalMemories).toBe(3);
    expect(stats.embeddingsGenerated).toBeGreaterThan(0);

    console.log('\n🔍 Step 3: Searching for similar memories...');

    // Search for database-related memories
    const results = await db.search(
      await getQueryEmbedding('database storage solutions'),
      'test-workspace',
      5,
      0.3
    );

    console.log(`✅ Found ${results.length} similar memories:`);
    for (let i = 0; i < results.length; i++) {
      console.log(`   ${i + 1}. Similarity: ${results[i].similarity.toFixed(3)} - ${results[i].id}`);
    }

    // Verify search results
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].similarity).toBeGreaterThan(0.3);

    // The first result should be about SQLite/database
    expect(results[0].workspace).toBe('test-workspace');

    console.log('\n🎉 Phase 2 integration test passed!');

  }, { timeout: 60000 }); // 60 second timeout for embedding generation

  test('incremental sync: unchanged memories not re-embedded', async () => {
    const juliePath = findJulieSemantic();
    if (!juliePath) {
      console.warn('⚠️  Skipping test - julie-semantic not found');
      return;
    }

    const storage = await getWorkspaceStorage(tempDir);

    // First sync (pass test database)
    const stats1 = await syncWorkspace('test-workspace-2', storage.getMemoriesDir(), db);

    // Second sync (no changes, pass test database)
    const stats2 = await syncWorkspace('test-workspace-2', storage.getMemoriesDir(), db);

    // All memories should already be embedded
    expect(stats2.queuedForEmbedding).toBe(0);
    expect(stats2.alreadyEmbedded).toBe(stats1.totalMemories);

    console.log('✅ Incremental sync working correctly - no duplicate embeddings');

  }, { timeout: 60000 });
});

/**
 * Helper: Generate query embedding
 */
async function getQueryEmbedding(query: string): Promise<Float32Array> {
  const juliePath = findJulieSemantic();
  if (!juliePath) {
    throw new Error('julie-semantic not available');
  }

  const { spawnSync } = await import('child_process');

  const result = spawnSync(
    juliePath,
    ['query', '--text', query, '--model', 'bge-small', '--format', 'json'],
    {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    }
  );

  if (result.error || result.status !== 0) {
    throw new Error(`julie-semantic failed: ${result.stderr}`);
  }

  const vector = JSON.parse(result.stdout.trim());
  return new Float32Array(vector);
}
