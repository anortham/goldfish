/**
 * Core types for Goldfish memory system
 */

export interface Checkpoint {
  id: string;             // checkpoint_{hash} unique identifier
  timestamp: string;      // ISO 8601 UTC
  description: string;    // Markdown body
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
  _registryDir?: string;  // Internal: override registry dir for test isolation
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan | null;
  workspaces?: WorkspaceSummary[];  // When workspace='all'
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

export interface RegisteredProject {
  path: string;       // Absolute path to project root
  name: string;       // Normalized workspace name (via normalizeWorkspace)
  registered: string; // ISO 8601 UTC
}

export interface Registry {
  projects: RegisteredProject[];
}
