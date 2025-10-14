/**
 * Core types for Goldfish memory system
 */

export interface Checkpoint {
  timestamp: string;      // ISO 8601 UTC
  description: string;
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
  search?: string;        // Fuzzy search query
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activePlan?: Plan;
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
