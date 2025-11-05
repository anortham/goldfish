/**
 * Core types for Goldfish memory system
 */

export interface Checkpoint {
  timestamp: string;      // ISO 8601 UTC
  description: string;
  summary?: string;       // Auto-generated concise summary (for long descriptions)
  charCount?: number;     // Character count of description
  tags?: string[];
  gitBranch?: string;
  gitCommit?: string;
  files?: string[];
}

export interface CheckpointInput {
  description: string;
  tags?: string[];
  workspace?: string;     // Defaults to current workspace
}

export interface Plan {
  id: string;
  title: string;
  content: string;        // Markdown body (without frontmatter)
  status: 'active' | 'completed' | 'archived';
  created: string;        // ISO 8601 UTC
  updated: string;        // ISO 8601 UTC
  tags: string[];
}

export interface PlanInput {
  id?: string;            // Auto-generated if not provided
  title: string;
  content: string;
  workspace?: string;
  activate?: boolean;     // Make this the active plan
  status?: 'active' | 'completed' | 'archived';
  tags?: string[];
}

export interface PlanUpdate {
  title?: string;
  content?: string;
  status?: 'active' | 'completed' | 'archived';
  tags?: string[];
}

export interface RecallOptions {
  workspace?: string;     // 'current' | 'all' | specific path
  since?: string;         // Human-friendly ("2h", "30m", "3d") or ISO 8601 UTC
  days?: number;          // Look back N days (default: 2)
  from?: string;          // ISO 8601 UTC
  to?: string;            // ISO 8601 UTC
  search?: string;        // Search query (semantic or fuzzy)
  limit?: number;         // Max checkpoints to return (default: 10)
  full?: boolean;         // Return full descriptions + all metadata (default: false)

  // Semantic search options (Phase 2)
  semantic?: boolean;     // Use semantic search (default: false)
  minSimilarity?: number; // Min cosine similarity [0-1] (default: 0.0)

  // Distillation options (Phase 3)
  distill?: boolean;      // Enable LLM distillation (default: false)
  distillProvider?: 'claude' | 'gemini' | 'auto' | 'none';  // LLM provider
  distillMaxTokens?: number;  // Max tokens for distilled summary
}

export interface SearchResult {
  checkpoint: Checkpoint;
  similarity: number;     // Cosine similarity [0, 1]
  rank: number;           // Result rank (1-indexed)
}

export interface DistillResult {
  summary: string;
  provider: 'claude' | 'gemini' | 'simple';
  cached: boolean;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan;
  workspaces?: WorkspaceSummary[];  // When workspace='all'

  // Semantic search metadata (Phase 2)
  searchMethod?: 'semantic' | 'fuzzy' | 'none';
  searchResults?: SearchResult[];   // Full search results with similarity scores

  // Distillation metadata (Phase 3)
  distilled?: {
    summary: string;
    provider: 'claude' | 'gemini' | 'simple';
    originalCount: number;
    tokenReduction: number;  // Percentage reduction
  };
}

export interface WorkspaceSummary {
  name: string;
  path: string;
  checkpointCount: number;
  lastActivity?: string;  // ISO 8601 UTC
}

export interface GitContext {
  branch?: string;
  commit?: string;
  files?: string[];       // Changed files
}

export interface PlanAction {
  action: 'save' | 'get' | 'list' | 'activate' | 'update' | 'complete';
  id?: string;
  title?: string;
  content?: string;
  workspace?: string;
  activate?: boolean;
  status?: 'active' | 'completed' | 'archived';
  updates?: PlanUpdate;
}
