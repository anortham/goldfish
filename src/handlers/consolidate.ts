/**
 * Consolidate tool handler
 *
 * Gathers MEMORY.md + unconsolidated checkpoints into a payload
 * for a consolidation subagent.
 */

import { join } from 'path';
import { readMemory, readConsolidationState } from '../memory.js';
import { getAllCheckpoints } from '../checkpoints.js';
import { getActivePlan } from '../plans.js';
import { buildConsolidationPrompt } from '../consolidation-prompt.js';
import { resolveWorkspace } from '../workspace.js';
import type { Checkpoint, ConsolidationPayload } from '../types.js';

const FIRST_CONSOLIDATION_CAP = 50;

/**
 * Handle the consolidate tool call.
 * Returns a JSON payload (as MCP text content) that a subagent can use
 * to update MEMORY.md.
 */
export async function handleConsolidate(args: any) {
  const workspace = resolveWorkspace(args?.workspace);

  // Load current memory, consolidation state, and active plan in parallel
  const [currentMemoryRaw, consolidationState, activePlan, allCheckpoints] = await Promise.all([
    readMemory(workspace),
    readConsolidationState(workspace),
    getActivePlan(workspace),
    getAllCheckpoints(workspace)
  ]);

  const currentMemory = currentMemoryRaw ?? '';

  // Filter to unconsolidated checkpoints (those after the last consolidation timestamp)
  let unconsolidated: Checkpoint[];
  if (!consolidationState) {
    // First consolidation: cap to most recent FIRST_CONSOLIDATION_CAP, in chronological order
    const recent = allCheckpoints.slice(0, FIRST_CONSOLIDATION_CAP);
    // allCheckpoints is newest-first; reverse to get chronological
    unconsolidated = recent.reverse();
  } else {
    const lastTs = new Date(consolidationState.timestamp).getTime();
    // allCheckpoints is newest-first; filter then reverse to chronological
    const filtered = allCheckpoints.filter(
      c => new Date(c.timestamp).getTime() > lastTs
    );
    unconsolidated = filtered.reverse();
  }

  // Nothing to consolidate
  if (unconsolidated.length === 0) {
    const payload: ConsolidationPayload = {
      status: 'current',
      message: 'Memory is up to date. No unconsolidated checkpoints.'
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
    };
  }

  // Build paths for the subagent to write to
  const memoriesDir = join(workspace, '.memories');
  const memoryPath = join(memoriesDir, 'MEMORY.md');
  const lastConsolidatedPath = join(memoriesDir, '.last-consolidated');

  const previousTotal = consolidationState?.checkpointsConsolidated ?? 0;
  const checkpointCount = unconsolidated.length;

  const prompt = buildConsolidationPrompt(
    memoryPath,
    lastConsolidatedPath,
    checkpointCount,
    previousTotal
  );

  const payload: ConsolidationPayload = {
    status: 'ready',
    currentMemory,
    unconsolidatedCheckpoints: unconsolidated,
    activePlan: activePlan?.content ?? undefined,
    checkpointCount,
    lastConsolidated: consolidationState ?? undefined,
    prompt
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}
