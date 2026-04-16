/**
 * Checkpoint tool handler
 */

import { saveCheckpoint } from '../checkpoints.js';
import { getFishEmoji } from '../emoji.js';
import type { CheckpointArgs, CheckpointInput } from '../types.js';
import { resolveWorkspace } from '../workspace.js';

/**
 * Coerce a value that may be a JSON string into an array.
 * MCP tool args can arrive as JSON strings instead of parsed arrays.
 */
function coerceArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON, ignore */ }
  }
  return undefined;
}

/**
 * Handle checkpoint tool calls
 */
export async function handleCheckpoint(args: CheckpointArgs) {
  const {
    description,
    workspace,
    type,
    context,
    decision,
    impact,
    next,
    confidence
  } = args;

  // Coerce array params that may arrive as JSON strings from MCP
  const tags = coerceArray(args.tags);
  const alternatives = coerceArray(args.alternatives);
  const evidence = coerceArray(args.evidence);
  const symbols = coerceArray(args.symbols);
  const unknowns = coerceArray(args.unknowns);

  if (!description) {
    throw new Error('Description is required');
  }

  const ws = resolveWorkspace(workspace);

  if (confidence !== undefined) {
    const parsed = Number(confidence);
    if (!Number.isFinite(parsed) || Math.round(parsed) < 1 || Math.round(parsed) > 5) {
      throw new Error('confidence must be a number between 1 and 5');
    }
  }

  const checkpointInput: CheckpointInput = {
    description,
    ...(tags ? { tags } : {}),
    ...(type ? { type } : {}),
    ...(context ? { context } : {}),
    ...(decision ? { decision } : {}),
    ...(alternatives ? { alternatives } : {}),
    ...(impact ? { impact } : {}),
    ...(evidence ? { evidence } : {}),
    ...(symbols ? { symbols } : {}),
    ...(next ? { next } : {}),
    ...(confidence !== undefined ? { confidence: Number(confidence) } : {}),
    ...(unknowns ? { unknowns } : {}),
    workspace: ws
  };

  const checkpoint = await saveCheckpoint(checkpointInput);

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

  const briefId = checkpoint.briefId ?? checkpoint.planId;
  if (briefId) {
    lines.push(`Brief: ${briefId}`);
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
