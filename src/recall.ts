/**
 * Recall and search functionality
 *
 * Aggregates checkpoints across date ranges and workspaces,
 * with fuzzy search powered by fuse.js
 */

import { createHash } from 'crypto';
import Fuse from 'fuse.js';
import type { Checkpoint, Plan, RecallOptions, RecallResult, WorkspaceSummary } from './types';
import { getCheckpointsForDateRange, getAllCheckpoints } from './checkpoints';
import { buildCompactSearchDescription, buildRetrievalDigest, DIGEST_VERSION } from './digests';
import { getActivePlan } from './plans';
import { listRegisteredProjects } from './registry';
import { invalidateSemanticRecordsForModelVersion, listPendingSemanticRecords, loadSemanticState, markSemanticRecordReady, upsertPendingSemanticRecord } from './semantic-cache';
import { buildHybridRanking, processPendingSemanticWork, MINIMUM_SEARCH_RELEVANCE } from './semantic';
import { getDefaultSemanticRuntime } from './transformers-embedder';
import { resolveWorkspace } from './workspace';

type ReadySemanticRecord = {
  checkpointId: string;
  embedding: number[];
};

type QueryEmbeddingResult =
  | { ok: true; embedding?: number[] }
  | { ok: false; error: unknown };

const SEARCH_SEMANTIC_MODEL = {
  id: 'semantic-search-runtime',
  version: '1'
};

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function warnSemanticFailure(context: string, error: unknown): void {
  console.warn(`[goldfish] ${context}: ${describeError(error)}`);
}

/**
 * Parse human-friendly time spans or ISO timestamps
 *
 * Formats:
 * - "2h" → 2 hours ago
 * - "30m" → 30 minutes ago
 * - "3d" → 3 days ago
 * - "2025-10-14T15:30:00Z" → ISO timestamp (passthrough)
 * - "2025-10-14" → Date string (passthrough)
 */
export function parseSince(since: string): Date {
  // ISO timestamp or date string (contains 'T' or '-')
  if (since.includes('T') || since.includes('-')) {
    const date = new Date(since);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid since format: ${since}`);
    }
    return date;
  }

  // Human-friendly: "2h", "30m", "3d"
  const match = since.match(/^(\d+)([mhd])$/);
  if (!match) {
    throw new Error(`Invalid since format: ${since} (expected: "2h", "30m", "3d", or ISO timestamp)`);
  }

  const [, amount, unit] = match;
  const now = new Date();
  const milliseconds = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const unitValue = unit as 'm' | 'h' | 'd';
  return new Date(now.getTime() - parseInt(amount!) * milliseconds[unitValue]);
}

/**
 * Search checkpoints using fuzzy matching (fuse.js)
 */
export function searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[] {
  if (!query || checkpoints.length === 0) {
    return checkpoints;
  }

  const fuse = new Fuse(checkpoints, {
    keys: [
      { name: 'description', weight: 2 },  // Description is most important
      { name: 'decision', weight: 1.5 },
      { name: 'impact', weight: 1.3 },
      { name: 'context', weight: 1.1 },
      { name: 'alternatives', weight: 0.8 },
      { name: 'evidence', weight: 0.7 },
      { name: 'symbols', weight: 0.7 },
      { name: 'unknowns', weight: 0.6 },
      { name: 'next', weight: 0.5 },
      { name: 'tags', weight: 1 },
      { name: 'git.branch', weight: 0.5 },
      { name: 'git.files', weight: 0.3 }
    ],
    threshold: 0.4,  // 0 = perfect match, 1 = match anything
    includeScore: true,
    ignoreLocation: true,  // Search anywhere in the text
    minMatchCharLength: 2
  });

  const results = fuse.search(query);

  // Return just the items (sorted by relevance via fuse.js score)
  return results.map(result => result.item);
}

/**
 * Calculate date range from recall options
 *
 * Priority:
 * 1. from + to (explicit range)
 * 2. since (human-friendly or ISO)
 * 3. from alone (from that point to now)
 * 4. to alone (7 days before to that point)
 * 5. days (last N days, only when explicitly set)
 */
function getDateRange(options: RecallOptions): { from: string; to: string } {
  const now = new Date();

  // 1. Explicit from/to range
  if (options.from && options.to) {
    return { from: options.from, to: options.to };
  }

  // 2. 'since' parameter (takes priority over 'days')
  if (options.since) {
    const fromDate = parseSince(options.since);
    return {
      from: fromDate.toISOString(),
      to: now.toISOString()
    };
  }

  // 3. Only 'from' provided (from that point to now)
  if (options.from) {
    return { from: options.from, to: now.toISOString() };
  }

  // 4. Only 'to' provided (7 days before to that point)
  if (options.to) {
    const toDate = new Date(options.to);
    const weekBefore = new Date(toDate.getTime() - 7 * 86400000);
    return { from: weekBefore.toISOString(), to: options.to };
  }

  // 5. Explicit 'days' parameter (only reached when hasDateParams guards the call)
  const days = options.days!;
  const fromDate = new Date(now.getTime() - days * 86400000);

  return {
    from: fromDate.toISOString(),
    to: now.toISOString()
  };
}

/**
 * Check if any date-related parameters were explicitly provided.
 * When none are set, recall uses "last N checkpoints" mode instead of a date window.
 */
function hasDateParams(options: RecallOptions): boolean {
  return (
    options.since !== undefined ||
    options.days !== undefined ||
    options.from !== undefined ||
    options.to !== undefined
  );
}

async function loadWorkspaceCheckpoints(workspace: string, options: RecallOptions): Promise<Checkpoint[]> {
  let checkpoints: Checkpoint[];
  if (hasDateParams(options)) {
    const { from, to } = getDateRange(options);
    checkpoints = await getCheckpointsForDateRange(workspace, from, to);
  } else {
    const earlyLimit = options.search ? undefined : (options.limit !== undefined ? options.limit : 5);
    checkpoints = await getAllCheckpoints(workspace, earlyLimit);
  }

  if (options.planId) {
    checkpoints = checkpoints.filter(cp => cp.planId === options.planId);
  }

  return checkpoints;
}

function buildLexicalSearchCandidates(
  checkpoints: Checkpoint[],
  digests: Record<string, string>
): Checkpoint[] {
  return checkpoints.map(checkpoint => ({
    ...checkpoint,
    description: digests[checkpoint.id] ?? checkpoint.description
  }));
}

async function loadReadySemanticRecords(
  workspace: string,
  checkpoints: Checkpoint[],
  runtime?: RecallOptions['_semanticRuntime']
): Promise<ReadySemanticRecord[]> {
  if (checkpoints.length === 0) {
    return [];
  }

  const modelInfo = runtime?.getModelInfo?.();
  if (modelInfo) {
    await invalidateSemanticRecordsForModelVersion(workspace, modelInfo);
  }

  const checkpointIds = new Set(checkpoints.map(checkpoint => checkpoint.id));
  const state = await loadSemanticState(workspace);

  return state.records
    .filter(record =>
      record.status === 'ready' &&
      Array.isArray(record.embedding) &&
      checkpointIds.has(record.checkpointId)
    )
    .map(record => ({
      checkpointId: record.checkpointId,
      embedding: record.embedding!
    }));
}

async function runSearchSemanticMaintenance(
  workspaces: string[],
  runtime: RecallOptions['_semanticRuntime']
): Promise<void> {
  if (!runtime || !runtime.isReady()) {
    return;
  }

  const seenWorkspaces = new Set<string>();

  try {
    for (const workspace of workspaces) {
      if (seenWorkspaces.has(workspace)) {
        continue;
      }

      seenWorkspaces.add(workspace);

      const pending = await listPendingSemanticRecords(workspace);
      if (pending.length === 0) {
        continue;
      }

      await processPendingSemanticWork({
        pending,
        maxItems: pending.length,
        embed: async (texts: string[], signal?: AbortSignal) => await runtime.embedTexts(texts, signal),
        save: async (checkpointId: string, embedding: number[]) => {
          await markSemanticRecordReady(
            workspace,
            checkpointId,
            embedding,
            runtime.getModelInfo?.() ?? SEARCH_SEMANTIC_MODEL
          );
        }
      });
    }
  } catch (error) {
    warnSemanticFailure('semantic maintenance failed', error);
    return;
  }
}

async function backfillMissingSemanticRecords(
  workspace: string,
  checkpoints: Checkpoint[]
): Promise<void> {
  if (checkpoints.length === 0) {
    return;
  }

  try {
    const state = await loadSemanticState(workspace);
    const knownIds = new Set(Object.keys(state.manifest.checkpoints));
    const missing = checkpoints.filter(checkpoint => !knownIds.has(checkpoint.id));

    for (const checkpoint of missing) {
      const digest = buildRetrievalDigest(checkpoint);
      const digestHash = createHash('sha256').update(digest).digest('hex');

      await upsertPendingSemanticRecord(workspace, {
        checkpointId: checkpoint.id,
        checkpointTimestamp: checkpoint.timestamp,
        digest,
        digestHash,
        digestVersion: DIGEST_VERSION
      });
    }
  } catch {
    // Silently ignore — backfill is best-effort
  }
}

async function rankSearchCheckpoints(
  query: string,
  checkpoints: Checkpoint[],
  digests: Record<string, string>,
  readyRecords: ReadySemanticRecord[],
  runtime?: RecallOptions['_semanticRuntime'],
  queryEmbeddingPromise?: Promise<QueryEmbeddingResult>
): Promise<Checkpoint[]> {
  const checkpointsById = new Map(checkpoints.map(checkpoint => [checkpoint.id, checkpoint]));
  const lexicalRanked = searchCheckpoints(
    query,
    buildLexicalSearchCandidates(checkpoints, digests)
  );
  const lexicalOrder = lexicalRanked.map(checkpoint => checkpoint.id);

  if (!runtime) {
    return lexicalRanked
      .map(checkpoint => checkpointsById.get(checkpoint.id))
      .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
  }

  const candidateIds = new Set<string>([
    ...lexicalOrder,
    ...readyRecords.map(record => record.checkpointId)
  ]);
  const candidateCheckpoints = checkpoints.filter(checkpoint => candidateIds.has(checkpoint.id));

  if (candidateCheckpoints.length === 0) {
    return [];
  }

  try {
    const queryEmbeddingResult = queryEmbeddingPromise ? await queryEmbeddingPromise : undefined;
    if (queryEmbeddingResult && !queryEmbeddingResult.ok) {
      throw queryEmbeddingResult.error;
    }

    const queryEmbedding = queryEmbeddingResult?.embedding;

    const scored = await buildHybridRanking({
      query,
      checkpoints: candidateCheckpoints,
      lexicalOrder,
      digests,
      readyRecords,
      runtime,
      ...(queryEmbedding ? { queryEmbedding } : {})
    });

    return scored
      .filter(item => item.score >= MINIMUM_SEARCH_RELEVANCE)
      .map(item => {
        const original = checkpointsById.get(item.checkpoint.id);
        return original ?? item.checkpoint;
      });
  } catch {
    return lexicalRanked
      .map(checkpoint => checkpointsById.get(checkpoint.id))
      .filter((checkpoint): checkpoint is Checkpoint => Boolean(checkpoint));
  }
}

function presentCheckpoint(checkpoint: Checkpoint, options: RecallOptions): Checkpoint {
  const description = options.search && !options.full
    ? buildCompactSearchDescription(checkpoint)
    : (!options.full && checkpoint.summary)
      ? checkpoint.summary
      : checkpoint.description;

  const { summary, ...cleanCheckpoint } = checkpoint;
  const withDescription = {
    ...cleanCheckpoint,
    description
  };

  if (!options.full) {
    const {
      git, context, decision, alternatives, evidence,
      impact, symbols, unknowns, confidence,
      ...minimal
    } = withDescription;
    return minimal;
  }

  return withDescription;
}

/**
 * Recall checkpoints from a single workspace
 */
async function recallFromWorkspace(
  workspace: string,
  options: RecallOptions
): Promise<{ checkpoints: Checkpoint[]; activePlan: Plan | null }> {
  let checkpoints = await loadWorkspaceCheckpoints(workspace, options);

  if (options.search) {
    const semanticRuntime = options._semanticRuntime ?? getDefaultSemanticRuntime();
    const wasWarm = semanticRuntime.isReady();
    const queryEmbeddingPromise = semanticRuntime
      .embedTexts([options.search])
      .then(embeddings => ({ ok: true, embedding: embeddings[0] } as QueryEmbeddingResult))
      .catch(error => ({ ok: false, error } as QueryEmbeddingResult));
    const digests = Object.fromEntries(
      checkpoints.map(checkpoint => [checkpoint.id, buildRetrievalDigest(checkpoint)])
    );

    await backfillMissingSemanticRecords(workspace, checkpoints);

    if (wasWarm) {
      await runSearchSemanticMaintenance([workspace], semanticRuntime);
    }

    const readyRecords = await loadReadySemanticRecords(workspace, checkpoints, semanticRuntime);
    checkpoints = await rankSearchCheckpoints(
      options.search,
      checkpoints,
      digests,
      readyRecords,
      semanticRuntime,
      queryEmbeddingPromise
    );

    if (!wasWarm) {
      await runSearchSemanticMaintenance([workspace], semanticRuntime);
    }
  } else {
    checkpoints = checkpoints.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  const limit = Math.max(0, options.limit !== undefined ? options.limit : 5);
  checkpoints = limit > 0 ? checkpoints.slice(0, limit) : [];
  checkpoints = checkpoints.map(checkpoint => presentCheckpoint(checkpoint, options));

  // Get active plan
  const activePlan = await getActivePlan(workspace);

  return { checkpoints, activePlan };
}

/**
 * Recall checkpoints (main entry point)
 *
 * Retrieves checkpoints from specified workspace(s) with optional search
 */
export async function recall(options: RecallOptions = {}): Promise<RecallResult> {
  const workspace = options.workspace || 'current';

  // Single workspace recall
  if (workspace !== 'all') {
    const projectPath = resolveWorkspace(workspace === 'current' ? undefined : workspace);

    const { checkpoints, activePlan } = await recallFromWorkspace(projectPath, options);

    return {
      checkpoints,
      activePlan
    };
  }

  // Cross-workspace recall via registry
  const projects = await listRegisteredProjects(options._registryDir);

  // Apply global limit (default: 5, clamp negative to 0)
  const globalLimit = Math.max(0, options.limit !== undefined ? options.limit : 5);

  // Short-circuit: limit=0 means plan-only, skip all project I/O
  if (globalLimit === 0) {
    return { checkpoints: [], workspaces: [] };
  }

  if (options.search) {
    const semanticRuntime = options._semanticRuntime ?? getDefaultSemanticRuntime();
    const wasWarm = semanticRuntime.isReady();
    const queryEmbeddingPromise = semanticRuntime
      .embedTexts([options.search])
      .then(embeddings => ({ ok: true, embedding: embeddings[0] } as QueryEmbeddingResult))
      .catch(error => ({ ok: false, error } as QueryEmbeddingResult));

    if (wasWarm) {
      await runSearchSemanticMaintenance(
        projects.map(project => project.path),
        semanticRuntime
      );
    }

    const projectResults = await Promise.all(
      projects.map(async (project) => {
        const checkpoints = await loadWorkspaceCheckpoints(project.path, options);
        await backfillMissingSemanticRecords(project.path, checkpoints);
        const readyRecords = await loadReadySemanticRecords(project.path, checkpoints, semanticRuntime);

        return {
          project,
          checkpoints,
          readyRecords
        };
      })
    );

    const workspaceSummaries: WorkspaceSummary[] = [];
    const syntheticToCheckpoint = new Map<string, { checkpoint: Checkpoint; workspace: string }>();
    const rankedCandidates: Checkpoint[] = [];
    const readyRecords: ReadySemanticRecord[] = [];
    const digests: Record<string, string> = {};

    for (const { project, checkpoints, readyRecords: projectReadyRecords } of projectResults) {
      if (checkpoints.length === 0) {
        continue;
      }

      const lastActivity = checkpoints
        .map(c => c.timestamp)
        .filter(Boolean)
        .sort()
        .pop();

      workspaceSummaries.push({
        name: project.name,
        path: project.path,
        checkpointCount: checkpoints.length,
        ...(lastActivity ? { lastActivity } : {})
      });

      for (const checkpoint of checkpoints) {
        const syntheticId = `${project.path}::${checkpoint.id}`;
        syntheticToCheckpoint.set(syntheticId, {
          checkpoint,
          workspace: project.name
        });
        rankedCandidates.push({
          ...checkpoint,
          id: syntheticId
        });
        digests[syntheticId] = buildRetrievalDigest(checkpoint);
      }

      for (const record of projectReadyRecords) {
        readyRecords.push({
          checkpointId: `${project.path}::${record.checkpointId}`,
          embedding: record.embedding
        });
      }
    }

    const ranked = await rankSearchCheckpoints(
      options.search,
      rankedCandidates,
      digests,
      readyRecords,
      semanticRuntime,
      queryEmbeddingPromise
    );

    if (!wasWarm) {
      await runSearchSemanticMaintenance(
        projects.map(project => project.path),
        semanticRuntime
      );
    }

    return {
      checkpoints: ranked
        .slice(0, globalLimit)
        .map(checkpoint => {
          const original = syntheticToCheckpoint.get(checkpoint.id);
          if (!original) {
            return checkpoint;
          }

          return presentCheckpoint({
            ...original.checkpoint,
            workspace: original.workspace
          }, options);
        }),
      workspaces: workspaceSummaries
    };
  }

  // Fetch from all registered projects in parallel.
  // Per-project limit = global limit (each project may contribute all top results).
  const projectResults = await Promise.all(
    projects.map(async (project) => {
      const { checkpoints } = await recallFromWorkspace(project.path, {
        ...options,
        limit: globalLimit
      });
      return { project, checkpoints };
    })
  );

  // Build combined results
  const allCheckpoints: Checkpoint[] = [];
  const workspaceSummaries: WorkspaceSummary[] = [];

  for (const { project, checkpoints } of projectResults) {
    if (checkpoints.length > 0) {
      // Tag each checkpoint with its project name
      const tagged = checkpoints.map(c => ({ ...c, workspace: project.name }));
      allCheckpoints.push(...tagged);

      const summary: WorkspaceSummary = {
        name: project.name,
        path: project.path,
        checkpointCount: checkpoints.length
      };
      // Get last activity from the most recent checkpoint
      const lastActivity = checkpoints
        .map(c => c.timestamp)
        .filter(Boolean)
        .sort()
        .pop();
      if (lastActivity) summary.lastActivity = lastActivity;
      workspaceSummaries.push(summary);
    }
  }

  // Sort combined checkpoints by timestamp (newest first)
  allCheckpoints.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return {
    checkpoints: allCheckpoints.slice(0, globalLimit),
    workspaces: workspaceSummaries
  };
}
