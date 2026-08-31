/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each project stores
 * its memories in a local .memories/ directory.
 */

import { mkdir, realpath, stat } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join, posix, win32 } from 'path';
import { fileURLToPath } from 'url';

export interface WorkspaceRoot {
  uri: string;
  name?: string | undefined;
  _meta?: Record<string, unknown> | undefined;
}

export interface ResolveWorkspaceOptions {
  env?: string;
  roots?: WorkspaceRoot[] | null;
  cwd?: string;
}

/**
 * Normalize a workspace identifier (path or name) to a simple name
 *
 * Examples:
 *   /Users/user/source/goldfish → goldfish
 *   C:\source\goldfish → goldfish
 *   @coa/goldfish-mcp → coa-goldfish-mcp
 *   My Project! → my-project
 */
export function normalizeWorkspace(pathOrName: string): string {
  // Extract base directory/package name
  let name = pathOrName;

  // Handle package names (@org/name → org-name) BEFORE checking for paths
  if (name.startsWith('@')) {
    name = name.replace(/^@/, '').replace(/\//g, '-');
  }
  // Handle file paths (Unix or Windows)
  else if (name.includes('/') || name.includes('\\')) {
    name = name.replace(/[/\\]+$/, '');

    // Detect scoped package paths like /home/dev/@org/my-project → org-my-project
    const scopedMatch = name.match(/[/\\](@[^/\\]+)[/\\]([^/\\]+)$/);
    const scope = scopedMatch?.[1];
    const packageName = scopedMatch?.[2];
    if (scope && packageName) {
      name = scope.replace(/^@/, '') + '-' + packageName;
    } else {
      // Get last path component
      name = name.replace(/^.*[/\\]/, '');
    }
  }

  // Lowercase and sanitize (keep only alphanumeric and dashes)
  name = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  // Remove consecutive dashes
  name = name.replace(/-+/g, '-');

  // Trim dashes from start and end
  name = name.replace(/^-+|-+$/g, '');

  // If empty after sanitization, use default name
  if (name.length === 0) {
    return 'default';
  }

  return name;
}

/**
 * Source of the workspace path returned by resolveWorkspaceWithSource.
 *
 * - 'explicit': caller passed a non-'current' workspace argument
 * - 'env':      GOLDFISH_WORKSPACE was set
 * - 'roots':    came from MCP roots/list
 * Only caller-provided sources can authorize a workspace. Parent-walk results
 * are suggestions only and are represented by `RecoveredWorkspace`.
 */
export type WorkspaceSource = 'explicit' | 'env' | 'roots';

export interface ResolvedWorkspace {
  path: string;
  source: WorkspaceSource;
}

/** Result of bounded candidate discovery used in an unbound error. */
export interface RecoveredWorkspace {
  path: string;
  source: 'registry' | 'walk';
}

export const WORKSPACE_UNBOUND_MESSAGE = 'Workspace is not bound. User-level MCP registrations must pass the absolute project root on every workspace-scoped call. Retry with {"workspace":"<absolute-project-root>"}.';

/**
 * Resolve the effective workspace path.
 * Priority: explicit arg > GOLDFISH_WORKSPACE env var > roots; no cwd fallback.
 */
export async function resolveWorkspace(explicit?: string, options: ResolveWorkspaceOptions = {}): Promise<string> {
  return (await resolveWorkspaceWithSource(explicit, options)).path;
}

/**
 * Resolve and validate the effective workspace path along with its source.
 * Cwd, registry, and parent-walk results are never authorization sources.
 */
export async function resolveWorkspaceWithSource(
  explicit?: string,
  options: ResolveWorkspaceOptions = {}
): Promise<ResolvedWorkspace> {
  const explicitCandidate = explicit !== undefined && explicit.trim() !== 'current'
    ? explicit
    : undefined;

  if (explicitCandidate !== undefined) {
    return bindWorkspaceCandidate(explicitCandidate, 'explicit', options);
  }

  const fromEnv = options.env ?? process.env.GOLDFISH_WORKSPACE;
  if (fromEnv?.trim()) {
    return bindWorkspaceCandidate(fromEnv, 'env', options);
  }

  const suggestions: string[] = [];
  for (const root of getWorkspaceRootCandidates(options.roots)) {
    const result = await validateWorkspaceCandidate(root);
    if (result.path) return { path: result.path, source: 'roots' };
    suggestions.push(...(result.suggestions ?? []));
  }

  throw await workspaceBindingError(options.cwd, suggestions);
}

type WorkspaceCandidateValidation = {
  path?: string;
  suggestions?: string[];
};

async function bindWorkspaceCandidate(
  candidate: string,
  source: WorkspaceSource,
  options: ResolveWorkspaceOptions
): Promise<ResolvedWorkspace> {
  const result = await validateWorkspaceCandidate(candidate);
  if (!result.path) {
    throw await workspaceBindingError(options.cwd, result.suggestions);
  }
  return { path: result.path, source };
}

async function workspaceBindingError(cwd?: string, suggestions: string[] = []): Promise<Error> {
  const allSuggestions = [...suggestions];
  if (allSuggestions.length === 0 && cwd !== undefined) {
    const candidate = await parentWalkWorkspace(cwd);
    if (candidate) allSuggestions.push(candidate.path);
  }

  const uniqueSuggestions = [...new Set(allSuggestions)];
  const suffix = uniqueSuggestions.length > 0
    ? `\nSuggestions only; choose one explicitly:\n${uniqueSuggestions.map((path) => `- ${path}`).join('\n')}`
    : '';
  return new Error(`${WORKSPACE_UNBOUND_MESSAGE}${suffix}`);
}

async function validateWorkspaceCandidate(candidate: string): Promise<WorkspaceCandidateValidation> {
  const value = candidate.trim();
  if (!isHostNativeAbsolutePath(value) || hasDotSegment(value)) {
    return {};
  }

  let candidateStat;
  try {
    candidateStat = await stat(value);
  } catch {
    return {};
  }
  if (!candidateStat.isDirectory()) return {};

  const unsafe = await resolveUnsafeCwdReason(value);
  if (unsafe) return {};

  const suggestions = await findEnclosingProjectRoots(value);
  if (suggestions.length > 0) return { suggestions };

  return { path: value };
}

function isHostNativeAbsolutePath(value: string): boolean {
  if (!value || value === 'current' || value === 'all') return false;
  if (value === '~' || /^~[\\/]/.test(value)) return false;
  if (/(?:\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*|%[^%]+%)/.test(value)) return false;
  if (/^file:/i.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) return false;

  if (process.platform === 'win32') {
    const driveAbsolute = /^[A-Za-z]:[\\/]/.test(value);
    const uncAbsolute = /^(?:\\\\|\/\/)[^\\/]+[\\/]+[^\\/]+/.test(value);
    return driveAbsolute || uncAbsolute;
  }

  if (!posix.isAbsolute(value)) return false;
  return !/^[A-Za-z]:[\\/]/.test(value) && !/^\\\\/.test(value) && !/^\/\//.test(value);
}

function hasDotSegment(value: string): boolean {
  return value.split(/[\\/]/).some((part) => part === '.' || part === '..');
}

async function findEnclosingProjectRoots(workspacePath: string): Promise<string[]> {
  const pathOps = process.platform === 'win32' ? win32 : posix;
  const normalized = pathOps.normalize(workspacePath);
  const root = pathOps.parse(normalized).root;
  const walkStart = normalized.length > root.length
    ? normalized.replace(/[\\/]+$/, '')
    : normalized;
  const candidates = [walkStart];
  const canonical = await tryRealpath(walkStart);
  if (canonical && canonical !== walkStart) candidates.push(canonical);

  const roots: string[] = [];
  for (const candidate of candidates) {
    if (await hasProjectMarker(candidate, pathOps)) continue;

    let current = pathOps.dirname(candidate);
    let guard = 0;
    while (current !== candidate && guard++ <= 128) {
      if (!(await resolveUnsafeCwdReason(current))) {
        if (await hasProjectMarker(current, pathOps)) {
          roots.push(current);
          break;
        }
      }
      const parent = pathOps.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return [...new Set(roots)];
}

async function hasProjectMarker(path: string, pathOps: typeof posix | typeof win32): Promise<boolean> {
  try {
    const memories = await stat(pathOps.join(path, '.memories'));
    if (memories.isDirectory()) return true;
  } catch {
  }

  try {
    await stat(pathOps.join(path, '.git'));
    return true;
  } catch {
    return false;
  }
}

export function getWorkspaceFromRootUri(uri: string): string | undefined {
  if (!uri.toLowerCase().startsWith('file://')) return undefined;

  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

export function getWorkspaceFromRoots(roots?: WorkspaceRoot[] | null): string | undefined {
  if (!roots || roots.length === 0) return undefined;

  for (const root of roots) {
    const path = getWorkspaceFromRootUri(root.uri);
    if (path) return path;
  }

  return undefined;
}

function getWorkspaceRootCandidates(roots?: WorkspaceRoot[] | null): string[] {
  if (!roots || roots.length === 0) return [];
  return roots
    .map((root) => getWorkspaceFromRootUri(root.uri))
    .filter((path): path is string => path !== undefined);
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^[/\\]{2}/.test(value);
}

function normalizePosixPathKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$|^\s+|\s+$/g, '');
}

function normalizeWindowsPathKey(value: string): string {
  return win32.normalize(value).replace(/[\\/]+$/g, '').toLowerCase();
}

export function normalizePathKeyForSafetyCheck(value: string): string {
  if (isWindowsPath(value)) {
    return normalizeWindowsPathKey(value).replace(/\\/g, '/');
  }
  return normalizePosixPathKey(value);
}

function pathsEqualForSafetyCheck(left: string, right: string): boolean {
  if (isWindowsPath(left) || isWindowsPath(right)) {
    return normalizeWindowsPathKey(left) === normalizeWindowsPathKey(right);
  }
  return normalizePosixPathKey(left) === normalizePosixPathKey(right);
}

/**
 * Explain why a cwd-sourced workspace path is unsafe to use implicitly.
 * Explicit workspace arguments, env overrides, and MCP roots are handled by callers.
 */
export function getUnsafeCwdWorkspaceReason(
  workspacePath: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const trimmed = workspacePath.trim();
  if (!trimmed) return undefined;

  if (trimmed === '~' || trimmed === '~/' || trimmed === '~\\') {
    return 'home directory';
  }

  if (trimmed === '/') {
    return 'filesystem root';
  }

  const homeCandidates = [env.HOME, env.USERPROFILE, homedir()].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  if (homeCandidates.some((home) => pathsEqualForSafetyCheck(trimmed, home))) {
    return 'home directory';
  }

  if (isWindowsPath(trimmed)) {
    const normalized = normalizeWindowsPathKey(trimmed);
    const parsedRoot = normalizeWindowsPathKey(win32.parse(trimmed).root);
    if (parsedRoot && normalized === parsedRoot) {
      return 'filesystem root';
    }

    if (/^[a-z]:\\windows(?:\\|$)/.test(normalized)) {
      return 'Windows system directory';
    }

    const windowsHomeRoot = /^[a-z]:\\users\\[^\\]+$/.test(normalized)
      || /^[a-z]:\\documents and settings\\[^\\]+$/.test(normalized);
    if (windowsHomeRoot) {
      return 'home directory';
    }
  }

  return undefined;
}

/**
 * Async, realpath-aware variant of `getUnsafeCwdWorkspaceReason`.
 *
 * The sync function compares cwd against HOME/USERPROFILE via string equality,
 * which fails when the two paths differ only by a symlink (macOS: cwd resolves
 * to `/private/var/...` while HOME is `/var/...`). That would let a home cwd
 * slip past the guard and let `.memories/` be written into home. This helper
 * canonicalizes cwd and each home candidate through `realpath` before
 * delegating to the sync checker; on any realpath failure (non-existent path,
 * broken symlink, permission) it falls back to the sync string comparison so
 * existing behavior with fake/abstract paths is preserved.
 *
 * Use this in async call sites (server hydration, parent walk, recovery).
 */
export async function resolveUnsafeCwdReason(
  workspacePath: string,
  env: Record<string, string | undefined> = process.env
): Promise<string | undefined> {
  // Cheap path: the sync check handles `/`, `~`, Windows system dirs, and
  // exact/trailing-slash home matches without any filesystem access. If it
  // already flags the path, we're done.
  const syncReason = getUnsafeCwdWorkspaceReason(workspacePath, env);
  if (syncReason) return syncReason;

  // Otherwise, the sync check said "safe" — but cwd and HOME may be the same
  // dir under different symlink forms. Re-check home equality via realpath.
  const homeCandidates = [env.HOME, env.USERPROFILE, homedir()].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );
  if (homeCandidates.length === 0) return undefined;

  const cwdReal = await tryRealpath(workspacePath);
  if (cwdReal === undefined) return undefined; // couldn't canonicalize cwd; trust the sync "safe"

  for (const home of homeCandidates) {
    const homeReal = await tryRealpath(home);
    if (homeReal !== undefined && homeReal === cwdReal) {
      return 'home directory';
    }
  }
  return undefined;
}

async function tryRealpath(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/**
 * Walk upward from `cwd` (inclusive) to the filesystem root, looking for a
 * directory containing `.memories/` (preferred) or `.git/` (file or dir). The
 * first safe match wins and becomes the workspace root.
 *
 * Recovery helper for the cwd fallback in the resolution chain. Safe to call
 * on any cwd; returns `undefined` when no marker is found.
 *
 * Safety: any candidate that `getUnsafeCwdWorkspaceReason` flags (home dir,
 * filesystem root, Windows system dirs) is skipped — it never matches there.
 * This closes the regression where a user who `git init`s their home dir for
 * dotfile tracking would otherwise have the walk match `$HOME/.git` and write
 * `.memories/` into home (the original v1 silent-home-write bug).
 *
 * The walk uses the raw `path.dirname` chain (no `realpath` of the whole chain
 * up front) so which marker is found reflects the path the caller actually
 * used, not a canonicalized one.
 *
 * Pure with respect to the registry: this helper does NOT import registry.ts,
 * avoiding a module cycle (registry.ts already imports from workspace.ts).
 */
export async function parentWalkWorkspace(
  cwd: string,
  opts: { env?: Record<string, string | undefined> } = {}
): Promise<RecoveredWorkspace | undefined> {
  const env = opts.env ?? process.env;

  // Walk from cwd (inclusive) up to the root. On each level, check .memories/
  // first (preferred), then .git/. Skip any candidate flagged as unsafe.
  const pathOps = isWindowsPath(cwd) ? win32 : posix;
  let current = cwd;
  // Guard against infinite loops on degenerate input; the dirname walk is
  // naturally bounded because dirname(root) === root.
  let guard = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (guard++ > 128) break;

    // realpath-aware unsafe check so a home dir reached via a symlink form
    // (macOS /var vs /private/var) is still skipped, not matched.
    const unsafe = await resolveUnsafeCwdReason(current, env);
    if (!unsafe) {
      // Prefer .memories/ at this level.
      try {
        const memoriesStat = await stat(pathOps.join(current, '.memories'));
        if (memoriesStat.isDirectory()) {
          return { path: current, source: 'walk' };
        }
      } catch {
        // no .memories/ here
      }

      // Fall back to .git/ (file or dir) — enables first use in a git repo
      // that has not yet saved a checkpoint.
      try {
        await stat(pathOps.join(current, '.git'));
        return { path: current, source: 'walk' };
      } catch {
        // no .git/ here
      }
    }

    const parent = pathOps.dirname(current);
    // dirname of a root returns the root itself; stop when we can't go higher.
    if (parent === current) break;
    current = parent;
  }

  return undefined;
}

export function assertProjectWorkspace(workspace: string | undefined, toolName: string): void {
  if (workspace === 'all') {
    throw new Error(`workspace="all" is only valid for recall, not ${toolName}`);
  }
}

// ─── Project-level .memories/ storage ────────────────────────────────

/** Get the .memories/ directory path for a verified project root. */
export function getMemoriesDir(projectPath?: string): string {
  if (!projectPath) throw new Error(WORKSPACE_UNBOUND_MESSAGE);
  return join(projectPath, '.memories');
}

/** Get the .memories/briefs/ directory path for a verified project root. */
export function getBriefsDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'briefs');
}

/** Get the .memories/plans/ directory path for a verified project root. */
export function getPlansDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'plans');
}

export function getGoldfishHomeDir(): string {
  if (process.env.GOLDFISH_HOME) return process.env.GOLDFISH_HOME;
  const homeDir = process.env.HOME || process.env.USERPROFILE || tmpdir();
  return join(homeDir, '.goldfish');
}

/** Ensure .memories/ and .memories/briefs/ exist for a verified project root. */
export async function ensureMemoriesDir(projectPath?: string): Promise<void> {
  const briefsDir = getBriefsDir(projectPath);

  await mkdir(briefsDir, { recursive: true });
}
