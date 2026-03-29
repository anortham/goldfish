/**
 * Core types for Goldfish memory system
 */

export interface Checkpoint {
  id: string;             // checkpoint_{hash} unique identifier
  timestamp: string;      // ISO 8601 UTC
  description: string;    // Markdown body
  workspace?: string;     // Workspace label used in cross-workspace recall results
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[];
  impact?: string;
  evidence?: string[];
  symbols?: string[];     // Key symbols touched/affected
  next?: string;          // Follow-up action or open question
  confidence?: number;    // Confidence score (1-5)
  unknowns?: string[];
  tags?: string[];
  git?: GitContext;        // Git context at checkpoint time
  summary?: string;       // Auto-generated concise summary (for recall display)
  planId?: string;        // ID of active plan when checkpoint was created
  filePath?: string;        // Absolute path to checkpoint file on disk
}

export interface CheckpointInput {
  description: string;
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[];
  impact?: string;
  evidence?: string[];
  symbols?: string[];
  next?: string;
  confidence?: number;
  unknowns?: string[];
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
  days?: number;          // Look back N days (no default — only used when explicitly set)
  from?: string;          // ISO 8601 UTC
  to?: string;            // ISO 8601 UTC
  search?: string;        // Fuzzy search query
  limit?: number;         // Max checkpoints to return (default: 5)
  full?: boolean;         // Return full descriptions + all metadata (default: false)
  planId?: string;        // Filter to checkpoints associated with this plan
  includeMemory?: boolean;  // Include memory.yaml in response. Defaults: true (no search), false (with search). Override explicitly.
  _registryDir?: string;  // Internal: override registry dir for test isolation
  _semanticRuntime?: SemanticRuntime; // Internal: semantic runtime override for test isolation
}

export interface SemanticRuntime {
  isReady(): boolean
  getModelInfo?(): SemanticModelInfo | undefined
  embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]>
}

export interface SemanticModelInfo {
  id: string
  version: string
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan | null;
  workspaces?: WorkspaceSummary[];  // When workspace='all'
  memory?: string;                     // memory.yaml content (when includeMemory is true)
  matchedMemorySections?: MemorySection[];  // Memory sections that matched search query
  consolidation?: {
    needed: boolean;
    staleCheckpoints: number;
    lastConsolidated: string | null;    // ISO 8601 UTC or null if never consolidated
  };
}

export interface WorkspaceSummary {
  name: string;
  path: string;
  checkpointCount: number;
  lastActivity?: string;  // ISO 8601 UTC
  memorySummary?: string | null;  // First lines of memory.yaml (up to 300 chars)
}

export interface GitContext {
  branch?: string;
  commit?: string;
  files?: string[];       // Changed files
}

export interface RegisteredProject {
  path: string;       // Absolute path to project root
  name: string;       // Normalized workspace name (via normalizeWorkspace)
  registered: string; // ISO 8601 UTC
}

export interface Registry {
  projects: RegisteredProject[];
}

export interface ConsolidationState {
  timestamp: string;              // ISO 8601 UTC - timestamp of last consolidated checkpoint (cursor for next batch)
  checkpointsConsolidated: number; // Running total across all consolidations
}

export interface MemoryData {
  decisions?: string[];
  open_questions?: string[];
  deferred_work?: string[];
  gotchas?: string[];
}

export interface MemorySection {
  slug: string;      // e.g., "decisions" (the YAML key)
  header: string;    // e.g., "Decisions" (display name)
  content: string;   // Joined entries as text for search
}

export interface ScoredCheckpoint {
  checkpoint: Checkpoint
  score: number
}

export interface ConsolidationPayload {
  status: 'ready' | 'current';
  message?: string;                    // Only when status === 'current'
  memoryPath?: string;                 // Absolute path to .memories/memory.yaml
  lastConsolidatedPath?: string;       // Absolute path to ~/.goldfish/consolidation-state/{workspace}.json
  activePlanPath?: string;             // Absolute path to active plan file, if one exists
  checkpointCount?: number;            // Number of checkpoints in this batch
  remainingCount?: number;             // Unconsolidated checkpoints beyond this batch
  previousTotal?: number;              // Running total for incrementing checkpointsConsolidated
  skippedOldCount?: number;            // Checkpoints older than age limit that were excluded
  prompt?: string;                     // Subagent instructions (checkpoint file paths embedded)
}
