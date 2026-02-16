/**
 * Recall tool handler
 */

import { stat } from 'fs/promises';
import { recall as recallFunc } from '../recall.js';
import { getMemoriesDir } from '../workspace.js';
import { getFishEmoji } from '../emoji.js';

/**
 * Resolve the effective workspace path (same logic as recall.ts)
 */
function resolveWorkspacePath(workspace?: string): string {
  if (!workspace || workspace === 'current') return process.cwd();
  if (workspace === 'all') return '(cross-project)';
  return workspace;
}

/**
 * Handle recall tool calls
 */
export async function handleRecall(args: any) {
  const result = await recallFunc(args);

  // Capture diagnostic info for debugging
  const resolvedPath = resolveWorkspacePath(args.workspace);
  const memoriesDir = resolvedPath !== '(cross-project)' ? getMemoriesDir(resolvedPath) : null;
  let memoriesExists = false;
  if (memoriesDir) {
    try {
      const stats = await stat(memoriesDir);
      memoriesExists = stats.isDirectory();
    } catch {
      // doesn't exist
    }
  }

  // Build human-friendly summary
  const count = result.checkpoints.length;
  const planText = result.activePlan ? ' + active plan' : '';
  const fish = getFishEmoji();
  const summary = count === 0
    ? `${fish} No checkpoints found`
    : `${fish} Recalled ${count} checkpoint${count === 1 ? '' : 's'}${planText}`;

  // Return structured JSON for AI agent consumption with human-friendly summary
  const response: any = {
    summary,
    checkpoints: result.checkpoints,
    query: {
      workspace: args.workspace || 'current',
      resolvedPath,
      memoriesDir,
      memoriesExists,
      ...(args.days !== undefined && { days: args.days }),
      ...(args.since && { since: args.since }),
      ...(args.from && { from: args.from }),
      ...(args.to && { to: args.to }),
      ...(args.search && { search: args.search })
    }
  };

  if (result.activePlan) {
    response.activePlan = result.activePlan;
  }

  if (result.workspaces && result.workspaces.length > 0) {
    response.workspaces = result.workspaces;
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response)
      }
    ]
  };
}
