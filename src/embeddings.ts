/**
 * Embeddings module for semantic search in Goldfish
 *
 * This module handles:
 * - Generating embeddings for checkpoints using ONNX models
 * - Storing vectors in SQLite with Bun's built-in database
 * - Fast semantic search using HNSW index
 * - Cosine similarity calculations
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { mkdir } from 'fs/promises';
import type { Checkpoint } from './types';
import { getWorkspacePath } from './workspace';
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

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
  modelName: 'bge-small-en-v1.5',
  dimensions: 384,
  cachePath: '~/.goldfish/models',
  maxBatchSize: 100
};

/**
 * Singleton model instance (lazy loaded)
 */
let globalModel: FeatureExtractionPipeline | null = null;
let modelLoading: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Loads the embedding model (singleton, cached)
 */
async function loadModel(): Promise<FeatureExtractionPipeline> {
  // Return cached model if already loaded
  if (globalModel) {
    return globalModel;
  }

  // Wait for in-progress loading
  if (modelLoading) {
    return modelLoading;
  }

  // Start loading model
  modelLoading = (async () => {
    try {
      // Load feature extraction pipeline with BGE model
      // Model will be downloaded to ~/.cache/huggingface on first use
      const model = await pipeline(
        'feature-extraction',
        'Xenova/bge-small-en-v1.5',
        {
          // Quantized version for faster inference
          quantized: true,
        }
      );

      globalModel = model;
      modelLoading = null;
      return model;
    } catch (error) {
      modelLoading = null;
      throw new Error(`Failed to load embedding model: ${error}`);
    }
  })();

  return modelLoading;
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
 * Embedding engine for generating and searching embeddings
 */
export class EmbeddingEngine {
  private workspace: string;
  private config: EmbeddingConfig;
  private db: Database | null = null;
  private initialized: boolean = false;
  private checkpointCache: Map<string, Checkpoint> = new Map();

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

    const workspacePath = getWorkspacePath(this.workspace);
    const embeddingsPath = join(workspacePath, 'embeddings');

    // Ensure embeddings directory exists
    await mkdir(embeddingsPath, { recursive: true });

    // Open SQLite database
    const dbPath = join(embeddingsPath, 'db.sqlite');
    this.db = new Database(dbPath);

    // Create schema
    this.createSchema();

    // TODO: Initialize ONNX model
    // TODO: Load or build HNSW index

    this.initialized = true;
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

    try {
      // Build text for embedding
      const text = buildEmbeddingText(checkpoint);

      // Generate embedding
      const vector = await this.generateEmbedding(text);

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
      // Re-throw with more context
      throw new Error(`Failed to embed checkpoint ${checkpoint.timestamp}: ${error}`);
    }
  }

  /**
   * Generates embeddings for a batch of checkpoints
   */
  async embedBatch(checkpoints: Checkpoint[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('EmbeddingEngine not initialized');
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
   * Generates embedding vector for text using ONNX model
   */
  private async generateEmbedding(text: string): Promise<Float32Array> {
    // Handle empty text
    if (!text || text.trim().length === 0) {
      // Return zero vector for empty text
      return new Float32Array(this.config.dimensions);
    }

    try {
      // Load model (cached after first load)
      const model = await loadModel();

      // Generate embedding
      const output = await model(text, {
        pooling: 'mean',
        normalize: true
      });

      // Extract the embedding array
      // output is a Tensor, we need to convert to Float32Array
      const embedding = output.data;

      // Ensure correct dimensions
      if (embedding.length !== this.config.dimensions) {
        throw new Error(
          `Model returned ${embedding.length} dimensions, expected ${this.config.dimensions}`
        );
      }

      return new Float32Array(embedding);
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error}`);
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

    // Generate query embedding
    const queryVector = await this.generateEmbedding(query);

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
   * TODO: Implement real HNSW index
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
