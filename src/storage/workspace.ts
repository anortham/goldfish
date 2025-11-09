/**
 * Workspace-level storage management for Goldfish memories
 *
 * Handles project-level `.goldfish/memories/` directory structure
 * and memory storage operations for a specific workspace.
 */

import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { Memory, StoreMemoryOptions, MemoryWithMetadata } from './types';
import { appendJsonl, getMemoryFilePath, readAllJsonl, scanJsonlFiles } from './jsonl';

/**
 * Workspace memory storage manager
 */
export class WorkspaceMemoryStorage {
  private workspacePath: string;
  private memoriesDir: string;
  private initialized: boolean = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.memoriesDir = join(workspacePath, '.goldfish', 'memories');
  }

  /**
   * Initializes the workspace storage structure
   * Creates `.goldfish/memories/` directory and `.gitignore` if needed
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Create .goldfish/memories directory
    await mkdir(this.memoriesDir, { recursive: true });

    // Create .gitignore if it doesn't exist
    const gitignorePath = join(this.workspacePath, '.goldfish', '.gitignore');
    if (!existsSync(gitignorePath)) {
      const gitignoreContent = `# Goldfish - User-specific files (not committed)
*.log
.DS_Store
temp/
`;
      await writeFile(gitignorePath, gitignoreContent, 'utf-8');
    }

    this.initialized = true;
  }

  /**
   * Stores a new memory
   * Automatically generates timestamp if not provided
   *
   * @param options Memory options
   * @returns The stored memory with generated timestamp
   *
   * @example
   * ```typescript
   * const storage = new WorkspaceMemoryStorage('/path/to/project');
   * await storage.initialize();
   *
   * const memory = await storage.store({
   *   type: 'decision',
   *   source: 'agent',
   *   content: 'Chose SQLite for vector storage because...',
   *   tags: ['database', 'architecture']
   * });
   * ```
   */
  async store(options: StoreMemoryOptions): Promise<Memory> {
    if (!this.initialized) {
      throw new Error('WorkspaceMemoryStorage not initialized');
    }

    // Create memory object
    const memory: Memory = {
      type: options.type,
      source: options.source,
      content: options.content,
      timestamp: options.timestamp || new Date().toISOString(),
      tags: options.tags
    };

    // Determine file path based on timestamp
    const filePath = getMemoryFilePath(this.memoriesDir, memory.timestamp);

    // Append to JSONL file
    await appendJsonl(filePath, memory);

    return memory;
  }

  /**
   * Retrieves all memories for this workspace
   * Returns memories sorted by timestamp (oldest to newest)
   *
   * @returns Array of all memories with metadata
   *
   * @example
   * ```typescript
   * const memories = await storage.getAll();
   * console.log(`Total memories: ${memories.length}`);
   * ```
   */
  async getAll(): Promise<MemoryWithMetadata[]> {
    if (!this.initialized) {
      throw new Error('WorkspaceMemoryStorage not initialized');
    }

    return await readAllJsonl(this.memoriesDir);
  }

  /**
   * Retrieves memories since a given timestamp
   *
   * @param since ISO 8601 timestamp
   * @returns Array of memories after the given time
   *
   * @example
   * ```typescript
   * // Get memories from last 24 hours
   * const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
   * const recentMemories = await storage.getSince(yesterday);
   * ```
   */
  async getSince(since: string): Promise<MemoryWithMetadata[]> {
    const allMemories = await this.getAll();
    const sinceTime = new Date(since).getTime();

    return allMemories.filter(memory => {
      return new Date(memory.timestamp).getTime() >= sinceTime;
    });
  }

  /**
   * Retrieves memories within a date range
   *
   * @param from Start timestamp (inclusive)
   * @param to End timestamp (inclusive)
   * @returns Array of memories within the range
   *
   * @example
   * ```typescript
   * const memories = await storage.getRange(
   *   '2025-11-01T00:00:00Z',
   *   '2025-11-07T23:59:59Z'
   * );
   * ```
   */
  async getRange(from: string, to: string): Promise<MemoryWithMetadata[]> {
    const allMemories = await this.getAll();
    const fromTime = new Date(from).getTime();
    const toTime = new Date(to).getTime();

    return allMemories.filter(memory => {
      const memoryTime = new Date(memory.timestamp).getTime();
      return memoryTime >= fromTime && memoryTime <= toTime;
    });
  }

  /**
   * Counts total memories in workspace
   *
   * @returns Total number of memories
   */
  async count(): Promise<number> {
    const memories = await this.getAll();
    return memories.length;
  }

  /**
   * Lists all JSONL files in workspace
   *
   * @returns Array of file paths
   */
  async listFiles(): Promise<string[]> {
    if (!this.initialized) {
      throw new Error('WorkspaceMemoryStorage not initialized');
    }

    return await scanJsonlFiles(this.memoriesDir);
  }

  /**
   * Gets the memories directory path
   *
   * @returns Path to .goldfish/memories directory
   */
  getMemoriesDir(): string {
    return this.memoriesDir;
  }

  /**
   * Gets the workspace path
   *
   * @returns Path to workspace root
   */
  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Checks if workspace storage is initialized
   *
   * @returns True if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Singleton storage instances per workspace
 */
const storageInstances = new Map<string, WorkspaceMemoryStorage>();

/**
 * Gets or creates a workspace storage instance
 *
 * @param workspacePath Path to workspace root
 * @returns Initialized workspace storage
 *
 * @example
 * ```typescript
 * const storage = await getWorkspaceStorage('/path/to/project');
 * await storage.store({
 *   type: 'feature',
 *   source: 'agent',
 *   content: 'Implemented semantic search with GPU acceleration'
 * });
 * ```
 */
export async function getWorkspaceStorage(workspacePath: string): Promise<WorkspaceMemoryStorage> {
  let storage = storageInstances.get(workspacePath);

  if (!storage) {
    storage = new WorkspaceMemoryStorage(workspacePath);
    await storage.initialize();
    storageInstances.set(workspacePath, storage);
  }

  return storage;
}

/**
 * Clears all storage instances (for testing)
 */
export function clearStorageInstances(): void {
  storageInstances.clear();
}
