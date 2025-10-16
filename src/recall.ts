/**
 * Recall and search functionality
 *
 * Aggregates checkpoints across date ranges and workspaces,
 * with fuzzy search powered by fuse.js
 */

import Fuse from 'fuse.js';
import type { Checkpoint, RecallOptions, RecallResult, WorkspaceSummary } from './types';
import { getCheckpointsForDateRange } from './checkpoints';
import { getActivePlan } from './plans';
import { getCurrentWorkspace, listWorkspaces } from './workspace';

/**
 * Parse human-friendly time spans or ISO timestamps
 *
 * Formats:
 * - "2h" → 2 hours ago
 * - "30m" → 30 minutes ago
 * - "3d" → 3 days ago
 * - "2025-10-14T15:30:00Z" → ISO timestamp (passthrough)
 * - "2025-10-14" → Date string (passthrough)
 */
export function parseSince(since: string): Date {
  // ISO timestamp or date string (contains 'T' or '-')
  if (since.includes('T') || since.includes('-')) {
    const date = new Date(since);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid since format: ${since}`);
    }
    return date;
  }

  // Human-friendly: "2h", "30m", "3d"
  const match = since.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`Invalid since format: ${since} (expected: "2h", "30m", "3d", or ISO timestamp)`);
  }

  const [, amount, unit] = match;
  const now = new Date();
  const milliseconds = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const unitValue = unit as 'm' | 'h' | 'd';
  return new Date(now.getTime() - parseInt(amount!) * milliseconds[unitValue]);
}

/**
 * Search checkpoints using fuzzy matching (fuse.js)
 */
export function searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[] {
  if (!query || checkpoints.length === 0) {
    return checkpoints;
  }

  const fuse = new Fuse(checkpoints, {
    keys: [
      { name: 'description', weight: 2 },  // Description is most important
      { name: 'tags', weight: 1 },
      { name: 'gitBranch', weight: 0.5 },
      { name: 'files', weight: 0.3 }
    ],
    threshold: 0.4,  // 0 = perfect match, 1 = match anything
    includeScore: true,
    ignoreLocation: true,  // Search anywhere in the text
    minMatchCharLength: 2
  });

  const results = fuse.search(query);

  // Return just the items (sorted by relevance via fuse.js score)
  return results.map(result => result.item);
}

/**
 * Calculate date range from recall options
 *
 * Priority:
 * 1. from + to (explicit range)
 * 2. since (human-friendly or ISO)
 * 3. from alone (from that point to now)
 * 4. to alone (7 days before to that point)
 * 5. days (last N days, default: 2)
 */
function getDateRange(options: RecallOptions): { from: string; to: string } {
  const now = new Date();

  // 1. Explicit from/to range
  if (options.from && options.to) {
    return { from: options.from, to: options.to };
  }

  // 2. 'since' parameter (takes priority over 'days')
  if (options.since) {
    const fromDate = parseSince(options.since);
    return {
      from: fromDate.toISOString(),
      to: now.toISOString()
    };
  }

  // 3. Only 'from' provided (from that point to now)
  if (options.from) {
    return { from: options.from, to: now.toISOString() };
  }

  // 4. Only 'to' provided (7 days before to that point)
  if (options.to) {
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    return { from: weekAgo.toISOString(), to: options.to };
  }

  // 5. Default: use 'days' parameter (default: 2 days)
  const days = options.days || 2;
  const fromDate = new Date(now.getTime() - days * 86400000);

  return {
    from: fromDate.toISOString(),
    to: now.toISOString()
  };
}

/**
 * Recall checkpoints from a single workspace
 */
async function recallFromWorkspace(
  workspace: string,
  options: RecallOptions
): Promise<{ checkpoints: Checkpoint[]; activePlan: any }> {
  const { from, to } = getDateRange(options);

  // Get checkpoints in date range
  let checkpoints = await getCheckpointsForDateRange(workspace, from, to);

  // Apply search filter if provided
  if (options.search) {
    checkpoints = searchCheckpoints(options.search, checkpoints);
  }

  // Apply summary filtering (default: return summaries, not full descriptions)
  // BUT: Always return full descriptions for search results (so users see why it matched)
  if (!options.full && !options.search) {
    checkpoints = checkpoints.map(checkpoint => {
      if (checkpoint.summary) {
        // Return checkpoint with summary as description
        return {
          ...checkpoint,
          description: checkpoint.summary
        };
      }
      return checkpoint;
    });
  }

  // Apply limit (default: 10, most recent first)
  // Sort by timestamp descending (newest first), then limit
  checkpoints = checkpoints.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const limit = options.limit !== undefined ? options.limit : 10;
  if (limit > 0) {
    checkpoints = checkpoints.slice(0, limit);
  } else if (limit === 0) {
    checkpoints = [];  // Return empty array (plan only)
  }

  // Strip metadata fields based on full flag
  checkpoints = checkpoints.map(checkpoint => {
    const { summary, charCount, ...cleanCheckpoint } = checkpoint;

    // Strip verbose metadata unless full: true
    if (!options.full) {
      const { files, gitBranch, gitCommit, ...minimal } = cleanCheckpoint;
      return minimal;
    }

    return cleanCheckpoint;
  });

  // Get active plan
  const activePlan = await getActivePlan(workspace);

  return { checkpoints, activePlan };
}

/**
 * Get workspace summary (for cross-workspace recall)
 */
async function getWorkspaceSummary(
  workspace: string,
  checkpoints: Checkpoint[]
): Promise<WorkspaceSummary> {
  // Get latest checkpoint timestamp
  const sortedCheckpoints = checkpoints
    .filter(c => c.timestamp)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const lastActivity = sortedCheckpoints[0]?.timestamp;

  const summary: WorkspaceSummary = {
    name: workspace,
    path: workspace,  // In this simple version, name = path
    checkpointCount: checkpoints.length
  };
  if (lastActivity) summary.lastActivity = lastActivity;

  return summary;
}

/**
 * Recall checkpoints (main entry point)
 *
 * Retrieves checkpoints from specified workspace(s) with optional search
 */
export async function recall(options: RecallOptions = {}): Promise<RecallResult> {
  const workspace = options.workspace || 'current';

  // Single workspace recall
  if (workspace !== 'all') {
    const targetWorkspace = workspace === 'current'
      ? getCurrentWorkspace()
      : workspace;

    const { checkpoints, activePlan } = await recallFromWorkspace(targetWorkspace, options);

    return {
      checkpoints,
      activePlan
    };
  }

  // Cross-workspace recall (workspace === 'all')
  const workspaceNames = await listWorkspaces();

  // Fetch from all workspaces in parallel for better performance
  // For cross-workspace, collect ALL checkpoints (we'll apply global limit at the end)
  const workspaceResults = await Promise.all(
    workspaceNames.map(async (ws) => {
      const { checkpoints } = await recallFromWorkspace(ws, { ...options, limit: 99999 });
      return { ws, checkpoints };
    })
  );

  // Build combined results
  const allCheckpoints: Checkpoint[] = [];
  const workspaceSummaries: WorkspaceSummary[] = [];

  for (const { ws, checkpoints } of workspaceResults) {
    if (checkpoints.length > 0) {
      allCheckpoints.push(...checkpoints);

      const summary = await getWorkspaceSummary(ws, checkpoints);
      workspaceSummaries.push(summary);
    }
  }

  // Sort combined checkpoints by timestamp (newest first)
  allCheckpoints.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply limit to combined results (cross-workspace needs global limit, not per-workspace)
  const limit = options.limit !== undefined ? options.limit : 10;
  let limitedCheckpoints: Checkpoint[];
  if (limit > 0) {
    limitedCheckpoints = allCheckpoints.slice(0, limit);
  } else if (limit === 0) {
    limitedCheckpoints = [];
  } else {
    limitedCheckpoints = allCheckpoints;
  }

  // For cross-workspace, no single "active plan"
  return {
    checkpoints: limitedCheckpoints,
    workspaces: workspaceSummaries
  };
}
