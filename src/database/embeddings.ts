/**
 * User-level embedding database with sqlite-vec
 *
 * Stores embeddings from all workspaces in a single user-level database
 * at ~/.goldfish/index.db with vector similarity search via sqlite-vec
 */

import { Database } from 'bun:sqlite';
import { join } from 'path';
import { homedir } from 'os';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as sqliteVec from 'sqlite-vec';

/**
 * Embedding record in database
 */
export interface EmbeddingRecord {
  id: string;                   // {workspace}:{date}:{line_number}
  workspace: string;            // Normalized workspace name
  filePath: string;             // Relative path: .goldfish/memories/YYYY-MM-DD.jsonl
  lineNumber: number;           // Line number in JSONL (1-indexed)
  vector: Float32Array;         // 384-dim embedding vector
  contentHash: string;          // BLAKE3 hash for change detection
  createdAt: string;            // ISO 8601 UTC timestamp
}

/**
 * Vector search result
 */
export interface VectorSearchResult {
  id: string;
  workspace: string;
  filePath: string;
  lineNumber: number;
  similarity: number;           // Cosine similarity [0-1]
  contentHash: string;
}

/**
 * User-level embedding database manager
 */
export class EmbeddingDatabase {
  private db: Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;

  constructor(dbPath?: string) {
    // Default to ~/.goldfish/index.db
    this.dbPath = dbPath || join(homedir(), '.goldfish', 'index.db');
  }

  /**
   * Initializes the database and loads sqlite-vec extension
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Ensure directory exists
    const dir = join(this.dbPath, '..');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Open database
    this.db = new Database(this.dbPath);

    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Create schema
    this.createSchema();

    this.initialized = true;
    console.log(`✅ Embedding database initialized: ${this.dbPath}`);
  }

  /**
   * Creates database schema
   */
  private createSchema(): void {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create embeddings table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        workspace TEXT NOT NULL,
        file_path TEXT NOT NULL,
        line_number INTEGER NOT NULL,
        vector BLOB NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // Create indexes for efficient queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_workspace
      ON embeddings(workspace)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_content_hash
      ON embeddings(content_hash)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_workspace_file
      ON embeddings(workspace, file_path)
    `);

    // Create workspace metadata table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace TEXT PRIMARY KEY,
        full_path TEXT NOT NULL,
        last_synced TEXT NOT NULL,
        memory_count INTEGER DEFAULT 0
      )
    `);
  }

  /**
   * Stores an embedding
   * If embedding with same ID exists, it's replaced
   */
  async store(record: EmbeddingRecord): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const vectorBlob = Buffer.from(record.vector.buffer);

    this.db.run(
      `INSERT OR REPLACE INTO embeddings
       (id, workspace, file_path, line_number, vector, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.workspace,
        record.filePath,
        record.lineNumber,
        vectorBlob,
        record.contentHash,
        record.createdAt
      ]
    );
  }

  /**
   * Stores multiple embeddings in a transaction
   */
  async storeBatch(records: EmbeddingRecord[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (records.length === 0) {
      return;
    }

    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO embeddings
       (id, workspace, file_path, line_number, vector, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const transaction = this.db.transaction((records: EmbeddingRecord[]) => {
      for (const record of records) {
        const vectorBlob = Buffer.from(record.vector.buffer);
        stmt.run(
          record.id,
          record.workspace,
          record.filePath,
          record.lineNumber,
          vectorBlob,
          record.contentHash,
          record.createdAt
        );
      }
    });

    transaction(records);
  }

  /**
   * Retrieves an embedding by ID
   */
  async get(id: string): Promise<EmbeddingRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.query(
      'SELECT * FROM embeddings WHERE id = ?'
    ).get(id) as any;

    if (!row) {
      return null;
    }

    return this.rowToRecord(row);
  }

  /**
   * Checks if embedding exists with given content hash
   */
  async existsWithHash(id: string, contentHash: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.query(
      'SELECT 1 FROM embeddings WHERE id = ? AND content_hash = ?'
    ).get(id, contentHash) as any;

    return row !== null;
  }

  /**
   * Deletes an embedding by ID
   */
  async delete(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.run('DELETE FROM embeddings WHERE id = ?', [id]);
  }

  /**
   * Deletes all embeddings for a workspace
   */
  async deleteWorkspace(workspace: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.run('DELETE FROM embeddings WHERE workspace = ?', [workspace]);
  }

  /**
   * Searches for similar vectors using cosine similarity
   * Uses sqlite-vec for efficient vector search
   *
   * @param queryVector Query embedding vector
   * @param workspace Workspace to search in ('all' for all workspaces)
   * @param limit Max results to return
   * @param minSimilarity Minimum similarity threshold [0-1]
   */
  async search(
    queryVector: Float32Array,
    workspace: string = 'all',
    limit: number = 10,
    minSimilarity: number = 0.5
  ): Promise<VectorSearchResult[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Convert query vector to blob
    const queryBlob = Buffer.from(queryVector.buffer);

    // Build query based on workspace filter
    let query: string;
    let params: any[];

    if (workspace === 'all') {
      // Search across all workspaces
      query = `
        SELECT
          id,
          workspace,
          file_path,
          line_number,
          content_hash,
          vec_distance_cosine(vector, ?) as distance
        FROM embeddings
        ORDER BY distance ASC
        LIMIT ?
      `;
      params = [queryBlob, limit * 2]; // Get more results to filter by minSimilarity
    } else {
      // Search specific workspace
      query = `
        SELECT
          id,
          workspace,
          file_path,
          line_number,
          content_hash,
          vec_distance_cosine(vector, ?) as distance
        FROM embeddings
        WHERE workspace = ?
        ORDER BY distance ASC
        LIMIT ?
      `;
      params = [queryBlob, workspace, limit * 2];
    }

    const rows = this.db.query(query).all(...params) as any[];

    // Convert distance to similarity and filter
    const results: VectorSearchResult[] = [];

    for (const row of rows) {
      // vec_distance_cosine returns distance [0-2], convert to similarity [0-1]
      const similarity = 1 - (row.distance / 2);

      if (similarity >= minSimilarity) {
        results.push({
          id: row.id,
          workspace: row.workspace,
          filePath: row.file_path,
          lineNumber: row.line_number,
          similarity,
          contentHash: row.content_hash
        });
      }

      // Stop once we have enough results
      if (results.length >= limit) {
        break;
      }
    }

    return results;
  }

  /**
   * Counts total embeddings in database
   */
  async count(): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.query(
      'SELECT COUNT(*) as count FROM embeddings'
    ).get() as any;

    return row.count;
  }

  /**
   * Counts embeddings for a specific workspace
   */
  async countWorkspace(workspace: string): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const row = this.db.query(
      'SELECT COUNT(*) as count FROM embeddings WHERE workspace = ?'
    ).get(workspace) as any;

    return row.count;
  }

  /**
   * Lists all workspaces in database
   */
  async listWorkspaces(): Promise<string[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const rows = this.db.query(
      'SELECT DISTINCT workspace FROM embeddings ORDER BY workspace'
    ).all() as any[];

    return rows.map(row => row.workspace);
  }

  /**
   * Updates workspace metadata
   */
  async updateWorkspaceMetadata(
    workspace: string,
    fullPath: string,
    memoryCount: number
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    this.db.run(
      `INSERT OR REPLACE INTO workspaces
       (workspace, full_path, last_synced, memory_count)
       VALUES (?, ?, ?, ?)`,
      [workspace, fullPath, new Date().toISOString(), memoryCount]
    );
  }

  /**
   * Converts database row to EmbeddingRecord
   */
  private rowToRecord(row: any): EmbeddingRecord {
    const vectorBuffer = row.vector as Buffer;
    const vector = new Float32Array(
      vectorBuffer.buffer,
      vectorBuffer.byteOffset,
      vectorBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
    );

    return {
      id: row.id,
      workspace: row.workspace,
      filePath: row.file_path,
      lineNumber: row.line_number,
      vector,
      contentHash: row.content_hash,
      createdAt: row.created_at
    };
  }

  /**
   * Closes the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }

  /**
   * Gets database path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Checks if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton database instance
 */
let globalDatabase: EmbeddingDatabase | null = null;

/**
 * Gets or creates the global embedding database
 */
export async function getEmbeddingDatabase(): Promise<EmbeddingDatabase> {
  if (!globalDatabase) {
    globalDatabase = new EmbeddingDatabase();
    await globalDatabase.initialize();
  }

  return globalDatabase;
}

/**
 * Closes the global database (for testing)
 */
export async function closeGlobalDatabase(): Promise<void> {
  if (globalDatabase) {
    await globalDatabase.close();
    globalDatabase = null;
  }
}
