/**
 * Checkpoint tool handler
 */

import { saveCheckpoint } from '../checkpoints.js';
import { getFishEmoji } from '../emoji.js';
import { resolveWorkspace } from '../workspace.js';

/**
 * Handle checkpoint tool calls
 */
export async function handleCheckpoint(args: any) {
  const { description, tags, workspace } = args;

  if (!description) {
    throw new Error('Description is required');
  }

  const ws = resolveWorkspace(workspace);
  const checkpoint = await saveCheckpoint({
    description,
    tags,
    workspace: ws
  });

  // Build readable markdown response
  const MAX_FILES = 10;
  const git = checkpoint.git;
  const lines: string[] = [];

  lines.push(`${getFishEmoji()} Checkpoint saved: ${checkpoint.id}`);
  lines.push(`Time: ${checkpoint.timestamp}`);

  if (git?.branch || git?.commit) {
    const branch = git.branch || '?';
    const commit = git.commit || '?';
    lines.push(`Branch: ${branch} @ ${commit}`);
  }

  if (tags && tags.length > 0) {
    lines.push(`Tags: ${tags.join(', ')}`);
  }

  if (checkpoint.planId) {
    lines.push(`Plan: ${checkpoint.planId}`);
  }

  if (git?.files && git.files.length > 0) {
    const displayFiles = git.files.slice(0, MAX_FILES);
    const overflow = git.files.length > MAX_FILES
      ? ` (+${git.files.length - MAX_FILES} more)`
      : '';
    lines.push(`Files: ${displayFiles.join(', ')}${overflow}`);
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n')
      }
    ]
  };
}
