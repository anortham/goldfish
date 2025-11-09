/**
 * Embeddings module for semantic search in Goldfish
 *
 * This module handles:
 * - Generating embeddings using julie-semantic (GPU-accelerated via DirectML/CUDA)
 * - Storing vectors in SQLite with Bun's built-in database
 * - Fast semantic search using cosine similarity
 */

import { Database } from 'bun:sqlite';
import { join, dirname } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { platform, arch } from 'os';
import type { Checkpoint } from './types';
import { getWorkspacePath } from './workspace';

/**
 * Configuration for embedding generation
 */
export interface EmbeddingConfig {
  modelName: string;
  dimensions: number;
  cachePath: string;
  maxBatchSize: number;
}

/**
 * Stored embedding record
 */
export interface EmbeddingRecord {
  vectorId: string;
  checkpointId: string;
  vector: Float32Array;
  modelName: string;
  createdAt: number;
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  checkpoint: Checkpoint;
  similarity: number;
  rank: number;
}

/**
 * Default configuration for BGE-Small-EN-V1.5 model
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  modelName: 'bge-small',
  dimensions: 384,
  cachePath: '~/.goldfish/models',
  maxBatchSize: 100
};

/**
 * Cached path to julie-semantic binary
 */
let JULIE_SEMANTIC_PATH: string | null | undefined = undefined;

/**
 * Finds the julie-semantic binary
 * Returns the path if found, null if not available
 * Checks in order: PATH → bundled binary → null
 */
export function findJulieSemantic(): string | null {
  // Return cached result
  if (JULIE_SEMANTIC_PATH !== undefined) {
    return JULIE_SEMANTIC_PATH;
  }

  // 1. Check if julie-semantic is in PATH
  const whichCommand = platform() === 'win32' ? 'where' : 'which';
  const whichResult = spawnSync(whichCommand, ['julie-semantic'], {
    encoding: 'utf-8',
    shell: true
  });

  if (whichResult.status === 0 && whichResult.stdout.trim()) {
    JULIE_SEMANTIC_PATH = 'julie-semantic';
    console.log('✅ Found julie-semantic in PATH');
    return JULIE_SEMANTIC_PATH;
  }

  // 2. Check for bundled binary
  let binaryName: string;
  const currentPlatform = platform();
  const currentArch = arch();

  if (currentPlatform === 'win32') {
    binaryName = 'julie-semantic-windows.exe';
  } else if (currentPlatform === 'darwin') {
    binaryName = currentArch === 'arm64'
      ? 'julie-semantic-macos-arm64'
      : 'julie-semantic-macos-intel';
  } else if (currentPlatform === 'linux') {
    binaryName = 'julie-semantic-linux';
  } else {
    console.warn(`⚠️  Unsupported platform: ${currentPlatform} - semantic search disabled`);
    JULIE_SEMANTIC_PATH = null;
    return null;
  }

  // Check in bin/ directory (relative to this file)
  const bundledPath = join(dirname(dirname(__filename)), 'bin', binaryName);

  if (existsSync(bundledPath)) {
    JULIE_SEMANTIC_PATH = bundledPath;
    console.log(`✅ Using bundled julie-semantic: ${bundledPath}`);
    return JULIE_SEMANTIC_PATH;
  }

  // 3. Not found - semantic search disabled
  console.warn('⚠️  julie-semantic not found - semantic search will be disabled');
  console.warn('   Goldfish will work with fuzzy search only');
  console.warn('   Install julie-semantic from: https://github.com/anortham/julie/releases');
  JULIE_SEMANTIC_PATH = null;
  return null;
}

/**
 * Builds embedding text from checkpoint by combining relevant fields
 */
export function buildEmbeddingText(checkpoint: Checkpoint): string {
  const parts: string[] = [];

  // Always include description
  parts.push(checkpoint.description);

  // Add tags if present
  if (checkpoint.tags && checkpoint.tags.length > 0) {
    parts.push(checkpoint.tags.join(' '));
  }

  // Add git branch if present
  if (checkpoint.gitBranch) {
    parts.push(checkpoint.gitBranch);
  }

  return parts.join(' ');
}

/**
 * Calculates cosine similarity between two vectors
 * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(vec1: Float32Array, vec2: Float32Array): number {
  if (vec1.length !== vec2.length) {
    throw new Error(`Vector dimensions must match: ${vec1.length} !== ${vec2.length}`);
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);

  if (magnitude === 0) {
    return 0;
  }

  return dotProduct / magnitude;
}

/**
 * Generates embedding vector for text using julie-semantic
 * Returns null if julie-semantic is not available or if generation fails
 */
async function generateEmbedding(text: string): Promise<Float32Array | null> {
  // Check if julie-semantic is available
  const juliePath = findJulieSemantic();

  if (!juliePath) {
    // Semantic search not available
    return null;
  }

  // Handle empty text
  if (!text || text.trim().length === 0) {
    return null;
  }

  try {
    // Call julie-semantic subprocess
    const result = spawnSync(
      juliePath,
      ['query', '--text', text, '--model', 'bge-small', '--format', 'json'],
      {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: 30000, // 30 second timeout
      }
    );

    if (result.error) {
      console.error('❌ Failed to spawn julie-semantic:', result.error);
      return null;
    }

    if (result.status !== 0) {
      console.error('❌ julie-semantic failed:', result.stderr);
      return null;
    }

    // Parse JSON output
    const vector = JSON.parse(result.stdout.trim());

    if (!Array.isArray(vector)) {
      console.error('❌ Invalid julie-semantic output: expected array');
      return null;
    }

    if (vector.length !== 384) {
      console.error(`❌ Invalid embedding dimensions: expected 384, got ${vector.length}`);
      return null;
    }

    return new Float32Array(vector);
  } catch (error) {
    console.error('❌ Embedding generation failed:', error);
    return null;
  }
}

/**
 * Embedding engine for generating and searching embeddings
 */
export class EmbeddingEngine {
  private workspace: string;
  private config: EmbeddingConfig;
  private db: Database | null = null;
  private initialized: boolean = false;
  private checkpointCache: Map<string, Checkpoint> = new Map();
  private semanticEnabled: boolean = false;

  constructor(workspace: string, config?: Partial<EmbeddingConfig>) {
    this.workspace = workspace;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initializes the embedding engine and database
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Check if julie-semantic is available
    const juliePath = findJulieSemantic();
    this.semanticEnabled = juliePath !== null;

    if (!this.semanticEnabled) {
      console.warn('⚠️  Semantic search disabled - julie-semantic not found');
      console.warn('   Goldfish will work with fuzzy search only');
    }

    const workspacePath = getWorkspacePath(this.workspace);
    const embeddingsPath = join(workspacePath, 'embeddings');

    // Ensure embeddings directory exists
    await mkdir(embeddingsPath, { recursive: true });

    // Open SQLite database
    const dbPath = join(embeddingsPath, 'db.sqlite');
    this.db = new Database(dbPath);

    // Create schema
    this.createSchema();

    this.initialized = true;

    if (this.semanticEnabled) {
      console.log('✅ Embedding engine initialized with GPU acceleration');
    }
  }

  /**
   * Creates database schema for embeddings
   */
  private createSchema(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS embedding_vectors (
        vector_id TEXT PRIMARY KEY,
        dimensions INTEGER NOT NULL,
        vector_data BLOB NOT NULL,
        model_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS checkpoint_embeddings (
        checkpoint_id TEXT PRIMARY KEY,
        vector_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (vector_id) REFERENCES embedding_vectors(vector_id)
      )
    `);

    // Create indexes
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_checkpoint_model
      ON checkpoint_embeddings(model_name)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_vector_model
      ON embedding_vectors(model_name)
    `);
  }

  /**
   * Checks if engine is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Checks if semantic search is enabled
   */
  isSemanticEnabled(): boolean {
    return this.semanticEnabled;
  }

  /**
   * Gets embedding dimensions
   */
  getDimensions(): number {
    return this.config.dimensions;
  }

  /**
   * Generates embedding for a checkpoint
   */
  async embedCheckpoint(checkpoint: Checkpoint): Promise<void> {
    if (!this.initialized || !this.db) {
      throw new Error('EmbeddingEngine not initialized');
    }

    if (!this.semanticEnabled) {
      // Skip embedding generation if semantic search is disabled
      return;
    }

    try {
      // Build text for embedding
      const text = buildEmbeddingText(checkpoint);

      // Generate embedding via julie-semantic
      const vector = await generateEmbedding(text);

      if (!vector) {
        // Embedding generation failed - skip but don't throw
        console.warn(`⚠️  Failed to generate embedding for checkpoint ${checkpoint.timestamp}`);
        return;
      }

      // Store in database
      const vectorId = `vec_${checkpoint.timestamp}`;
      const now = Date.now();

      // Store vector
      const vectorBuffer = Buffer.from(vector.buffer);

      this.db.run(
        `INSERT OR REPLACE INTO embedding_vectors
         (vector_id, dimensions, vector_data, model_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [vectorId, this.config.dimensions, vectorBuffer, this.config.modelName, now]
      );

      // Link to checkpoint
      this.db.run(
        `INSERT OR REPLACE INTO checkpoint_embeddings
         (checkpoint_id, vector_id, model_name, created_at)
         VALUES (?, ?, ?, ?)`,
        [checkpoint.timestamp, vectorId, this.config.modelName, now]
      );

      // Cache checkpoint for search
      this.checkpointCache.set(checkpoint.timestamp, checkpoint);
    } catch (error) {
      // Log but don't fail - semantic search is optional
      console.warn(`⚠️  Failed to embed checkpoint ${checkpoint.timestamp}:`, error);
    }
  }

  /**
   * Generates embeddings for a batch of checkpoints
   */
  async embedBatch(checkpoints: Checkpoint[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('EmbeddingEngine not initialized');
    }

    if (!this.semanticEnabled) {
      // Skip if semantic search is disabled
      return;
    }

    // Process in batches
    const batchSize = this.config.maxBatchSize;

    for (let i = 0; i < checkpoints.length; i += batchSize) {
      const batch = checkpoints.slice(i, i + batchSize);

      // Process batch concurrently (but not too many at once)
      await Promise.all(
        batch.map(checkpoint => this.embedCheckpoint(checkpoint))
      );
    }
  }

  /**
   * Retrieves embedding for a checkpoint
   */
  async getEmbedding(checkpointId: string): Promise<EmbeddingRecord | null> {
    if (!this.initialized || !this.db) {
      throw new Error('EmbeddingEngine not initialized');
    }

    const query = this.db.query(`
      SELECT ce.checkpoint_id, ce.vector_id, ev.vector_data, ev.model_name, ev.created_at
      FROM checkpoint_embeddings ce
      JOIN embedding_vectors ev ON ce.vector_id = ev.vector_id
      WHERE ce.checkpoint_id = ?
    `);

    const row = query.get(checkpointId) as any;

    if (!row) {
      return null;
    }

    // Convert blob back to Float32Array
    const buffer = row.vector_data;
    const vector = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
    );

    return {
      vectorId: row.vector_id,
      checkpointId: row.checkpoint_id,
      vector,
      modelName: row.model_name,
      createdAt: row.created_at
    };
  }

  /**
   * Searches for semantically similar checkpoints
   * @param query Search query
   * @param checkpoints Available checkpoints to search through
   * @param limit Maximum number of results
   * @param minSimilarity Minimum similarity threshold [0-1]
   */
  async searchSemantic(
    query: string,
    checkpoints: Checkpoint[],
    limit: number = 10,
    minSimilarity: number = 0.0
  ): Promise<SearchResult[]> {
    if (!this.initialized || !this.db) {
      throw new Error('EmbeddingEngine not initialized');
    }

    if (!this.semanticEnabled) {
      // Semantic search not available
      return [];
    }

    // Generate query embedding via julie-semantic
    const queryVector = await generateEmbedding(query);

    if (!queryVector) {
      // Query embedding failed
      return [];
    }

    // Build checkpoint lookup map
    const checkpointMap = new Map<string, Checkpoint>();
    for (const checkpoint of checkpoints) {
      checkpointMap.set(checkpoint.timestamp, checkpoint);
    }

    // Get all embeddings from database for checkpoints we have
    const checkpointIds = Array.from(checkpointMap.keys());

    if (checkpointIds.length === 0) {
      return [];
    }

    const placeholders = checkpointIds.map(() => '?').join(',');
    const allQuery = this.db.query(`
      SELECT ce.checkpoint_id, ev.vector_data
      FROM checkpoint_embeddings ce
      JOIN embedding_vectors ev ON ce.vector_id = ev.vector_id
      WHERE ce.model_name = ? AND ce.checkpoint_id IN (${placeholders})
    `);

    const rows = allQuery.all(this.config.modelName, ...checkpointIds) as any[];

    if (rows.length === 0) {
      return [];
    }

    // Calculate similarities
    const results: Array<{ checkpointId: string; similarity: number }> = [];

    for (const row of rows) {
      const buffer = row.vector_data;
      const vector = new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / Float32Array.BYTES_PER_ELEMENT
      );

      const similarity = cosineSimilarity(queryVector, vector);

      if (similarity >= minSimilarity) {
        results.push({
          checkpointId: row.checkpoint_id,
          similarity
        });
      }
    }

    // Sort by similarity (highest first)
    results.sort((a, b) => b.similarity - a.similarity);

    // Limit results
    const topResults = results.slice(0, limit);

    // Build search results with checkpoint data
    const searchResults: SearchResult[] = [];

    for (let i = 0; i < topResults.length; i++) {
      const result = topResults[i];
      const checkpoint = checkpointMap.get(result.checkpointId);

      if (checkpoint) {
        searchResults.push({
          checkpoint,
          similarity: result.similarity,
          rank: i + 1
        });
      }
    }

    return searchResults;
  }

  /**
   * Rebuilds HNSW index from stored vectors
   * TODO: Implement real HNSW index for faster search
   */
  async rebuildIndex(): Promise<void> {
    if (!this.initialized) {
      throw new Error('EmbeddingEngine not initialized');
    }

    // TODO: Rebuild HNSW index from database
    // For now, this is a no-op since we're doing linear search
  }

  /**
   * Closes database and cleans up resources
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this.initialized = false;
    this.checkpointCache.clear();
  }
}

/**
 * Gets or creates a singleton embedding engine for a workspace
 */
const engines = new Map<string, EmbeddingEngine>();

export async function getEmbeddingEngine(workspace: string): Promise<EmbeddingEngine> {
  let engine = engines.get(workspace);

  if (!engine) {
    engine = new EmbeddingEngine(workspace);
    await engine.initialize();
    engines.set(workspace, engine);
  }

  return engine;
}

/**
 * Closes all embedding engines
 */
export async function closeAllEngines(): Promise<void> {
  for (const engine of engines.values()) {
    await engine.close();
  }
  engines.clear();
}
