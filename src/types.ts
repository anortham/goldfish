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
  briefId?: string;       // ID of active brief when checkpoint was created
  // Read-side legacy: existing checkpoint markdown in .memories/<date>/*.md may
  // still carry a `planId:` frontmatter field from before the rename. The
  // checkpoint parser populates this field so older files keep parsing without
  // error. New writes only emit `briefId` — see src/checkpoints.ts.
  planId?: string;
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

export interface Brief {
  id: string;
  title: string;
  content: string;        // Markdown body (without frontmatter)
  status: 'active' | 'completed' | 'archived';
  created: string;        // ISO 8601 UTC
  updated: string;        // ISO 8601 UTC
  tags: string[];
}

export interface BriefInput {
  id?: string;            // Auto-generated if not provided
  title: string;
  content: string;
  workspace?: string;
  activate?: boolean;     // Make this the active brief
  status?: 'active' | 'completed' | 'archived';
  tags?: string[];
}

export interface BriefUpdate {
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
  search?: string;        // Search query over checkpoint fields
  limit?: number;         // Max checkpoints to return (default: 5)
  full?: boolean;         // Return full descriptions + all metadata (default: false)
  briefId?: string;       // Filter to checkpoints associated with this brief
  type?: string;          // Filter to a single checkpoint type (untyped == 'checkpoint')
  tags?: string[];        // Filter to checkpoints containing ALL of these tags (case-insensitive)
  _registryDir?: string;  // Internal: override registry dir for test isolation
}

/**
 * Wire-level recall input. Identical to RecallOptions except `tags` may arrive
 * as a comma-separated string from non-Claude MCP clients; recall() normalizes
 * it to a `string[]` before any internal use.
 */
export interface RecallInput extends Omit<RecallOptions, 'tags'> {
  tags?: string[] | string;
}

/**
 * Notice surfaced in place of a stale active brief. Recall suppresses the brief
 * body when its newest activity is older than the staleness threshold and emits
 * this instead, nudging the user to complete or archive it. Non-destructive:
 * the brief's status on disk is never changed.
 */
export interface StaleBriefNotice {
  id: string;
  title: string;
  lastActivity: string;     // ISO 8601 UTC — newest referencing checkpoint, or brief.created
  daysSinceActivity: number;
}

export interface RecallResult {
  checkpoints: Checkpoint[];
  activeBrief?: Brief | null;
  staleBrief?: StaleBriefNotice | null;
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

export interface RegisteredProject {
  path: string;       // Absolute path to project root
  name: string;       // Normalized workspace name (via normalizeWorkspace)
  registered: string; // ISO 8601 UTC
}

export interface Registry {
  projects: RegisteredProject[];
}

export interface ScoredCheckpoint {
  checkpoint: Checkpoint
  score: number
}

/** MCP tool argument types for compile-time safety */

export interface CheckpointArgs {
  description: string;
  tags?: string[] | string;
  type?: 'checkpoint' | 'decision' | 'incident' | 'learning';
  context?: string;
  decision?: string;
  alternatives?: string[] | string;
  impact?: string;
  evidence?: string[] | string;
  symbols?: string[] | string;
  next?: string;
  confidence?: number | string;
  unknowns?: string[] | string;
  workspace?: string;
}

export interface RecallArgs {
  workspace?: string;
  limit?: number;
  days?: number;
  from?: string;
  to?: string;
  since?: string;
  search?: string;
  full?: boolean;
  briefId?: string;
  brief_id?: string;
  type?: string;
  tags?: string[] | string;
  _registryDir?: string;
}

export interface BriefArgs {
  action: string;
  id?: string;
  briefId?: string;
  brief_id?: string;
  title?: string;
  content?: string;
  workspace?: string;
  tags?: string[];
  activate?: boolean;
  status?: string;
  updates?: BriefUpdate;
}
