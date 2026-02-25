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
  const {
    description,
    tags,
    workspace,
    type,
    context,
    decision,
    alternatives,
    impact,
    evidence,
    symbols,
    next,
    confidence,
    unknowns
  } = args;

  if (!description) {
    throw new Error('Description is required');
  }

  const ws = resolveWorkspace(workspace);

  if (confidence !== undefined) {
    const parsed = Number(confidence);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new Error('confidence must be an integer between 1 and 5');
    }
  }

  const checkpoint = await saveCheckpoint({
    description,
    tags,
    type,
    context,
    decision,
    alternatives,
    impact,
    evidence,
    symbols,
    next,
    confidence,
    unknowns,
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

  // Quality nudges based on checkpoint type
  const nudges: string[] = [];
  if (type === 'decision') {
    const missing: string[] = [];
    if (!decision) missing.push('decision');
    if (!alternatives || alternatives.length === 0) missing.push('alternatives');
    if (missing.length > 0) {
      nudges.push(`💡 Decision checkpoint — consider adding: ${missing.join(', ')}`);
    }
  } else if (type === 'incident') {
    const missing: string[] = [];
    if (!context) missing.push('context');
    if (!evidence || evidence.length === 0) missing.push('evidence');
    if (missing.length > 0) {
      nudges.push(`💡 Incident checkpoint — consider adding: ${missing.join(', ')}`);
    }
  } else if (type === 'learning') {
    if (!impact) {
      nudges.push(`💡 Learning checkpoint — consider adding: impact`);
    }
  }

  if (nudges.length > 0) {
    lines.push('');
    lines.push(...nudges);
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
