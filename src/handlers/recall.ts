/**
 * Recall tool handler
 */

import { stat } from 'fs/promises';
import { recall as recallFunc } from '../recall.js';
import { getMemoriesDir, resolveWorkspace } from '../workspace.js';
import { getFishEmoji } from '../emoji.js';
import type { Brief, BriefRefreshNotice, Checkpoint, RecallArgs, StaleBriefNotice } from '../types.js';

/**
 * Char cap for the checkpoints section in full mode (~5k tokens). Full-mode
 * descriptions are uncapped per checkpoint, so a high limit could otherwise
 * put tens of thousands of tokens into one tool response.
 */
const FULL_MODE_CHAR_BUDGET = 20_000;

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

  const briefId = checkpoint.briefId ?? checkpoint.planId;
  if (briefId) {
    lines.push(`Brief: ${briefId}`);
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

  const alternatives = safeArray(checkpoint.alternatives);
  if (alternatives && alternatives.length > 0) {
    lines.push(`Alternatives: ${alternatives.join(', ')}`);
  }

  const evidence = safeArray(checkpoint.evidence);
  if (evidence && evidence.length > 0) {
    lines.push(`Evidence: ${evidence.join(', ')}`);
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

  const unknowns = safeArray(checkpoint.unknowns);
  if (unknowns && unknowns.length > 0) {
    lines.push(`Unknowns: ${unknowns.join(', ')}`);
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
 * Format active brief as a markdown section
 */
function formatActiveBrief(brief: Brief): string {
  const lines: string[] = [];
  lines.push(`## Active Brief: ${brief.title} (${brief.status})`);
  lines.push(`Updated: ${brief.updated}`);
  const briefTags = safeArray(brief.tags);
  if (briefTags && briefTags.length > 0) {
    lines.push(`Tags: ${briefTags.join(', ')}`);
  }
  lines.push('');
  lines.push(brief.content);
  return lines.join('\n');
}

function formatBriefRefreshNotice(notice: BriefRefreshNotice): string {
  return `⚠️ Active brief not updated in ${notice.daysSinceUpdated}d — still the direction? Update it to reaffirm, or complete/archive it.`;
}

/**
 * Format the one-line, action-oriented nudge shown in place of a stale brief.
 */
function formatStaleBriefNotice(notice: StaleBriefNotice): string {
  const gist = notice.snippet ? ` Gist: ${notice.snippet}` : '';
  // Beyond the scan window the exact checkpoint-activity age is unverified —
  // claim only the lower bound the scan actually proved.
  const age = notice.daysSinceActivity > notice.scanWindowDays
    ? `${notice.scanWindowDays}d+`
    : `${notice.daysSinceActivity}d`;
  return `⚠️ Active brief "${notice.title}" untouched ${age} — complete or archive it, or update it if it's still the direction.${gist}`;
}

/**
 * Handle recall tool calls
 */
export async function handleRecall(args: RecallArgs) {
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
  const activeBrief = result.activeBrief;
  const staleBrief = result.staleBrief;
  const briefText = activeBrief
    ? ' + active brief'
    : staleBrief
      ? ' + stale brief notice'
      : '';
  const fish = getFishEmoji();

  const lines: string[] = [];

  // Header line
  if (count === 0) {
    lines.push(`${fish} No checkpoints found${briefText}`);
  } else {
    lines.push(`${fish} Recalled ${count} checkpoint${count === 1 ? '' : 's'}${briefText}`);
  }

  // Diagnostics
  lines.push(`Workspace: ${resolvedPath}`);
  if (memoriesDir) {
    lines.push(`Memories: ${memoriesDir} (${memoriesExists ? 'found' : 'not found'})`);
  }

  // Active brief section (or stale-brief nudge in its place)
  if (activeBrief) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(formatActiveBrief(activeBrief));
    if (result.briefRefresh) {
      lines.push('');
      lines.push(formatBriefRefreshNotice(result.briefRefresh));
    }
  } else if (staleBrief) {
    lines.push('');
    lines.push(formatStaleBriefNotice(staleBrief));
  }

  // Workspace summaries for cross-project recall
  if (result.workspaces && result.workspaces.length > 0) {
    lines.push('');
    lines.push('## Workspaces');
    for (const ws of result.workspaces) {
      const line = `- **${ws.name}** (${ws.path}): ${ws.checkpointCount} checkpoints${ws.lastActivity ? `, last: ${ws.lastActivity}` : ''}`;
      lines.push(line);
    }
  }

  // Checkpoints section. Full mode is uncapped per checkpoint, so the section
  // gets a char budget — a single tool response must not flood the caller's
  // context window. At least one checkpoint always renders.
  if (count > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## Checkpoints');
    lines.push('');

    const fullMode = Boolean(args.full);
    let used = 0;
    let shown = 0;
    for (const checkpoint of result.checkpoints) {
      let block = formatCheckpoint(checkpoint);
      if (fullMode && shown === 0 && block.length > FULL_MODE_CHAR_BUDGET) {
        // The guaranteed first checkpoint must not bust the budget by itself
        block = `${block.slice(0, FULL_MODE_CHAR_BUDGET)}\n… (checkpoint truncated to fit the full-mode budget — read the checkpoint file for the full text)`;
      }
      if (fullMode && shown > 0 && used + block.length > FULL_MODE_CHAR_BUDGET) {
        break;
      }
      lines.push(block);
      lines.push('');
      used += block.length;
      shown += 1;
    }

    if (shown < count) {
      lines.push(`(output truncated: showing ${shown} of ${count} checkpoints — lower limit or drop full: true)`);
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
