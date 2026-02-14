/**
 * Checkpoint tool handler
 */

import { saveCheckpoint } from '../checkpoints.js';
import { getFishEmoji } from '../emoji.js';

/**
 * Handle checkpoint tool calls
 */
export async function handleCheckpoint(args: any) {
  const { description, tags, workspace } = args;

  if (!description) {
    throw new Error('Description is required');
  }

  const ws = workspace || process.cwd();
  const checkpoint = await saveCheckpoint({
    description,
    tags,
    workspace: ws
  });

  // Return structured JSON for AI agent consumption with human-friendly summary
  // Build git context for response, capping files for token efficiency
  const MAX_FILES = 10;
  const git = checkpoint.git;
  const gitResponse = git ? {
    git: {
      ...(git.branch && { branch: git.branch }),
      ...(git.commit && { commit: git.commit }),
      ...(git.files && git.files.length > MAX_FILES
        ? { files: git.files.slice(0, MAX_FILES), fileCount: git.files.length }
        : git.files && { files: git.files })
    }
  } : {};

  const response = {
    summary: `${getFishEmoji()} Checkpoint saved: ${description}`,
    success: true,
    checkpoint: {
      id: checkpoint.id,
      description: checkpoint.description,
      timestamp: checkpoint.timestamp,
      tags: checkpoint.tags || [],
      workspace: ws,
      ...gitResponse
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