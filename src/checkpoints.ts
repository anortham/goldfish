/**
 * Checkpoint storage and retrieval
 *
 * Checkpoints are stored as individual markdown files with YAML frontmatter:
 * {project}/.memories/{date}/{HHMMSS}_{hash}.md
 */

import { join } from 'path';
import { readFile, writeFile, readdir, rename, unlink, mkdir } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { createHash } from 'crypto';
import type { Checkpoint, CheckpointInput } from './types';
import { getMemoriesDir, ensureMemoriesDir, resolveWorkspace } from './workspace';
import { getGitContext } from './git';
import { withLock } from './lock';
import { generateSummary } from './summary';
import { registerProject } from './registry';
import { getActiveBrief } from './plans';
import { buildRetrievalDigest, DIGEST_VERSION } from './digests';
import { upsertPendingSemanticRecord } from './semantic-cache';
import { getLogger } from './logger';

/** Checkpoints older than this are excluded from consolidation. Shared by recall, consolidate handler, and hooks. */
export const CONSOLIDATION_AGE_LIMIT_DAYS = 30;

type SemanticQueueInput = {
  checkpointId: string;
  checkpointTimestamp: string;
  digest: string;
  digestHash: string;
  digestVersion: number;
};

interface CheckpointDependencies {
  queueSemanticRecord: (workspace: string, input: SemanticQueueInput) => Promise<void>;
  getGitContext: (cwd?: string) => import('./types').GitContext;
}

const defaultCheckpointDependencies: CheckpointDependencies = {
  queueSemanticRecord: upsertPendingSemanticRecord,
  getGitContext
};

let checkpointDependencies: CheckpointDependencies = defaultCheckpointDependencies;

export function __setCheckpointDependenciesForTests(
  overrides: Partial<CheckpointDependencies> = {}
): () => void {
  const previousDependencies = checkpointDependencies;
  checkpointDependencies = {
    ...checkpointDependencies,
    ...overrides
  };

  return () => {
    checkpointDependencies = previousDependencies;
  };
}

/**
 * Generate a deterministic checkpoint ID from timestamp and description.
 * Format: checkpoint_{first 8 hex chars of SHA-256 hash}
 */
export function generateCheckpointId(timestamp: string, description: string): string {
  const input = `${timestamp}:${description}`;
  const hash = new Bun.CryptoHasher('sha256')
    .update(input)
    .digest('hex')
    .slice(0, 8);
  return `checkpoint_${hash}`;
}

/**
 * Get the filename for a checkpoint file.
 * Format: HHMMSS_first4ofhash.md
 */
export function getCheckpointFilename(checkpoint: Checkpoint): string {
  // Extract HH:MM:SS from ISO timestamp
  const timePart = checkpoint.timestamp.substring(11, 19); // "HH:MM:SS"
  const hhmmss = timePart.replace(/:/g, '');

  // Extract first 4 chars of the hash portion of the ID
  const hash4 = checkpoint.id.replace('checkpoint_', '').slice(0, 4);

  return `${hhmmss}_${hash4}.md`;
}

async function getAvailableCheckpointPath(dateDir: string, checkpoint: Checkpoint): Promise<string> {
  const baseFilename = getCheckpointFilename(checkpoint);
  const existingFiles = new Set(await readdir(dateDir));

  if (!existingFiles.has(baseFilename)) {
    return join(dateDir, baseFilename);
  }

  let suffix = 1;
  let candidateFilename = baseFilename.replace(/\.md$/, `_${suffix}.md`);

  while (existingFiles.has(candidateFilename)) {
    suffix += 1;
    candidateFilename = baseFilename.replace(/\.md$/, `_${suffix}.md`);
  }

  return join(dateDir, candidateFilename);
}

/**
 * Format a checkpoint as YAML frontmatter + markdown body
 */
export function formatCheckpoint(checkpoint: Checkpoint): string {
  // Build frontmatter object with only present fields
  const frontmatter: Record<string, unknown> = {
    id: checkpoint.id,
    timestamp: checkpoint.timestamp
  };

  if (checkpoint.tags && checkpoint.tags.length > 0) {
    frontmatter.tags = checkpoint.tags;
  }

  if (checkpoint.git) {
    // Only include git fields that are present
    const git: Record<string, unknown> = {};
    if (checkpoint.git.branch) git.branch = checkpoint.git.branch;
    if (checkpoint.git.commit) git.commit = checkpoint.git.commit;
    if (checkpoint.git.files && checkpoint.git.files.length > 0) {
      git.files = checkpoint.git.files;
    }
    if (Object.keys(git).length > 0) {
      frontmatter.git = git;
    }
  }

  if (checkpoint.summary) {
    frontmatter.summary = checkpoint.summary;
  }

  const briefId = checkpoint.briefId ?? checkpoint.planId;
  if (briefId) {
    frontmatter.briefId = briefId;
  }

  if (checkpoint.type) {
    frontmatter.type = checkpoint.type;
  }

  if (checkpoint.context) {
    frontmatter.context = checkpoint.context;
  }

  if (checkpoint.decision) {
    frontmatter.decision = checkpoint.decision;
  }

  if (checkpoint.alternatives && checkpoint.alternatives.length > 0) {
    frontmatter.alternatives = checkpoint.alternatives;
  }

  if (checkpoint.impact) {
    frontmatter.impact = checkpoint.impact;
  }

  if (checkpoint.evidence && checkpoint.evidence.length > 0) {
    frontmatter.evidence = checkpoint.evidence;
  }

  if (checkpoint.symbols && checkpoint.symbols.length > 0) {
    frontmatter.symbols = checkpoint.symbols;
  }

  if (checkpoint.next) {
    frontmatter.next = checkpoint.next;
  }

  if (typeof checkpoint.confidence === 'number') {
    frontmatter.confidence = checkpoint.confidence;
  }

  if (checkpoint.unknowns && checkpoint.unknowns.length > 0) {
    frontmatter.unknowns = checkpoint.unknowns;
  }

  const yaml = stringifyYaml(frontmatter).trim();
  return `---\n${yaml}\n---\n\n${checkpoint.description}\n`;
}

/**
 * Convert a legacy timestamp (Unix seconds or milliseconds) to ISO 8601.
 * Heuristic: values > 1e10 are milliseconds, otherwise seconds.
 * (Unix seconds won't exceed 1e10 until year 2286.)
 */
function normalizeTimestamp(raw: unknown): string {
  if (typeof raw === 'number') {
    const ms = raw > 1e10 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  // Fallback for null, undefined, or empty string — use current time
  return new Date().toISOString();
}

export function hasValidCalendarDate(value: string, parsed: Date): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (!match) {
    return true;
  }

  const [, year, month, day] = match;
  return (
    parsed.getUTCFullYear() === parseInt(year!, 10) &&
    parsed.getUTCMonth() + 1 === parseInt(month!, 10) &&
    parsed.getUTCDate() === parseInt(day!, 10)
  );
}

function parseRequiredCheckpointTimestamp(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('Invalid checkpoint file: missing timestamp');
  }

  const timestamp = normalizeTimestamp(raw);
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || !hasValidCalendarDate(timestamp, parsed)) {
    throw new Error('Invalid checkpoint file: invalid timestamp');
  }

  return timestamp;
}

/**
 * Normalize a legacy git context object to the current GitContext shape.
 * Handles: files_changed (snake_case), filesChanged (camelCase), dirty field.
 */
function normalizeGit(rawGit: Record<string, unknown>): Checkpoint['git'] | undefined {
  const git: NonNullable<Checkpoint['git']> = {};
  if (rawGit.branch) git.branch = String(rawGit.branch);
  if (rawGit.commit) git.commit = String(rawGit.commit);
  const files = rawGit.files ?? rawGit.files_changed ?? rawGit.filesChanged;
  if (Array.isArray(files) && files.length > 0) {
    git.files = files.map(String);
  }
  return Object.keys(git).length > 0 ? git : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map(item => String(item).trim())
    .filter(item => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeConfidence(raw: unknown): number | undefined {
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    return undefined;
  }

  const parsed = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 5) {
    return undefined;
  }

  return rounded;
}

function isCheckpointType(value: unknown): value is NonNullable<Checkpoint['type']> {
  return value === 'checkpoint' || value === 'decision' || value === 'incident' || value === 'learning';
}

/**
 * Parse a single checkpoint from a YAML frontmatter markdown file
 */
export function parseCheckpointFile(content: string): Checkpoint {
  // Strip BOM and normalize CRLF → LF (Windows git checkout / Notepad)
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  // Split on frontmatter delimiters
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid checkpoint file: no YAML frontmatter found');
  }

  const yamlContent = match[1]!;
  const body = match[2]!.trim();

  const frontmatter = parseYaml(yamlContent) as Record<string, unknown>;

  if (frontmatter.id === undefined || frontmatter.id === null || String(frontmatter.id).trim() === '') {
    throw new Error('Invalid checkpoint file: missing id');
  }

  const timestamp = parseRequiredCheckpointTimestamp(frontmatter.timestamp);
  const rawGit = frontmatter.git as Record<string, unknown> | undefined;
  const git = rawGit ? normalizeGit(rawGit) : undefined;

  const checkpoint: Checkpoint = {
    id: String(frontmatter.id),
    timestamp,
    description: body
  };

  const tags = Array.isArray(frontmatter.tags)
    ? normalizeStringArray(frontmatter.tags)
    : undefined;
  if (tags) checkpoint.tags = tags;
  if (git) checkpoint.git = git;
  if (frontmatter.summary) checkpoint.summary = String(frontmatter.summary);
  const affinityId = typeof frontmatter.briefId === 'string'
    ? frontmatter.briefId
    : typeof frontmatter.planId === 'string'
      ? frontmatter.planId
      : undefined;
  if (affinityId) {
    checkpoint.briefId = String(affinityId);
    checkpoint.planId = String(affinityId);
  }
  if (isCheckpointType(frontmatter.type)) checkpoint.type = frontmatter.type;
  if (frontmatter.context) checkpoint.context = String(frontmatter.context);
  if (frontmatter.decision) checkpoint.decision = String(frontmatter.decision);
  const alternatives = normalizeStringArray(frontmatter.alternatives);
  if (alternatives) checkpoint.alternatives = alternatives;
  if (frontmatter.impact) checkpoint.impact = String(frontmatter.impact);
  const evidence = normalizeStringArray(frontmatter.evidence);
  if (evidence) checkpoint.evidence = evidence;
  const symbols = normalizeStringArray(frontmatter.symbols);
  if (symbols) checkpoint.symbols = symbols;
  if (frontmatter.next) checkpoint.next = String(frontmatter.next);
  const confidence = normalizeConfidence(frontmatter.confidence);
  if (confidence !== undefined) checkpoint.confidence = confidence;
  const unknowns = normalizeStringArray(frontmatter.unknowns);
  if (unknowns) checkpoint.unknowns = unknowns;

  return checkpoint;
}

/**
 * Parse a checkpoint from an old Julie JSON format file.
 * Handles: Unix timestamps (seconds), dirty field, type field, files_changed.
 */
export function parseJsonCheckpoint(content: string): Checkpoint {
  const raw = JSON.parse(content) as Record<string, unknown>;

  const timestamp = normalizeTimestamp(raw.timestamp);

  const checkpoint: Checkpoint = {
    id: String(raw.id),
    timestamp,
    description: String(raw.description ?? '')
  };

  const affinityId = typeof raw.briefId === 'string'
    ? raw.briefId
    : typeof raw.planId === 'string'
      ? raw.planId
      : undefined;
  if (affinityId) {
    checkpoint.briefId = affinityId;
    checkpoint.planId = affinityId;
  }

  const tags = raw.tags as string[] | undefined;
  if (tags && tags.length > 0) checkpoint.tags = tags;

  const rawGit = raw.git as Record<string, unknown> | undefined;
  const git = rawGit ? normalizeGit(rawGit) : undefined;
  if (git) checkpoint.git = git;

  return checkpoint;
}

/**
 * Save a checkpoint as an individual file
 * Uses atomic write-then-rename to prevent corruption
 */
export async function saveCheckpoint(input: CheckpointInput): Promise<Checkpoint> {
  const projectPath = resolveWorkspace(input.workspace);
  await ensureMemoriesDir(projectPath);

  // Create checkpoint with current timestamp
  const timestamp = new Date().toISOString();
  const gitContext = checkpointDependencies.getGitContext(projectPath);

  // Generate deterministic ID
  const id = generateCheckpointId(timestamp, input.description);

  const checkpoint: Checkpoint = {
    id,
    timestamp,
    description: input.description
  };

  if (input.type) checkpoint.type = input.type;
  if (input.context) checkpoint.context = input.context;
  if (input.decision) checkpoint.decision = input.decision;
  if (input.alternatives && input.alternatives.length > 0) checkpoint.alternatives = input.alternatives;
  if (input.impact) checkpoint.impact = input.impact;
  if (input.evidence && input.evidence.length > 0) checkpoint.evidence = input.evidence;
  if (input.symbols && input.symbols.length > 0) checkpoint.symbols = input.symbols;
  if (input.next) checkpoint.next = input.next;
  const confidence = normalizeConfidence(input.confidence);
  if (confidence !== undefined) checkpoint.confidence = confidence;
  if (input.unknowns && input.unknowns.length > 0) checkpoint.unknowns = input.unknowns;

  if (input.tags) checkpoint.tags = input.tags;

  // Set git context as nested object
  if (gitContext.branch || gitContext.commit || gitContext.files) {
    checkpoint.git = gitContext;
  }

  // Auto-generate summary for long descriptions
  const summary = generateSummary(input.description);
  if (summary) {
    checkpoint.summary = summary;
  }

  // Attach active brief ID if one exists
  try {
    const activeBrief = await getActiveBrief(projectPath);
    if (activeBrief) {
      checkpoint.briefId = activeBrief.id;
      checkpoint.planId = activeBrief.id;
    }
  } catch {
    // Silently ignore — brief affinity is best-effort
  }

  // Determine file path
  const date = timestamp.split('T')[0]!;
  const memoriesDir = getMemoriesDir(projectPath);
  const dateDir = join(memoriesDir, date);

  // Ensure date directory exists
  await mkdir(dateDir, { recursive: true });

  // Use file lock on the date directory to prevent name collisions
  await withLock(dateDir, async () => {
    const filePath = await getAvailableCheckpointPath(dateDir, checkpoint);

    // Atomic write (write to temp file, then rename)
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    const content = formatCheckpoint(checkpoint);
    await writeFile(tempPath, content, 'utf-8');
    try {
      await rename(tempPath, filePath);
    } catch (error: any) {
      if (error.code === 'ENOENT' && process.platform === 'win32') {
        await writeFile(filePath, content, 'utf-8');
        try { await unlink(tempPath); } catch {}
      } else {
        throw error;
      }
    }
  });

  // Auto-register project in cross-project registry (fire-and-forget)
  registerProject(projectPath).catch(() => {
    // Silently ignore registration failures — this is best-effort
  });

  const digest = buildRetrievalDigest(checkpoint);
  const digestHash = createHash('sha256').update(digest).digest('hex');

  try {
    await checkpointDependencies.queueSemanticRecord(projectPath, {
      checkpointId: checkpoint.id,
      checkpointTimestamp: checkpoint.timestamp,
      digest,
      digestHash,
      digestVersion: DIGEST_VERSION
    });
  } catch {
    // Silently ignore semantic queue failures — checkpoint saves must still succeed
  }

  return checkpoint;
}

/**
 * Get all checkpoints for a specific day
 */
export async function getCheckpointsForDay(
  projectPath: string,
  date: string
): Promise<Checkpoint[]> {
  const dateDir = join(getMemoriesDir(projectPath), date);

  let files: string[];
  try {
    files = await readdir(dateDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const mdFiles = files.filter(f => f.endsWith('.md')).sort();
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

  const checkpoints: Checkpoint[] = [];

  for (const file of mdFiles) {
    try {
      const filePath = join(dateDir, file);
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseCheckpointFile(content);
      checkpoint.filePath = filePath;
      checkpoints.push(checkpoint);
    } catch (err: any) {
      getLogger().warn(`skipping corrupted checkpoint: ${join(dateDir, file)} (${err?.message ?? 'unknown error'})`);
      continue;
    }
  }

  // Legacy: read old Julie JSON checkpoint files
  for (const file of jsonFiles) {
    try {
      const filePath = join(dateDir, file);
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseJsonCheckpoint(content);
      checkpoint.filePath = filePath;
      checkpoints.push(checkpoint);
    } catch {
      continue;
    }
  }

  // Sort by timestamp
  return checkpoints.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Get all checkpoints across all date directories (no time filter).
 * Used for default recall when no date parameters are specified.
 * Scans directories newest-first and stops early when limit is reached.
 *
 * @param projectPath - Path to the project directory
 * @param limit - Optional max checkpoints to collect (stops scanning after enough)
 */
export async function getAllCheckpoints(
  projectPath: string,
  limit?: number
): Promise<Checkpoint[]> {
  const memoriesDir = getMemoriesDir(projectPath);

  let entries: string[];
  try {
    entries = await readdir(memoriesDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateDirs = entries.filter(e => datePattern.test(e)).sort().reverse();

  const allCheckpoints: Checkpoint[] = [];
  for (const dir of dateDirs) {
    const checkpoints = await getCheckpointsForDay(projectPath, dir);
    allCheckpoints.push(...checkpoints);
    // Early termination: stop scanning older directories once we have enough
    if (limit && allCheckpoints.length >= limit) break;
  }

  // Sort newest first, then slice to limit
  const sorted = allCheckpoints.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Get all checkpoints across a date range (inclusive)
 *
 * @param projectPath - Path to the project directory
 * @param fromDate - ISO 8601 timestamp or YYYY-MM-DD date
 * @param toDate - ISO 8601 timestamp or YYYY-MM-DD date
 */
export async function getCheckpointsForDateRange(
  projectPath: string,
  fromDate: string,
  toDate: string
): Promise<Checkpoint[]> {
  const memoriesDir = getMemoriesDir(projectPath);

  let entries: string[];
  try {
    entries = await readdir(memoriesDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  // Parse timestamps (handles both ISO timestamps and YYYY-MM-DD dates)
  const fromTimestamp = new Date(fromDate).getTime();

  // If toDate is a date-only string (no time component), treat it as end of day
  let toTimestamp: number;
  if (toDate.includes('T')) {
    toTimestamp = new Date(toDate).getTime();
  } else {
    toTimestamp = new Date(toDate + 'T23:59:59.999Z').getTime();
  }

  // Extract date portions to determine which directories to scan
  const fromDateOnly = fromDate.split('T')[0]!;
  const toDateOnly = toDate.split('T')[0]!;

  const from = new Date(fromDateOnly);
  const to = new Date(toDateOnly);

  // Filter to date directories within range
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const relevantDirs = entries
    .filter(e => datePattern.test(e))
    .filter(e => {
      const dirDate = new Date(e);
      return dirDate >= from && dirDate <= to;
    })
    .sort();

  // Load all checkpoints from relevant directories
  const allCheckpoints: Checkpoint[] = [];
  for (const dir of relevantDirs) {
    const checkpoints = await getCheckpointsForDay(projectPath, dir);
    allCheckpoints.push(...checkpoints);
  }

  // Filter by actual timestamp (not just directory date)
  const filtered = allCheckpoints.filter(checkpoint => {
    const checkpointTime = new Date(checkpoint.timestamp).getTime();
    return checkpointTime >= fromTimestamp && checkpointTime <= toTimestamp;
  });

  // Sort by timestamp
  return filtered.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}
