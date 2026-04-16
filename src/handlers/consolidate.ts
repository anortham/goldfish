/**
 * Consolidate tool handler
 *
 * Returns metadata (file paths, counts, prompt) for a consolidation subagent.
 * No checkpoint content passes through the MCP response.
 */

import { readConsolidationState } from '../memory.js';
import { getAllCheckpoints, CONSOLIDATION_AGE_LIMIT_DAYS } from '../checkpoints.js';
import { getActiveBrief } from '../plans.js';
import { buildConsolidationPrompt } from '../consolidation-prompt.js';
import { getMemoriesDir, getBriefsDir, getPlansDir, getConsolidationStatePath, getConsolidationStateDir, resolveWorkspace } from '../workspace.js';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import type { ConsolidateArgs, ConsolidationPayload } from '../types.js';

const CONSOLIDATION_BATCH_CAP = 50;
const CONSOLIDATION_ALL_CAP = 100;

async function resolveActiveBriefPath(workspace: string, briefId: string): Promise<string> {
  const candidatePaths = [
    join(getBriefsDir(workspace), `${briefId}.md`),
    join(getPlansDir(workspace), `${briefId}.md`)
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const candidateStats = await stat(candidatePath);
      if (candidateStats.isFile()) {
        return candidatePath;
      }
    } catch {
      // Try the next compatibility path.
    }
  }

  return candidatePaths[0]!;
}

/**
 * Handle the consolidate tool call.
 * Returns a metadata-only JSON payload (file paths + prompt) that a subagent
 * uses to read checkpoint files from disk and update memory.yaml.
 */
export async function handleConsolidate(args: ConsolidateArgs) {
  const workspace = resolveWorkspace(args?.workspace);

  const [consolidationState, activeBrief, allCheckpoints] = await Promise.all([
    readConsolidationState(workspace),
    getActiveBrief(workspace),
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

  // Filter to checkpoints within the age window
  const ageLimit = Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
  const recent = unconsolidated.filter(
    c => new Date(c.timestamp).getTime() >= ageLimit
  );
  const skippedOldCount = unconsolidated.length - recent.length;

  // Exclude legacy .json files (subagent only understands .md format)
  const mdOnly = recent.filter(c => c.filePath?.endsWith('.md'));

  // Nothing to consolidate
  if (mdOnly.length === 0) {
    const payload: ConsolidationPayload = {
      status: 'current',
      message: skippedOldCount > 0
        ? `${skippedOldCount} checkpoint(s) older than 30 days were skipped. No recent unconsolidated checkpoints.`
        : 'Memory is up to date. No unconsolidated checkpoints.',
      ...(skippedOldCount > 0 && { skippedOldCount })
    };
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }]
    };
  }

  // Batch: cap at 100 with all flag, 50 without (prevents MCP response overflow)
  const batchCap = args?.all ? CONSOLIDATION_ALL_CAP : CONSOLIDATION_BATCH_CAP;
  const batch = mdOnly.slice(0, batchCap);
  const remainingCount = mdOnly.length - batch.length;
  const checkpointFiles = batch.map(c => c.filePath!);

  // Ensure the consolidation-state directory exists so the subagent can write its state file
  await mkdir(getConsolidationStateDir(), { recursive: true });

  // Build paths
  const memoriesDir = getMemoriesDir(workspace);
  const memoryPath = join(memoriesDir, 'memory.yaml');
  const lastConsolidatedPath = getConsolidationStatePath(workspace);

  // Active brief path (if valid active brief exists)
  const activeBriefPath = activeBrief
    ? await resolveActiveBriefPath(workspace, activeBrief.id)
    : undefined;

  const previousTotal = consolidationState?.checkpointsConsolidated ?? 0;
  const checkpointCount = batch.length;
  const lastBatchTimestamp = batch[batch.length - 1].timestamp;

  const prompt = buildConsolidationPrompt(
    memoryPath,
    lastConsolidatedPath,
    checkpointFiles,
    activeBriefPath,
    checkpointCount,
    previousTotal,
    lastBatchTimestamp
  );

  const payload: ConsolidationPayload = {
    status: 'ready',
    memoryPath,
    lastConsolidatedPath,
    activeBriefPath,
    activePlanPath: activeBriefPath,
    checkpointCount,
    remainingCount,
    previousTotal,
    ...(skippedOldCount > 0 && { skippedOldCount }),
    prompt
  };

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }]
  };
}
