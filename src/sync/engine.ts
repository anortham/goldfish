/**
 * Workspace sync engine
 *
 * Scans .goldfish/memories/ JSONL files and generates embeddings
 * for memories that don't have them or have changed content.
 */

import { readAllJsonl } from '../storage/jsonl';
import { hashContent } from '../storage/hash';
import { getEmbeddingDatabase, type EmbeddingRecord } from '../database/embeddings';
import type { MemoryWithMetadata } from '../storage/types';
import { spawnSync } from 'child_process';
import { findJulieSemantic } from '../embeddings';

/**
 * Item queued for embedding generation
 */
interface EmbeddingQueueItem {
  id: string;
  workspace: string;
  filePath: string;
  lineNumber: number;
  content: string;
  contentHash: string;
}

/**
 * Sync statistics
 */
export interface SyncStats {
  totalMemories: number;
  alreadyEmbedded: number;
  queuedForEmbedding: number;
  embeddingsGenerated: number;
  embeddingsFailed: number;
  duration: number; // milliseconds
}

/**
 * Workspace sync engine
 */
export class SyncEngine {
  private workspace: string;
  private memoriesDir: string;
  private juliePath: string | null = null;
  private database: any | null = null; // Optional custom database for testing

  constructor(workspace: string, memoriesDir: string, database?: any) {
    this.workspace = workspace;
    this.memoriesDir = memoriesDir;
    this.database = database;
  }

  /**
   * Syncs workspace memories with embedding database
   * Returns statistics about the sync operation
   */
  async sync(): Promise<SyncStats> {
    const startTime = Date.now();

    const stats: SyncStats = {
      totalMemories: 0,
      alreadyEmbedded: 0,
      queuedForEmbedding: 0,
      embeddingsGenerated: 0,
      embeddingsFailed: 0,
      duration: 0
    };

    // Check if julie-semantic is available
    this.juliePath = findJulieSemantic();

    if (!this.juliePath) {
      console.warn(`⚠️  julie-semantic not found - skipping embedding generation for ${this.workspace}`);
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Read all memories from JSONL files
    const memories = await readAllJsonl(this.memoriesDir);
    stats.totalMemories = memories.length;

    if (memories.length === 0) {
      console.log(`No memories found in ${this.workspace}`);
      stats.duration = Date.now() - startTime;
      return stats;
    }

    // Get embedding database (use custom or global)
    const db = this.database || await getEmbeddingDatabase();

    // Determine which memories need embeddings
    const queue: EmbeddingQueueItem[] = [];

    for (const memory of memories) {
      const id = `${this.workspace}:${memory.filePath.split('/').pop()?.replace('.jsonl', '')}:${memory.lineNumber}`;
      const contentHash = hashContent(memory.content);

      // Check if embedding exists with matching hash
      const exists = await db.existsWithHash(id, contentHash);

      if (exists) {
        stats.alreadyEmbedded++;
      } else {
        // Queue for embedding generation
        queue.push({
          id,
          workspace: this.workspace,
          filePath: memory.filePath,
          lineNumber: memory.lineNumber,
          content: memory.content,
          contentHash
        });
      }
    }

    stats.queuedForEmbedding = queue.length;

    if (queue.length === 0) {
      console.log(`✅ ${this.workspace}: All ${memories.length} memories already embedded`);
      stats.duration = Date.now() - startTime;
      return stats;
    }

    console.log(`📊 ${this.workspace}: ${queue.length} memories need embeddings`);

    // Generate embeddings
    const results = await this.generateEmbeddings(queue);
    stats.embeddingsGenerated = results.generated;
    stats.embeddingsFailed = results.failed;

    stats.duration = Date.now() - startTime;

    console.log(`✅ ${this.workspace} sync complete: ${stats.embeddingsGenerated} embedded, ${stats.embeddingsFailed} failed (${stats.duration}ms)`);

    return stats;
  }

  /**
   * Generates embeddings for queued items
   */
  private async generateEmbeddings(queue: EmbeddingQueueItem[]): Promise<{
    generated: number;
    failed: number;
  }> {
    if (!this.juliePath) {
      return { generated: 0, failed: queue.length };
    }

    const db = this.database || await getEmbeddingDatabase();
    let generated = 0;
    let failed = 0;

    for (const item of queue) {
      try {
        // Generate embedding via julie-semantic
        const vector = await this.callJulieSemantic(item.content);

        if (!vector) {
          console.warn(`⚠️  Failed to generate embedding for ${item.id}`);
          failed++;
          continue;
        }

        // Store in database
        const record: EmbeddingRecord = {
          id: item.id,
          workspace: item.workspace,
          filePath: item.filePath,
          lineNumber: item.lineNumber,
          vector,
          contentHash: item.contentHash,
          createdAt: new Date().toISOString()
        };

        await db.store(record);
        generated++;

      } catch (error) {
        console.error(`❌ Failed to embed ${item.id}:`, error);
        failed++;
      }
    }

    return { generated, failed };
  }

  /**
   * Calls julie-semantic to generate embedding
   */
  private async callJulieSemantic(text: string): Promise<Float32Array | null> {
    if (!this.juliePath) {
      return null;
    }

    try {
      const result = spawnSync(
        this.juliePath,
        ['query', '--text', text, '--model', 'bge-small', '--format', 'json'],
        {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024,
          timeout: 30000
        }
      );

      if (result.error || result.status !== 0) {
        console.error('julie-semantic error:', result.stderr);
        return null;
      }

      const vector = JSON.parse(result.stdout.trim());

      if (!Array.isArray(vector) || vector.length !== 384) {
        console.error(`Invalid embedding dimensions: ${vector.length}`);
        return null;
      }

      return new Float32Array(vector);
    } catch (error) {
      console.error('Failed to call julie-semantic:', error);
      return null;
    }
  }
}

/**
 * Syncs a workspace on startup or on demand
 *
 * @param workspace Workspace name
 * @param memoriesDir Path to .goldfish/memories directory
 * @param database Optional custom database (for testing)
 * @returns Sync statistics
 *
 * @example
 * ```typescript
 * const stats = await syncWorkspace('my-project', '/path/to/project/.goldfish/memories');
 * console.log(`Embedded ${stats.embeddingsGenerated} memories`);
 * ```
 */
export async function syncWorkspace(
  workspace: string,
  memoriesDir: string,
  database?: any
): Promise<SyncStats> {
  const engine = new SyncEngine(workspace, memoriesDir, database);
  return await engine.sync();
}
