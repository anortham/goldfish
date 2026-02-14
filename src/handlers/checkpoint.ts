/**
 * Checkpoint tool handler
 */

import { saveCheckpoint } from '../checkpoints.js';
import { getCurrentWorkspace } from '../workspace.js';
import { getFishEmoji } from '../emoji.js';

/**
 * Handle checkpoint tool calls
 */
export async function handleCheckpoint(args: any) {
  const { description, tags, workspace } = args;

  if (!description) {
    throw new Error('Description is required');
  }

  const ws = workspace || getCurrentWorkspace();
  const checkpoint = await saveCheckpoint({
    description,
    tags,
    workspace: ws
  });

  // Return structured JSON for AI agent consumption with human-friendly summary
  // Cap files list to keep response compact (token efficiency)
  const MAX_FILES = 10;
  const files = checkpoint.files;
  const filesSummary = files
    ? files.length > MAX_FILES
      ? { files: files.slice(0, MAX_FILES), fileCount: files.length }
      : { files }
    : {};

  const response = {
    summary: `${getFishEmoji()} Checkpoint saved: ${description}`,
    success: true,
    checkpoint: {
      description: checkpoint.description,
      timestamp: checkpoint.timestamp,
      tags: checkpoint.tags || [],
      workspace: ws,
      ...(checkpoint.gitBranch && { gitBranch: checkpoint.gitBranch }),
      ...(checkpoint.gitCommit && { gitCommit: checkpoint.gitCommit }),
      ...filesSummary
    }
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response)
      }
    ]
  };
}