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
 */
function getDateRange(options: RecallOptions): { from: string; to: string } {
  const now = new Date();

  // If explicit from/to provided, use those
  if (options.from && options.to) {
    return { from: options.from, to: options.to };
  }

  // If only 'from' provided, use until today
  if (options.from) {
    return { from: options.from, to: now.toISOString().split('T')[0]! };
  }

  // If only 'to' provided, use from 7 days before
  if (options.to) {
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    return { from: weekAgo.toISOString().split('T')[0]!, to: options.to };
  }

  // Default: use 'days' parameter (default: 2 days)
  const days = options.days || 2;
  const fromDate = new Date(now.getTime() - days * 86400000);

  return {
    from: fromDate.toISOString().split('T')[0]!,
    to: now.toISOString().split('T')[0]!
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

  return {
    name: workspace,
    path: workspace,  // In this simple version, name = path
    checkpointCount: checkpoints.length,
    lastActivity
  };
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
  const allCheckpoints: Checkpoint[] = [];
  const workspaceSummaries: WorkspaceSummary[] = [];

  for (const ws of workspaceNames) {
    const { checkpoints } = await recallFromWorkspace(ws, options);

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

  // For cross-workspace, no single "active plan"
  return {
    checkpoints: allCheckpoints,
    activePlan: null,
    workspaces: workspaceSummaries
  };
}
