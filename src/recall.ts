/**
 * Recall and search functionality
 *
 * Aggregates checkpoints across date ranges and workspaces, with BM25
 * search delegated to ranking.ts.
 */

import type { Brief, Checkpoint, RecallOptions, RecallResult, WorkspaceSummary } from './types';
import { getCheckpointsForDateRange, getAllCheckpoints, hasValidCalendarDate } from './checkpoints';
import { buildCompactSearchDescription } from './digests';
import { getActiveBrief } from './briefs';
import { listRegisteredProjects } from './registry';
import { searchCheckpoints } from './ranking';
import { resolveWorkspace } from './workspace';

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// Read-side legacy: existing checkpoint markdown may still carry a `planId`
// frontmatter field. The Checkpoint type retains that field and the parser
// populates it for older files, so the briefId filter has to consult both
// during recall. New writes only emit `briefId` (see src/checkpoints.ts).
function getCheckpointBriefId(checkpoint: Checkpoint): string | undefined {
  return checkpoint.briefId ?? checkpoint.planId;
}

function normalizeRecallOptions(options: RecallOptions): RecallOptions {
  const days = typeof options.days === 'number' && Number.isFinite(options.days) && options.days > 0
    ? options.days
    : undefined;
  const workspace = normalizeOptionalString(options.workspace);
  const since = normalizeOptionalString(options.since);
  const from = normalizeOptionalString(options.from);
  const to = normalizeOptionalString(options.to);
  const search = normalizeOptionalString(options.search);
  const briefId = normalizeOptionalString(options.briefId);

  const normalized: RecallOptions = {
    ...options
  };

  if (workspace !== undefined) normalized.workspace = workspace;
  else delete normalized.workspace;

  if (since !== undefined) normalized.since = since;
  else delete normalized.since;

  if (days !== undefined) normalized.days = days;
  else delete normalized.days;

  if (from !== undefined) normalized.from = from;
  else delete normalized.from;

  if (to !== undefined) normalized.to = to;
  else delete normalized.to;

  if (search !== undefined) normalized.search = search;
  else delete normalized.search;

  if (briefId !== undefined) normalized.briefId = briefId;
  else delete normalized.briefId;

  return normalized;
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
  activeBrief: Brief | null;
}> {
  // Short-circuit: limit=0 means brief only, skip checkpoint I/O
  const limit = Math.max(0, options.limit !== undefined ? options.limit : 5);
  if (limit === 0) {
    const activeBrief = await getActiveBrief(workspace);
    return {
      checkpoints: [],
      activeBrief
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

  if (options.search) {
    checkpoints = searchCheckpoints(options.search, checkpoints);
  } else {
    checkpoints = checkpoints.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  checkpoints = checkpoints.slice(0, limit);
  checkpoints = checkpoints.map(checkpoint => presentCheckpoint(checkpoint, options));

  const activeBrief = await getActiveBrief(workspace);

  return {
    checkpoints,
    activeBrief
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

    const { checkpoints, activeBrief } = await recallFromWorkspace(projectPath, normalizedOptions);

    return {
      checkpoints,
      activeBrief
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
    const projectResults = await Promise.all(
      projects.map(async (project) => {
        const checkpoints = await loadWorkspaceCheckpoints(project.path, normalizedOptions);
        return { project, checkpoints };
      })
    );

    const workspaceSummaries: WorkspaceSummary[] = [];
    const syntheticToCheckpoint = new Map<string, { checkpoint: Checkpoint; workspace: string }>();
    const rankedCandidates: Checkpoint[] = [];

    for (const { project, checkpoints } of projectResults) {
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
      }
    }

    const ranked = searchCheckpoints(normalizedOptions.search, rankedCandidates);

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
  // Load without limit so checkpointCount in summaries reflects total matches.
  const unlimitedOptions: RecallOptions = { ...normalizedOptions };
  delete unlimitedOptions.limit;
  const projectResults = await Promise.all(
    projects.map(async (project) => {
      const allCheckpoints = await loadWorkspaceCheckpoints(project.path, unlimitedOptions);
      allCheckpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const presented = allCheckpoints
        .slice(0, globalLimit)
        .map(checkpoint => presentCheckpoint(checkpoint, normalizedOptions));
      return { project, checkpoints: presented, totalCount: allCheckpoints.length };
    })
  );

  // Build combined results
  const allCheckpoints: Checkpoint[] = [];
  const workspaceSummaries: WorkspaceSummary[] = [];

  for (const { project, checkpoints, totalCount } of projectResults) {
    if (totalCount > 0) {
      // Tag each checkpoint with its project name
      const tagged = checkpoints.map(c => ({ ...c, workspace: project.name }));
      allCheckpoints.push(...tagged);

      const summary: WorkspaceSummary = {
        name: project.name,
        path: project.path,
        checkpointCount: totalCount
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
