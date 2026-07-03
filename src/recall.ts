/**
 * Recall and search functionality
 *
 * Aggregates checkpoints across date ranges and workspaces, with BM25
 * search delegated to ranking.ts.
 */

import type { Brief, BriefRefreshNotice, Checkpoint, RecallInput, RecallOptions, RecallResult, StaleBriefNotice, WorkspaceSummary } from './types';
import {
  getCheckpointsForDateRange,
  getAllCheckpoints,
  findLatestCheckpointTimestampForBrief,
  hasValidCalendarDate
} from './checkpoints';
import { buildCompactSearchDescription } from './digests';
import { getActiveBrief } from './briefs';
import { listRegisteredProjects } from './registry';
import { searchCheckpoints } from './ranking';
import { resolveWorkspace } from './workspace';

/**
 * A brief is considered stale once its newest activity is older than this many
 * days. Activity is the newest checkpoint referencing the brief, falling back
 * to the brief's creation time when no checkpoint references it yet. A recent
 * brief.updated also counts as activity.
 */
const STALE_BRIEF_DAYS = 7;
const BRIEF_REFRESH_DAYS = 14;

/**
 * Resolve the active brief for a workspace, applying staleness suppression.
 *
 * Non-destructive: when the active brief's newest activity is older than
 * STALE_BRIEF_DAYS, the brief body is withheld (activeBrief: null) and a
 * staleBrief notice is returned instead. The brief's status on disk is never
 * mutated.
 */
async function resolveActiveBrief(
  workspace: string
): Promise<{
  activeBrief: Brief | null;
  staleBrief: StaleBriefNotice | null;
  briefRefresh: BriefRefreshNotice | null;
}> {
  const brief = await getActiveBrief(workspace);
  if (!brief) {
    return { activeBrief: null, staleBrief: null, briefRefresh: null };
  }

  // Bound the scan to dirs at/after the brief's creation date: no checkpoint can
  // reference a brief that did not yet exist, so this never misses a match but
  // keeps recall() off a full-history scan when the active brief is fresh.
  const createdDate = typeof brief.created === 'string' ? brief.created.split('T')[0] : undefined;
  const latestActivity = await findLatestCheckpointTimestampForBrief(workspace, brief.id, createdDate);
  const updatedAt = brief.updated ?? brief.created;
  let lastActivity = brief.created;
  if (new Date(updatedAt).getTime() > new Date(lastActivity).getTime()) {
    lastActivity = updatedAt;
  }
  if (latestActivity && new Date(latestActivity).getTime() > new Date(lastActivity).getTime()) {
    lastActivity = latestActivity;
  }
  const ageMs = Date.now() - new Date(lastActivity).getTime();
  const daysSinceActivity = Math.floor(ageMs / 86_400_000);

  if (daysSinceActivity > STALE_BRIEF_DAYS) {
    return {
      activeBrief: null,
      staleBrief: {
        id: brief.id,
        title: brief.title,
        lastActivity,
        daysSinceActivity
      },
      briefRefresh: null
    };
  }

  const updatedAgeMs = Date.now() - new Date(updatedAt).getTime();
  const daysSinceUpdated = Math.floor(updatedAgeMs / 86_400_000);
  const briefRefresh = daysSinceUpdated > BRIEF_REFRESH_DAYS
    ? {
        id: brief.id,
        title: brief.title,
        updated: updatedAt,
        daysSinceUpdated
      }
    : null;

  return { activeBrief: brief, staleBrief: null, briefRefresh };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Coerce a tags filter input into a lowercased, de-duplicated list. Accepts a
 * real array or a comma-separated string (e.g. from a slash-command surface).
 * Lowercasing here makes the later tag match case-insensitive; checkpoint tags
 * keep their original case for display. Returns undefined when nothing usable
 * remains, so the filter is skipped rather than excluding everything.
 */
function normalizeTagsFilter(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : value.split(',');
  const cleaned = raw
    .map(tag => (typeof tag === 'string' ? tag.trim().toLowerCase() : ''))
    .filter(tag => tag.length > 0);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : undefined;
}

/** A checkpoint with no explicit type is conceptually the default 'checkpoint'. */
function getCheckpointType(checkpoint: Checkpoint): string {
  return (checkpoint.type ?? 'checkpoint').toLowerCase();
}

function getCheckpointTagsLower(checkpoint: Checkpoint): string[] {
  if (!Array.isArray(checkpoint.tags)) return [];
  return checkpoint.tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.toLowerCase());
}

function getCheckpointSymbols(checkpoint: Checkpoint): string[] {
  const raw = checkpoint.symbols;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((symbol): symbol is string => typeof symbol === 'string');
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((symbol): symbol is string => typeof symbol === 'string');
      }
    } catch { /* not JSON */ }
    return [raw];
  }
  return [];
}

function normalizeFilePathForMatch(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function checkpointMatchesFile(checkpoint: Checkpoint, query: string): boolean {
  const files = checkpoint.git?.files;
  if (!files || !Array.isArray(files) || files.length === 0) return false;
  const normalizedQuery = normalizeFilePathForMatch(query);
  return files.some(file => {
    if (typeof file !== 'string') return false;
    const stored = normalizeFilePathForMatch(file);
    return stored === normalizedQuery || stored.endsWith(`/${normalizedQuery}`);
  });
}

function checkpointMatchesSymbol(checkpoint: Checkpoint, query: string): boolean {
  const want = query.toLowerCase();
  return getCheckpointSymbols(checkpoint).some(symbol => symbol.toLowerCase() === want);
}

/**
 * Apply structured (non-textual) filters shared by single- and cross-workspace
 * recall: brief affinity, checkpoint type, and tags (AND semantics — every
 * requested tag must be present). Type and tags are matched case-insensitively.
 */
/**
 * Whether any structured (non-textual) filter is active. When one is, recall
 * must scan the full corpus before slicing to `limit` — otherwise it would
 * filter only the most recent N checkpoints and miss older matches.
 */
function hasStructuredFilter(options: RecallOptions): boolean {
  return Boolean(options.briefId)
    || Boolean(options.type)
    || Boolean(options.tags && options.tags.length > 0)
    || Boolean(options.file)
    || Boolean(options.symbol);
}

function applyStructuredFilters(checkpoints: Checkpoint[], options: RecallOptions): Checkpoint[] {
  let filtered = checkpoints;

  if (options.briefId) {
    filtered = filtered.filter(cp => getCheckpointBriefId(cp) === options.briefId);
  }

  if (options.type) {
    const wantType = options.type.toLowerCase();
    filtered = filtered.filter(cp => getCheckpointType(cp) === wantType);
  }

  if (options.tags && options.tags.length > 0) {
    const wantTags = options.tags;
    filtered = filtered.filter(cp => {
      const cpTags = getCheckpointTagsLower(cp);
      return wantTags.every(tag => cpTags.includes(tag));
    });
  }

  if (options.file) {
    filtered = filtered.filter(cp => checkpointMatchesFile(cp, options.file!));
  }

  if (options.symbol) {
    filtered = filtered.filter(cp => checkpointMatchesSymbol(cp, options.symbol!));
  }

  return filtered;
}

// Read-side legacy: existing checkpoint markdown may still carry a `planId`
// frontmatter field. The Checkpoint type retains that field and the parser
// populates it for older files, so the briefId filter has to consult both
// during recall. New writes only emit `briefId` (see src/checkpoints.ts).
function getCheckpointBriefId(checkpoint: Checkpoint): string | undefined {
  return checkpoint.briefId ?? checkpoint.planId;
}

function normalizeRecallOptions(options: RecallInput): RecallOptions {
  const days = typeof options.days === 'number' && Number.isFinite(options.days) && options.days > 0
    ? options.days
    : undefined;
  const workspace = normalizeOptionalString(options.workspace);
  const since = normalizeOptionalString(options.since);
  const from = normalizeOptionalString(options.from);
  const to = normalizeOptionalString(options.to);
  const search = normalizeOptionalString(options.search);
  const briefId = normalizeOptionalString(options.briefId);
  const type = normalizeOptionalString(options.type);
  const file = normalizeOptionalString(options.file);
  const symbol = normalizeOptionalString(options.symbol);
  const tags = normalizeTagsFilter(options.tags);

  // Explicit `tags` overrides the spread's wider (string | string[]) type so
  // `normalized` is a clean RecallOptions; the placeholder is corrected below.
  const normalized: RecallOptions = {
    ...options,
    tags: tags ?? []
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

  if (type !== undefined) normalized.type = type;
  else delete normalized.type;

  if (file !== undefined) normalized.file = file;
  else delete normalized.file;

  if (symbol !== undefined) normalized.symbol = symbol;
  else delete normalized.symbol;

  if (tags !== undefined) normalized.tags = tags;
  else delete normalized.tags;

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
    // Load the full corpus when searching or filtering so matches outside the
    // most-recent-N window are not lost before the filter/search runs.
    const earlyLimit = options.search || hasStructuredFilter(options)
      ? undefined
      : (options.limit !== undefined ? options.limit : 5);
    checkpoints = await getAllCheckpoints(workspace, earlyLimit);
  }

  return applyStructuredFilters(checkpoints, options);
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
      git,
      symbols,
      context, decision, alternatives, evidence,
      impact, unknowns, confidence,
      ...minimal
    } = withDescription;
    return {
      ...minimal,
      ...(options.file && git ? { git } : {}),
      ...(options.symbol && symbols ? { symbols } : {})
    };
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
  staleBrief: StaleBriefNotice | null;
  briefRefresh: BriefRefreshNotice | null;
}> {
  // Short-circuit: limit=0 means brief only, skip checkpoint I/O
  const limit = Math.max(0, options.limit !== undefined ? options.limit : 5);
  if (limit === 0) {
    const { activeBrief, staleBrief, briefRefresh } = await resolveActiveBrief(workspace);
    return {
      checkpoints: [],
      activeBrief,
      staleBrief,
      briefRefresh
    };
  }

  // Load checkpoints for display. Only loads all when needed for date filtering or search.
  let checkpoints: Checkpoint[];
  if (hasDateParams(options)) {
    const { from, to } = getDateRange(options);
    checkpoints = await getCheckpointsForDateRange(workspace, from, to);
  } else {
    // Load the full corpus when searching or filtering so matches outside the
    // most-recent-N window are not lost before the filter/search runs.
    const earlyLimit = options.search || hasStructuredFilter(options) ? undefined : limit;
    checkpoints = await getAllCheckpoints(workspace, earlyLimit);
  }

  checkpoints = applyStructuredFilters(checkpoints, options);

  if (options.search) {
    checkpoints = await searchCheckpoints(options.search, checkpoints);
  } else {
    checkpoints = checkpoints.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  checkpoints = checkpoints.slice(0, limit);
  checkpoints = checkpoints.map(checkpoint => presentCheckpoint(checkpoint, options));

  const { activeBrief, staleBrief, briefRefresh } = await resolveActiveBrief(workspace);

  return {
    checkpoints,
    activeBrief,
    staleBrief,
    briefRefresh
  };
}

/**
 * Recall checkpoints (main entry point)
 *
 * Retrieves checkpoints from specified workspace(s) with optional search
 */
export async function recall(options: RecallInput = {}): Promise<RecallResult> {
  const normalizedOptions = normalizeRecallOptions(options);
  const workspace = normalizedOptions.workspace || 'current';

  // Single workspace recall
  if (workspace !== 'all') {
    const projectPath = resolveWorkspace(workspace === 'current' ? undefined : workspace);

    const { checkpoints, activeBrief, staleBrief, briefRefresh } = await recallFromWorkspace(projectPath, normalizedOptions);

    return {
      checkpoints,
      activeBrief,
      staleBrief,
      briefRefresh
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

    const syntheticToCheckpoint = new Map<string, {
      checkpoint: Checkpoint;
      workspace: string;
      path: string;
    }>();
    const rankedCandidates: Checkpoint[] = [];

    for (const { project, checkpoints } of projectResults) {
      if (checkpoints.length === 0) {
        continue;
      }

      for (const checkpoint of checkpoints) {
        const syntheticId = `${project.path}::${checkpoint.id}`;
        syntheticToCheckpoint.set(syntheticId, {
          checkpoint,
          workspace: project.name,
          path: project.path
        });
        rankedCandidates.push({
          ...checkpoint,
          id: syntheticId
        });
      }
    }

    const ranked = await searchCheckpoints(normalizedOptions.search, rankedCandidates);
    const workspaceSummaryMap = new Map<string, WorkspaceSummary>();

    for (const checkpoint of ranked) {
      const original = syntheticToCheckpoint.get(checkpoint.id);
      if (!original) {
        continue;
      }

      const existing = workspaceSummaryMap.get(original.path);
      if (existing) {
        existing.checkpointCount += 1;
        if (!existing.lastActivity || original.checkpoint.timestamp > existing.lastActivity) {
          existing.lastActivity = original.checkpoint.timestamp;
        }
        continue;
      }

      workspaceSummaryMap.set(original.path, {
        name: original.workspace,
        path: original.path,
        checkpointCount: 1,
        lastActivity: original.checkpoint.timestamp
      });
    }

    const workspaceSummaries = Array.from(workspaceSummaryMap.values())
      .sort((a, b) => a.name.localeCompare(b.name));

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
