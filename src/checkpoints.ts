/**
 * Checkpoint storage and retrieval
 *
 * Checkpoints are stored as individual markdown files with YAML frontmatter:
 * {project}/.memories/{date}/{HHMMSS}_{hash}.md
 */

import { join } from 'path';
import { userInfo } from 'os';
import { readFile, writeFile, readdir, rename, unlink, mkdir, stat } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Actor, Checkpoint, CheckpointInput, ObservedActor } from './types';
import { getMemoriesDir, ensureMemoriesDir, resolveWorkspace } from './workspace';
import { getGitContext, getGitIdentity, resolveGitCaptureCwd } from './git';
import { withLock } from './lock';
import { generateSummary } from './summary';
import { registerProject } from './registry';
import { getActiveBrief } from './briefs';
import { getLogger } from './logger';

interface CheckpointDependencies {
  getGitContext: (cwd?: string) => import('./types').GitContext | Promise<import('./types').GitContext>;
  getCallerCwd?: () => string;
  getOsUsername?: () => string | undefined;
  getGitIdentity?: (cwd?: string) => Promise<{ name?: string; email?: string }> | { name?: string; email?: string };
}

const defaultCheckpointDependencies: CheckpointDependencies = {
  getGitContext,
  getOsUsername: () => userInfo().username,
  getGitIdentity
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

const ACTOR_KEYS = ['harness', 'model', 'session', 'user', 'git_user', 'git_email'] as const;

const MAX_ACTOR_VALUE_LENGTH = 200;

/**
 * Identity values reach single-line response output verbatim, and git config
 * is repo-controlled — collapse control characters so a hostile value cannot
 * forge response lines, and cap length so it cannot flood them.
 */
function cleanActorValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const collapsed = value
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .trim()
    .slice(0, MAX_ACTOR_VALUE_LENGTH);
  return collapsed ? collapsed : undefined;
}

/**
 * Assemble the server-observed actor for a checkpoint save.
 * Env vars beat MCP-observed values; every empty field is omitted;
 * returns undefined when no field survives.
 */
export function assembleActor(
  observed: ObservedActor | undefined,
  identity: { user?: string | undefined; gitUser?: string | undefined; gitEmail?: string | undefined },
  env: Record<string, string | undefined> = process.env
): Actor | undefined {
  const harness = cleanActorValue(env.GOLDFISH_HARNESS) ?? cleanActorValue(observed?.harness);
  const model = cleanActorValue(env.GOLDFISH_MODEL);
  const sessionCandidate = cleanActorValue(env.GOLDFISH_SESSION) ?? cleanActorValue(observed?.session);
  const session = sessionCandidate === 'default' ? undefined : sessionCandidate;
  const user = cleanActorValue(identity.user);
  const gitUser = cleanActorValue(identity.gitUser);
  const gitEmail = cleanActorValue(identity.gitEmail);

  const actor: Actor = {};
  if (harness) actor.harness = harness;
  if (model) actor.model = model;
  if (session) actor.session = session;
  if (user) actor.user = user;
  if (gitUser) actor.git_user = gitUser;
  if (gitEmail) actor.git_email = gitEmail;
  return Object.keys(actor).length > 0 ? actor : undefined;
}

/**
 * Format an actor as one labeled line of `key=value` pairs in field order.
 * Empty fields are skipped; returns undefined when no pair remains.
 */
export function formatActorLine(actor: Actor): string | undefined {
  const pairs: string[] = [];
  for (const key of ACTOR_KEYS) {
    const value = cleanActorValue(actor[key]);
    if (value) pairs.push(`${key}=${value}`);
  }
  return pairs.length > 0 ? `Actor: ${pairs.join(' ')}` : undefined;
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

async function getAvailableCheckpointPath(
  dateDir: string,
  checkpoint: Checkpoint
): Promise<{ filePath: string; suffix: number }> {
  const baseFilename = getCheckpointFilename(checkpoint);
  const existingFiles = new Set(await readdir(dateDir));

  if (!existingFiles.has(baseFilename)) {
    return { filePath: join(dateDir, baseFilename), suffix: 0 };
  }

  let suffix = 1;
  let candidateFilename = baseFilename.replace(/\.md$/, `_${suffix}.md`);

  while (existingFiles.has(candidateFilename)) {
    suffix += 1;
    candidateFilename = baseFilename.replace(/\.md$/, `_${suffix}.md`);
  }

  return {
    filePath: join(dateDir, candidateFilename),
    suffix
  };
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
    if (checkpoint.git.worktree) git.worktree = checkpoint.git.worktree;
    if (checkpoint.git.files && checkpoint.git.files.length > 0) {
      git.files = checkpoint.git.files;
    }
    if (Object.keys(git).length > 0) {
      frontmatter.git = git;
    }
  }

  if (checkpoint.actor) {
    const actor: Record<string, string> = {};
    for (const key of ACTOR_KEYS) {
      const value = checkpoint.actor[key];
      if (value) actor[key] = value;
    }
    if (Object.keys(actor).length > 0) {
      frontmatter.actor = actor;
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
  if (rawGit.worktree) git.worktree = String(rawGit.worktree);
  const files = rawGit.files ?? rawGit.files_changed ?? rawGit.filesChanged;
  if (Array.isArray(files) && files.length > 0) {
    git.files = files.map(String);
  }
  return Object.keys(git).length > 0 ? git : undefined;
}

/**
 * Normalize a raw actor object from frontmatter or JSON. Unknown keys are
 * dropped, empty values are omitted, and a fully empty block becomes undefined.
 */
function normalizeActor(rawActor: unknown): Actor | undefined {
  if (!rawActor || typeof rawActor !== 'object' || Array.isArray(rawActor)) {
    return undefined;
  }

  const raw = rawActor as Record<string, unknown>;
  const actor: Actor = {};
  for (const key of ACTOR_KEYS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    const normalized = cleanActorValue(String(value));
    if (normalized) actor[key] = normalized;
  }
  return Object.keys(actor).length > 0 ? actor : undefined;
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
  const actor = normalizeActor(frontmatter.actor);
  if (actor) checkpoint.actor = actor;
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

  if (raw.id === undefined || raw.id === null || String(raw.id).trim() === '') {
    throw new Error('Invalid checkpoint file: missing id');
  }

  const timestamp = parseRequiredCheckpointTimestamp(raw.timestamp);

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

  const tags = normalizeStringArray(raw.tags);
  if (tags) checkpoint.tags = tags;

  const rawGit = raw.git as Record<string, unknown> | undefined;
  const git = rawGit ? normalizeGit(rawGit) : undefined;
  if (git) checkpoint.git = git;

  const actor = normalizeActor(raw.actor);
  if (actor) checkpoint.actor = actor;

  return checkpoint;
}

/**
 * Save a checkpoint as an individual file
 * Uses atomic write-then-rename to prevent corruption
 */
export async function saveCheckpoint(
  input: CheckpointInput,
  observed?: ObservedActor
): Promise<Checkpoint> {
  const projectPath = await resolveWorkspace(input.workspace);
  await ensureMemoriesDir(projectPath);

  // Create checkpoint with current timestamp
  const timestamp = new Date().toISOString();
  let capture: { cwd: string; worktree?: string } = { cwd: projectPath };
  try {
    const callerCwd = checkpointDependencies.getCallerCwd?.() ?? process.cwd();
    capture = await resolveGitCaptureCwd(projectPath, callerCwd);
  } catch {
    capture = { cwd: projectPath };
  }
  if (capture.worktree) {
    try {
      getLogger().info(`git.capture cwd=${capture.cwd} workspace=${projectPath}`);
    } catch {
      // Logging must never fail the save
    }
  }
  const gitContext = await checkpointDependencies.getGitContext(capture.cwd);
  if (capture.worktree) {
    gitContext.worktree = capture.worktree;
  }

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
  if (gitContext.branch || gitContext.commit || gitContext.files || gitContext.worktree) {
    checkpoint.git = gitContext;
  }

  try {
    let user: string | undefined;
    try {
      user = checkpointDependencies.getOsUsername?.();
    } catch {
      user = undefined;
    }

    let identity: { name?: string; email?: string } = {};
    try {
      identity = (await checkpointDependencies.getGitIdentity?.(capture.cwd)) ?? {};
    } catch {
      identity = {};
    }

    const actor = assembleActor(
      observed,
      { user, gitUser: identity.name, gitEmail: identity.email },
      process.env
    );
    if (actor) checkpoint.actor = actor;
  } catch {
    // Backstop: identity failure never fails the save; the git context captured above stays as-is
  }

  // Auto-generate summary for long descriptions
  const summary = generateSummary(input.description);
  if (summary) {
    checkpoint.summary = summary;
  }

  // Attach active brief ID if one exists. Only briefId is set on new
  // checkpoints — the legacy `planId` field on the Checkpoint type is
  // populated by parseCheckpointFile when it reads older frontmatter, so
  // readers can still match by planId, but new writes do not emit it.
  try {
    const activeBrief = await getActiveBrief(projectPath);
    if (activeBrief) {
      checkpoint.briefId = activeBrief.id;
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
  let savedFilePath: string | undefined;
  await withLock(dateDir, async () => {
    const { filePath, suffix } = await getAvailableCheckpointPath(dateDir, checkpoint);
    if (suffix > 0) {
      checkpoint.id = `${checkpoint.id}_${suffix}`;
    }

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
    savedFilePath = filePath;
  });

  if (savedFilePath) {
    checkpoint.filePath = savedFilePath;
  }

  // Auto-register project in cross-project registry before returning so
  // immediate cross-workspace recall can see the saved checkpoint.
  try {
    await registerProject(projectPath);
  } catch {
    // Silently ignore registration failures — this is best-effort
  }

  return checkpoint;
}

/**
 * In-memory per-day corpus cache. Markdown on disk stays the source of truth:
 * every read re-fingerprints the directory (name + size + mtime of each file)
 * and only skips the read+parse work on an exact match, so external edits and
 * new files are always picked up. Nothing derived is ever written to disk.
 */
interface DayCacheEntry {
  fingerprint: string;
  checkpoints: Checkpoint[];
}

const dayCache = new Map<string, DayCacheEntry>();
const DAY_CACHE_MAX_ENTRIES = 4096;

/** Test hook: drop all cached day entries. */
export function __clearDayCacheForTests(): void {
  dayCache.clear();
}

async function fingerprintDayFiles(dateDir: string, files: string[]): Promise<string> {
  const parts = await Promise.all(files.map(async (file) => {
    try {
      const stats = await stat(join(dateDir, file));
      // ctime + inode catch edits that preserve size and restore mtime:
      // ctime can't be set by touch/utimes, and atomic rewrites change the inode
      return `${file}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}:${stats.ino}`;
    } catch {
      return `${file}:gone`;
    }
  }));
  return parts.join('|');
}

interface DayLoadResult {
  fingerprint: string;
  checkpoints: Checkpoint[];
}

async function loadDay(projectPath: string, date: string): Promise<DayLoadResult> {
  const dateDir = join(getMemoriesDir(projectPath), date);

  let files: string[];
  try {
    files = await readdir(dateDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { fingerprint: '', checkpoints: [] };
    }
    throw error;
  }

  const mdFiles = files.filter(f => f.endsWith('.md')).sort();
  const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

  const fingerprint = await fingerprintDayFiles(dateDir, [...mdFiles, ...jsonFiles]);
  const cached = dayCache.get(dateDir);
  if (cached && cached.fingerprint === fingerprint) {
    return { fingerprint, checkpoints: copyCheckpoints(cached.checkpoints) };
  }

  // Read files concurrently; a corrupt file skips itself without failing the batch
  const mdResults = await Promise.all(mdFiles.map(async (file): Promise<Checkpoint | null> => {
    const filePath = join(dateDir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseCheckpointFile(content);
      checkpoint.filePath = filePath;
      return checkpoint;
    } catch (err: any) {
      getLogger().warn(`skipping corrupted checkpoint: ${filePath} (${err?.message ?? 'unknown error'})`);
      return null;
    }
  }));

  // Legacy: read old Julie JSON checkpoint files
  const jsonResults = await Promise.all(jsonFiles.map(async (file): Promise<Checkpoint | null> => {
    const filePath = join(dateDir, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const checkpoint = parseJsonCheckpoint(content);
      checkpoint.filePath = filePath;
      return checkpoint;
    } catch {
      return null;
    }
  }));

  const checkpoints = [...mdResults, ...jsonResults]
    .filter((c): c is Checkpoint => c !== null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (dayCache.size >= DAY_CACHE_MAX_ENTRIES) {
    dayCache.clear();
  }
  dayCache.set(dateDir, { fingerprint, checkpoints });

  return { fingerprint, checkpoints: copyCheckpoints(checkpoints) };
}

/**
 * Shallow-copy each checkpoint so callers can't mutate cached entries through
 * top-level fields. Nested arrays (tags, git.files) stay shared — treat them
 * as read-only.
 */
function copyCheckpoints(checkpoints: Checkpoint[]): Checkpoint[] {
  return checkpoints.map(checkpoint => ({ ...checkpoint }));
}

/**
 * Get all checkpoints for a specific day
 */
export async function getCheckpointsForDay(
  projectPath: string,
  date: string
): Promise<Checkpoint[]> {
  const resolvedProjectPath = await resolveWorkspace(projectPath);
  const { checkpoints } = await loadDay(resolvedProjectPath, date);
  return checkpoints;
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
  const resolvedProjectPath = await resolveWorkspace(projectPath);
  const { checkpoints } = await getAllCheckpointsInternal(resolvedProjectPath, limit);
  return checkpoints;
}

/**
 * Like getAllCheckpoints (unlimited), but also returns a corpus fingerprint
 * derived from every date directory's file stats. Callers use it to key
 * derived in-memory state (the search index) that must invalidate whenever
 * any checkpoint file changes.
 */
export async function getAllCheckpointsWithFingerprint(
  projectPath: string
): Promise<{ checkpoints: Checkpoint[]; fingerprint: string }> {
  const resolvedProjectPath = await resolveWorkspace(projectPath);
  return getAllCheckpointsInternal(resolvedProjectPath);
}

async function getAllCheckpointsInternal(
  projectPath: string,
  limit?: number
): Promise<{ checkpoints: Checkpoint[]; fingerprint: string }> {
  const memoriesDir = getMemoriesDir(projectPath);

  let entries: string[];
  try {
    entries = await readdir(memoriesDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return { checkpoints: [], fingerprint: '' };
    }
    throw error;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateDirs = entries.filter(e => datePattern.test(e)).sort().reverse();

  const allCheckpoints: Checkpoint[] = [];
  const dayFingerprints: string[] = [];
  for (const dir of dateDirs) {
    const { checkpoints, fingerprint } = await loadDay(projectPath, dir);
    allCheckpoints.push(...checkpoints);
    dayFingerprints.push(`${dir}#${fingerprint}`);
    // Early termination: stop scanning older directories once we have enough
    if (limit && allCheckpoints.length >= limit) break;
  }

  // Sort newest first, then slice to limit
  const sorted = [...allCheckpoints].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const fingerprint = Bun.hash(dayFingerprints.join('\n')).toString(36);
  return {
    checkpoints: limit ? sorted.slice(0, limit) : sorted,
    fingerprint
  };
}

/**
 * Find the timestamp of the newest checkpoint that references a brief.
 *
 * Scans date directories newest-first; the first (newest) directory containing
 * a matching checkpoint holds the newest match, so we early-exit there. Matches
 * both `briefId` and the legacy `planId` affinity field. Returns null when no
 * checkpoint references the brief (or the project has no memories).
 *
 * `notBeforeDate` (YYYY-MM-DD) bounds the scan: date directories older than it
 * are skipped. A checkpoint can only reference a brief that already existed, so
 * passing the brief's creation date as the cutoff loses no matches while
 * keeping the common session-start case (a fresh brief over a large history)
 * from scanning and parsing the entire `.memories/` tree on every recall.
 */
export async function findLatestCheckpointTimestampForBrief(
  projectPath: string,
  briefId: string,
  notBeforeDate?: string
): Promise<string | null> {
  const resolvedProjectPath = await resolveWorkspace(projectPath);
  const memoriesDir = getMemoriesDir(resolvedProjectPath);

  let entries: string[];
  try {
    entries = await readdir(memoriesDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  let dateDirs = entries.filter(e => datePattern.test(e)).sort().reverse();
  if (notBeforeDate) {
    // Date-dir names are zero-padded YYYY-MM-DD, so lexical compare == chronological.
    dateDirs = dateDirs.filter(dir => dir >= notBeforeDate);
  }

  for (const dir of dateDirs) {
    const checkpoints = await getCheckpointsForDay(resolvedProjectPath, dir);
    let latest: string | null = null;
    for (const checkpoint of checkpoints) {
      const affinity = checkpoint.briefId ?? checkpoint.planId;
      if (affinity !== briefId) continue;
      if (latest === null || new Date(checkpoint.timestamp).getTime() > new Date(latest).getTime()) {
        latest = checkpoint.timestamp;
      }
    }
    if (latest !== null) {
      return latest;
    }
  }

  return null;
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
  const resolvedProjectPath = await resolveWorkspace(projectPath);
  const memoriesDir = getMemoriesDir(resolvedProjectPath);

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

  // Load all relevant directories concurrently
  const perDay = await Promise.all(relevantDirs.map(dir => getCheckpointsForDay(resolvedProjectPath, dir)));
  const allCheckpoints: Checkpoint[] = perDay.flat();

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
