/**
 * Recall tool handler
 */

import { stat } from 'fs/promises';
import { recall as recallFunc } from '../recall.js';
import { getMemoriesDir, resolveWorkspace } from '../workspace.js';
import { getFishEmoji } from '../emoji.js';
import type { Checkpoint, Plan } from '../types.js';

/**
 * Safely convert a value to an array for display.
 * Stored data may have arrays serialized as JSON strings.
 */
function safeArray(value: unknown): string[] | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON */ }
    return [value]; // single string tag
  }
  return undefined;
}

/**
 * Resolve the effective workspace path, handling the 'all' special case
 */
function resolveWorkspacePath(workspace?: string): string {
  if (workspace === 'all') return '(cross-project)';
  return resolveWorkspace(workspace);
}

/**
 * Format a single checkpoint as a markdown section
 */
function formatCheckpoint(checkpoint: Checkpoint & { workspace?: string }): string {
  const lines: string[] = [];

  // H3 header: ### 2026-02-16 15:30 checkpoint_abc12345
  const ts = checkpoint.timestamp;
  const dateTime = ts.replace('T', ' ').replace(/:\d{2}(\.\d+)?Z$/, '');
  lines.push(`### ${dateTime} ${checkpoint.id}`);

  const tags = safeArray(checkpoint.tags);
  if (tags && tags.length > 0) {
    lines.push(`Tags: ${tags.join(', ')}`);
  }

  if (checkpoint.planId) {
    lines.push(`Plan: ${checkpoint.planId}`);
  }

  if (checkpoint.type) {
    lines.push(`Type: ${checkpoint.type}`);
  }

  if (checkpoint.context) {
    lines.push(`Context: ${checkpoint.context}`);
  }

  if (checkpoint.decision) {
    lines.push(`Decision: ${checkpoint.decision}`);
  }

  if (checkpoint.impact) {
    lines.push(`Impact: ${checkpoint.impact}`);
  }

  const symbols = safeArray(checkpoint.symbols);
  if (symbols && symbols.length > 0) {
    lines.push(`Symbols: ${symbols.join(', ')}`);
  }

  if (checkpoint.next) {
    lines.push(`Next: ${checkpoint.next}`);
  }

  if (typeof checkpoint.confidence === 'number') {
    lines.push(`Confidence: ${checkpoint.confidence}/5`);
  }

  if (checkpoint.workspace) {
    lines.push(`Workspace: ${checkpoint.workspace}`);
  }

  if (checkpoint.git) {
    const gitParts: string[] = [];
    if (checkpoint.git.branch) gitParts.push(`branch: ${checkpoint.git.branch}`);
    if (checkpoint.git.commit) gitParts.push(`commit: ${checkpoint.git.commit}`);
    if (gitParts.length > 0) lines.push(`Git: ${gitParts.join(', ')}`);
    const files = safeArray(checkpoint.git.files);
    if (files && files.length > 0) {
      lines.push(`Files: ${files.join(', ')}`);
    }
  }

  lines.push(checkpoint.description);

  return lines.join('\n');
}

/**
 * Format active plan as a markdown section
 */
function formatActivePlan(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`## Active Plan: ${plan.title} (${plan.status})`);
  lines.push(`Updated: ${plan.updated}`);
  const planTags = safeArray(plan.tags);
  if (planTags && planTags.length > 0) {
    lines.push(`Tags: ${planTags.join(', ')}`);
  }
  lines.push('');
  lines.push(plan.content);
  return lines.join('\n');
}

/**
 * Handle recall tool calls
 */
export async function handleRecall(args: any) {
  const result = await recallFunc(args);

  // Capture diagnostic info
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

  // Build readable markdown response
  const count = result.checkpoints.length;
  const planText = result.activePlan ? ' + active plan' : '';
  const fish = getFishEmoji();

  const lines: string[] = [];

  // Header line
  if (count === 0) {
    lines.push(`${fish} No checkpoints found${planText}`);
  } else {
    lines.push(`${fish} Recalled ${count} checkpoint${count === 1 ? '' : 's'}${planText}`);
  }

  // Diagnostics
  lines.push(`Workspace: ${resolvedPath}`);
  if (memoriesDir) {
    lines.push(`Memories: ${memoriesDir} (${memoriesExists ? 'found' : 'not found'})`);
  }

  // Active plan section
  if (result.activePlan) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(formatActivePlan(result.activePlan));
  }

  // Workspace summaries for cross-project recall
  if (result.workspaces && result.workspaces.length > 0) {
    lines.push('');
    lines.push('## Workspaces');
    for (const ws of result.workspaces) {
      lines.push(`- **${ws.name}** (${ws.path}): ${ws.checkpointCount} checkpoints${ws.lastActivity ? `, last: ${ws.lastActivity}` : ''}`);
    }
  }

  // Checkpoints section
  if (count > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Checkpoints');
    lines.push('');

    for (const checkpoint of result.checkpoints) {
      lines.push(formatCheckpoint(checkpoint));
      lines.push('');
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n').trimEnd()
      }
    ]
  };
}
