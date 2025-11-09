/**
 * Type definitions for Goldfish memory storage
 */

/**
 * Memory types - categorizes the kind of memory being stored
 */
export type MemoryType =
  | 'decision'           // Architectural or implementation decisions
  | 'bug-fix'            // Bug fixes and their root causes
  | 'feature'            // New features implemented
  | 'insight'            // Discoveries or learnings
  | 'observation'        // Notable observations during development
  | 'refactor';          // Code refactoring and improvements

/**
 * Memory source - indicates who/what created the memory
 */
export type MemorySource =
  | 'agent'              // AI coding agent
  | 'user'               // Human developer
  | 'system'             // Automated system event
  | 'development-session'; // Development session summary

/**
 * Memory record - stored in JSONL format
 *
 * Example:
 * ```json
 * {
 *   "type": "decision",
 *   "source": "agent",
 *   "content": "Chose SQLite over PostgreSQL for vector storage...",
 *   "timestamp": "2025-11-09T10:30:00.000Z",
 *   "tags": ["database", "architecture"]
 * }
 * ```
 */
export interface Memory {
  type: MemoryType;
  source: MemorySource;
  content: string;          // 2-4 sentences recommended
  timestamp: string;        // ISO 8601 UTC
  tags?: string[];          // Optional categorization
}

/**
 * Memory with computed metadata (not stored in JSONL)
 */
export interface MemoryWithMetadata extends Memory {
  lineNumber: number;       // Line number in JSONL file (1-indexed)
  filePath: string;         // Path to JSONL file
  hash: string;             // BLAKE3 content hash
}

/**
 * Memory search result
 */
export interface MemorySearchResult {
  memory: Memory;
  similarity: number;       // Cosine similarity [0-1]
  rank: number;            // Result rank (1-indexed)
  lineNumber: number;      // Line in JSONL file
  filePath: string;        // Path to JSONL file
}

/**
 * Options for storing a memory
 */
export interface StoreMemoryOptions {
  type: MemoryType;
  source: MemorySource;
  content: string;
  tags?: string[];
  // timestamp is auto-generated if not provided
  timestamp?: string;
}

/**
 * Options for recalling memories
 */
export interface RecallMemoryOptions {
  query: string;                    // Semantic search query
  workspace?: 'current' | 'all';    // Search scope
  limit?: number;                   // Max results (default: 10)
  minSimilarity?: number;           // Minimum similarity [0-1] (default: 0.5)
  since?: string;                   // ISO 8601 timestamp (filter memories after this time)
  types?: MemoryType[];             // Filter by memory types
  sources?: MemorySource[];         // Filter by sources
  tags?: string[];                  // Filter by tags (OR logic)
}

/**
 * Workspace memory statistics
 */
export interface WorkspaceStats {
  workspace: string;
  totalMemories: number;
  memoriesByType: Record<MemoryType, number>;
  memoriesBySource: Record<MemorySource, number>;
  oldestMemory: string;         // ISO 8601 timestamp
  newestMemory: string;         // ISO 8601 timestamp
  totalSize: number;            // Total bytes in JSONL files
}
