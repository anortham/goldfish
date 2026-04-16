/**
 * Recall and search functionality
 *
 * Aggregates checkpoints across date ranges and workspaces,
 * with fuzzy search powered by fuse.js
 */

import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import { join } from 'path';
import type { Checkpoint, MemorySection, Plan, RecallOptions, RecallResult, WorkspaceSummary } from './types';
import { getCheckpointsForDateRange, getAllCheckpoints, CONSOLIDATION_AGE_LIMIT_DAYS, hasValidCalendarDate } from './checkpoints';
import { buildCompactSearchDescription, buildRetrievalDigest, DIGEST_VERSION } from './digests';
import { readMemory, readConsolidationState, getMemorySummary, parseMemorySections } from './memory';
import { getActiveBrief } from './plans';
import { listRegisteredProjects } from './registry';
import { invalidateSemanticRecordsForModelVersion, listPendingSemanticRecords, loadSemanticState, markSemanticRecordReady, upsertPendingSemanticRecord } from './semantic-cache';
import { rankSearchCheckpoints } from './ranking';
import type { ReadySemanticRecord } from './ranking';
import { processPendingSemanticWork } from './semantic';
import { getDefaultSemanticRuntime } from './transformers-embedder';
import { resolveWorkspace } from './workspace';

type QueryEmbeddingResult =
  | { ok: true; embedding?: number[] }
  | { ok: false; error: unknown };

const SEARCH_SEMANTIC_MODEL = {
  id: 'semantic-search-runtime',
  version: '1'
};

const QUERY_EMBEDDING_TIMEOUT_MS = 250;

// Bounded maintenance: process at most N items and M ms per search-triggered maintenance pass
const SEARCH_MAINTENANCE_MAX_ITEMS = 5;
const SEARCH_MAINTENANCE_MAX_MS = 100;

export const MEMORY_SECTION_PREFIX = 'memory_section_';

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function warnSemanticFailure(context: string, error: unknown): void {
  console.warn(`[goldfish] ${context}: ${describeError(error)}`);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function getCheckpointBriefId(checkpoint: Checkpoint): string | undefined {
  return checkpoint.briefId ?? checkpoint.planId;
}

function normalizeRecallOptions(options: RecallOptions): RecallOptions {
  const days = typeof options.days === 'number' && Number.isFinite(options.days) && options.days > 0
    ? options.days
    : undefined;
  const briefId = normalizeOptionalString(options.briefId) ?? normalizeOptionalString(options.planId);

  return {
    ...options,
    workspace: normalizeOptionalString(options.workspace),
    since: normalizeOptionalString(options.since),
    days,
    from: normalizeOptionalString(options.from),
    to: normalizeOptionalString(options.to),
    search: normalizeOptionalString(options.search),
    briefId,
    planId: briefId
  };
}

function createQueryEmbeddingPromise(
  query: string,
  runtime: NonNullable<RecallOptions['_semanticRuntime']>
): () => Promise<QueryEmbeddingResult> {
  return () => new Promise<QueryEmbeddingResult>((resolve) => {
    const controller = new AbortController();
    let settled = false;

    const timeout = setTimeout(() => {
      settled = true;
      controller.abort();
      resolve({ ok: false, error: new Error('query embedding timed out') });
    }, QUERY_EMBEDDING_TIMEOUT_MS);

    void runtime
      .embedTexts([query], controller.signal)
      .then(embeddings => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const embedding = embeddings[0];
        resolve(embedding ? { ok: true, embedding } : { ok: true });
      })
      .catch(error => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve({ ok: false, error });
      });
  });
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

function assertValidDateInput(value: string, label: 'from' | 'to'): void {
  const candidate = value.includes('T') ? value : `${value}T00:00:00.000Z`;
  const parsed = new Date(candidate);

  if (Number.isNaN(parsed.getTime()) || !hasValidCalendarDate(value, parsed)) {
    throw new Error(`Invalid ${label} format: ${value}`);
  }
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
    assertValidDateInput(options.from, 'from');
    assertValidDateInput(options.to, 'to');
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
    assertValidDateInput(options.from, 'from');
    return { from: options.from, to: now.toISOString() };
  }

  // 4. Only 'to' provided (7 days before to that point)
  if (options.to) {
    assertValidDateInput(options.to, 'to');
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

  if (options.briefId) {
    checkpoints = checkpoints.filter(cp => getCheckpointBriefId(cp) === options.briefId);
  }

  return checkpoints;
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

  const uniqueWorkspaces = workspaces.filter((workspace, index) => workspaces.indexOf(workspace) === index);
  let remainingItems = SEARCH_MAINTENANCE_MAX_ITEMS;
  const startedAt = Date.now();

  try {
    while (remainingItems > 0) {
      let progressed = false;

      for (const workspace of uniqueWorkspaces) {
        if (remainingItems <= 0) {
          return;
        }

        if ((Date.now() - startedAt) >= SEARCH_MAINTENANCE_MAX_MS) {
          return;
        }

        const pending = await listPendingSemanticRecords(workspace);
        if (pending.length === 0) {
          continue;
        }

        const remainingMs = SEARCH_MAINTENANCE_MAX_MS - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          return;
        }

        const result = await processPendingSemanticWork({
          pending,
          maxItems: Math.min(pending.length, remainingItems),
          maxMs: remainingMs,
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

        if (result.processed > 0) {
          progressed = true;
          remainingItems -= result.processed;
        }
      }

      if (!progressed) {
        return;
      }
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
): Promise<{
  checkpoints: Checkpoint[];
  activeBrief: Plan | null;
  activePlan: Plan | null;
  memory?: string;
  matchedMemorySections?: MemorySection[];
  consolidation?: { needed: boolean; staleCheckpoints: number; lastConsolidated: string | null };
}> {
  // Short-circuit: limit=0 means brief/consolidation only, skip all checkpoint I/O
  const limit = Math.max(0, options.limit !== undefined ? options.limit : 5);
  if (limit === 0) {
    const activeBrief = await getActiveBrief(workspace);

    const shouldIncludeMemory = options.includeMemory !== undefined
      ? options.includeMemory
      : !options.search;
    const memoryContent = shouldIncludeMemory ? await readMemory(workspace) : null;
    const consolidationState = await readConsolidationState(workspace);

    let memoryExists = memoryContent !== null;
    if (!memoryExists) {
      // Check for memory files even when we didn't read content (shouldIncludeMemory may be false)
      for (const filename of ['memory.yaml', 'MEMORY.md']) {
        try {
          await stat(join(workspace, '.memories', filename));
          memoryExists = true;
          break;
        } catch { /* doesn't exist */ }
      }
    }

    const consolidation = (consolidationState || memoryExists) ? {
      needed: false,
      staleCheckpoints: 0,
      lastConsolidated: consolidationState?.timestamp ?? null
    } : undefined;

    return {
      checkpoints: [],
      activeBrief,
      activePlan: activeBrief,
      ...(memoryContent !== null && shouldIncludeMemory ? { memory: memoryContent } : {}),
      ...(consolidation ? { consolidation } : {})
    };
  }

  // Load checkpoints for display. Only loads all when needed for date filtering or search.
  let checkpoints: Checkpoint[];
  if (hasDateParams(options)) {
    const { from, to } = getDateRange(options);
    checkpoints = await getCheckpointsForDateRange(workspace, from, to);
  } else {
    const earlyLimit = options.search ? undefined : limit;
    checkpoints = await getAllCheckpoints(workspace, earlyLimit);
  }

  if (options.briefId) {
    checkpoints = checkpoints.filter(cp => getCheckpointBriefId(cp) === options.briefId);
  }

  let matchedMemorySections: MemorySection[] | undefined;
  let cachedConsolidationState: Awaited<ReturnType<typeof readConsolidationState>> | undefined;

  if (options.search) {
    const semanticRuntime = options._semanticRuntime ?? getDefaultSemanticRuntime();
    const wasWarm = semanticRuntime.isReady();
    const queryEmbeddingPromise = createQueryEmbeddingPromise(options.search, semanticRuntime);

    // Load and parse memory sections into synthetic checkpoints for search
    const searchMemoryContent = await readMemory(workspace);
    const memorySections = searchMemoryContent ? parseMemorySections(searchMemoryContent) : [];
    cachedConsolidationState = await readConsolidationState(workspace);

    const syntheticSectionCheckpoints: Checkpoint[] = memorySections.map(section => ({
      id: `${MEMORY_SECTION_PREFIX}${section.slug}`,
      timestamp: cachedConsolidationState?.timestamp
        ?? (checkpoints.length > 0
          ? checkpoints.reduce((oldest, cp) => cp.timestamp < oldest ? cp.timestamp : oldest, checkpoints[0]!.timestamp)
          : new Date().toISOString()),
      description: section.content,
      tags: ['memory'],
      type: 'checkpoint' as const,
      summary: `Memory: ${section.header}`
    }));

    const allCandidates = [...checkpoints, ...syntheticSectionCheckpoints];

    const digests = Object.fromEntries(
      allCandidates.map(checkpoint => [checkpoint.id, buildRetrievalDigest(checkpoint)])
    );

    await backfillMissingSemanticRecords(workspace, allCandidates);

    if (wasWarm) {
      await runSearchSemanticMaintenance([workspace], semanticRuntime);
    }

    const readyRecords = await loadReadySemanticRecords(workspace, allCandidates, semanticRuntime);
    let rankedResults = await rankSearchCheckpoints(
      options.search,
      allCandidates,
      digests,
      readyRecords,
      semanticRuntime,
      queryEmbeddingPromise
    );

    if (!wasWarm) {
      await runSearchSemanticMaintenance([workspace], semanticRuntime);
    }

    // Separate memory section matches from real checkpoints
    const sectionMatches = rankedResults
      .filter(cp => cp.id.startsWith(MEMORY_SECTION_PREFIX))
      .map(cp => {
        const slug = cp.id.slice(MEMORY_SECTION_PREFIX.length);
        const section = memorySections.find(s => s.slug === slug);
        return section ?? { slug, header: slug, content: cp.description };
      });

    if (sectionMatches.length > 0) {
      matchedMemorySections = sectionMatches;
    }

    checkpoints = rankedResults.filter(cp => !cp.id.startsWith(MEMORY_SECTION_PREFIX));
  } else {
    checkpoints = checkpoints.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  checkpoints = checkpoints.slice(0, limit);
  checkpoints = checkpoints.map(checkpoint => presentCheckpoint(checkpoint, options));

  // Get active brief
  const activeBrief = await getActiveBrief(workspace);

  // Memory and consolidation
  const shouldIncludeMemory = options.includeMemory !== undefined
    ? options.includeMemory
    : !options.search;

  const memoryContent = shouldIncludeMemory ? await readMemory(workspace) : null;
  const consolidationState = cachedConsolidationState !== undefined
    ? cachedConsolidationState
    : await readConsolidationState(workspace);

  // Check if a memory file exists (cheap stat, independent of whether we read its content)
  let memoryExists = memoryContent !== null;
  if (!memoryExists) {
    for (const filename of ['memory.yaml', 'MEMORY.md']) {
      try {
        await stat(join(workspace, '.memories', filename));
        memoryExists = true;
        break;
      } catch { /* doesn't exist */ }
    }
  }

  // Count stale checkpoints (checkpoints newer than last consolidation AND
  // within the 30-day age window). This matches what the consolidate handler
  // actually processes, preventing inflated counts from old checkpoints.
  const ageLimit = Date.now() - CONSOLIDATION_AGE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
  let staleCheckpoints = 0;
  if (consolidationState) {
    const allForCount = await getAllCheckpoints(workspace);
    const lastTimestamp = new Date(consolidationState.timestamp).getTime();
    staleCheckpoints = allForCount.filter(
      cp => {
        const cpTime = new Date(cp.timestamp).getTime();
        return cpTime > lastTimestamp && cpTime >= ageLimit;
      }
    ).length;
  } else if (consolidationState === null && memoryExists) {
    // No consolidation state but MEMORY.md exists: treat recent checkpoints as stale.
    const allForCount = await getAllCheckpoints(workspace);
    staleCheckpoints = allForCount.filter(
      cp => new Date(cp.timestamp).getTime() >= ageLimit
    ).length;
  }

  const consolidation = (consolidationState || memoryExists) ? {
    needed: staleCheckpoints > 0,
    staleCheckpoints,
    lastConsolidated: consolidationState?.timestamp ?? null
  } : undefined;

  return {
    checkpoints,
    activeBrief,
    activePlan: activeBrief,
    ...(memoryContent !== null && shouldIncludeMemory ? { memory: memoryContent } : {}),
    ...(matchedMemorySections ? { matchedMemorySections } : {}),
    ...(consolidation ? { consolidation } : {})
  };
}

/**
 * Recall checkpoints (main entry point)
 *
 * Retrieves checkpoints from specified workspace(s) with optional search
 */
export async function recall(options: RecallOptions = {}): Promise<RecallResult> {
  const normalizedOptions = normalizeRecallOptions(options);
  const workspace = normalizedOptions.workspace || 'current';

  // Single workspace recall
  if (workspace !== 'all') {
    const projectPath = resolveWorkspace(workspace === 'current' ? undefined : workspace);

    const { checkpoints, activeBrief, activePlan, memory, matchedMemorySections, consolidation } = await recallFromWorkspace(projectPath, normalizedOptions);

    return {
      checkpoints,
      activeBrief,
      activePlan,
      ...(memory !== undefined ? { memory } : {}),
      ...(matchedMemorySections ? { matchedMemorySections } : {}),
      ...(consolidation ? { consolidation } : {})
    };
  }

  // Cross-workspace recall via registry
  const projects = await listRegisteredProjects(normalizedOptions._registryDir);

  // Apply global limit (default: 5, clamp negative to 0)
  const globalLimit = Math.max(0, normalizedOptions.limit !== undefined ? normalizedOptions.limit : 5);

  // Short-circuit: limit=0 means brief-only, skip all project I/O
  if (globalLimit === 0) {
    return { checkpoints: [], workspaces: [] };
  }

  if (normalizedOptions.search) {
    const semanticRuntime = normalizedOptions._semanticRuntime ?? getDefaultSemanticRuntime();
    const wasWarm = semanticRuntime.isReady();
    const queryEmbeddingPromise = createQueryEmbeddingPromise(normalizedOptions.search, semanticRuntime);

    if (wasWarm) {
      await runSearchSemanticMaintenance(
        projects.map(project => project.path),
        semanticRuntime
      );
    }

    const projectResults = await Promise.all(
      projects.map(async (project) => {
        const checkpoints = await loadWorkspaceCheckpoints(project.path, normalizedOptions);
        await backfillMissingSemanticRecords(project.path, checkpoints);
        const readyRecords = await loadReadySemanticRecords(project.path, checkpoints, semanticRuntime);
        const projectMemory = await readMemory(project.path);

        return {
          project,
          checkpoints,
          readyRecords,
          projectMemory
        };
      })
    );

    const workspaceSummaries: WorkspaceSummary[] = [];
    const syntheticToCheckpoint = new Map<string, { checkpoint: Checkpoint; workspace: string }>();
    const rankedCandidates: Checkpoint[] = [];
    const readyRecords: ReadySemanticRecord[] = [];
    const digests: Record<string, string> = {};

    for (const { project, checkpoints, readyRecords: projectReadyRecords, projectMemory } of projectResults) {
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
        ...(lastActivity ? { lastActivity } : {}),
        memorySummary: getMemorySummary(projectMemory)
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
      normalizedOptions.search,
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
          }, normalizedOptions);
        }),
      workspaces: workspaceSummaries
    };
  }

  // Fetch from all registered projects in parallel.
  // Lightweight path: only load checkpoints and memory, skip brief/consolidation per project.
  // Load without limit so checkpointCount in summaries reflects total matches.
  const projectResults = await Promise.all(
    projects.map(async (project) => {
      const allCheckpoints = await loadWorkspaceCheckpoints(project.path, { ...normalizedOptions, limit: undefined });
      allCheckpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const presented = allCheckpoints
        .slice(0, globalLimit)
        .map(checkpoint => presentCheckpoint(checkpoint, normalizedOptions));
      const projectMemory = await readMemory(project.path);
      return { project, checkpoints: presented, totalCount: allCheckpoints.length, projectMemory };
    })
  );

  // Build combined results
  const allCheckpoints: Checkpoint[] = [];
  const workspaceSummaries: WorkspaceSummary[] = [];

  for (const { project, checkpoints, totalCount, projectMemory } of projectResults) {
    if (totalCount > 0) {
      // Tag each checkpoint with its project name
      const tagged = checkpoints.map(c => ({ ...c, workspace: project.name }));
      allCheckpoints.push(...tagged);

      const summary: WorkspaceSummary = {
        name: project.name,
        path: project.path,
        checkpointCount: totalCount,
        memorySummary: getMemorySummary(projectMemory)
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
