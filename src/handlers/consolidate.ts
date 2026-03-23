/**
 * Consolidate tool handler
 *
 * Returns metadata (file paths, counts, prompt) for a consolidation subagent.
 * No checkpoint content passes through the MCP response.
 */

import { readConsolidationState } from '../memory.js';
import { getAllCheckpoints } from '../checkpoints.js';
import { getActivePlan } from '../plans.js';
import { buildConsolidationPrompt } from '../consolidation-prompt.js';
import { getMemoriesDir, getPlansDir, resolveWorkspace } from '../workspace.js';
import { join } from 'path';
import type { ConsolidationPayload } from '../types.js';

const CONSOLIDATION_BATCH_CAP = 50;

/**
 * Handle the consolidate tool call.
 * Returns a metadata-only JSON payload (file paths + prompt) that a subagent
 * uses to read checkpoint files from disk and update MEMORY.md.
 */
export async function handleConsolidate(args: any) {
  const workspace = resolveWorkspace(args?.workspace);

  const [consolidationState, activePlan, allCheckpoints] = await Promise.all([
    readConsolidationState(workspace),
    getActivePlan(workspace),
    getAllCheckpoints(workspace)
  ]);

  // Filter to unconsolidated checkpoints
  let unconsolidated;
  if (!consolidationState) {
    // First consolidation: all checkpoints are unconsolidated
    // Sort oldest-first so batching processes chronologically
    unconsolidated = [...allCheckpoints].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  } else {
    const lastTs = new Date(consolidationState.timestamp).getTime();
    const filtered = allCheckpoints.filter(
      c => new Date(c.timestamp).getTime() > lastTs
    );
    // Sort oldest-first
    unconsolidated = filtered.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  // Exclude legacy .json files (subagent only understands .md format)
  const mdOnly = unconsolidated.filter(c => c.filePath?.endsWith('.md'));

  // Nothing to consolidate
  if (mdOnly.length === 0) {
    const payload: ConsolidationPayload = {
      status: 'current',
      message: 'Memory is up to date. No unconsolidated checkpoints.'
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
    };
  }

  // Batch: take first CONSOLIDATION_BATCH_CAP (oldest-first)
  const batch = mdOnly.slice(0, CONSOLIDATION_BATCH_CAP);
  const remainingCount = mdOnly.length - batch.length;
  const checkpointFiles = batch.map(c => c.filePath!);

  // Build paths
  const memoriesDir = getMemoriesDir(workspace);
  const memoryPath = join(memoriesDir, 'MEMORY.md');
  const lastConsolidatedPath = join(memoriesDir, '.last-consolidated');

  // Active plan path (if valid active plan exists)
  const activePlanPath = activePlan
    ? join(getPlansDir(workspace), `${activePlan.id}.md`)
    : undefined;

  const previousTotal = consolidationState?.checkpointsConsolidated ?? 0;
  const checkpointCount = batch.length;

  const prompt = buildConsolidationPrompt(
    memoryPath,
    lastConsolidatedPath,
    checkpointFiles,
    activePlanPath,
    checkpointCount,
    previousTotal
  );

  const payload: ConsolidationPayload = {
    status: 'ready',
    checkpointFiles,
    memoryPath,
    lastConsolidatedPath,
    activePlanPath,
    checkpointCount,
    remainingCount,
    previousTotal,
    prompt
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}
