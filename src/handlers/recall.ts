/**
 * Recall tool handler
 */

import { recall as recallFunc } from '../recall.js';
import { getFishEmoji } from '../emoji.js';

/**
 * Handle recall tool calls
 */
export async function handleRecall(args: any) {
  const result = await recallFunc(args);

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

  if (result.searchMethod) {
    response.searchMethod = result.searchMethod;
  }

  if (result.searchResults) {
    response.searchResults = result.searchResults;
  }

  if (result.distilled) {
    response.distilled = result.distilled;
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