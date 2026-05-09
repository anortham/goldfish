/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each project stores
 * its memories in a local .memories/ directory.
 */

import { mkdir } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join, win32 } from 'path';
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
 * - 'env':     GOLDFISH_WORKSPACE was set
 * - 'roots':   came from MCP roots/list
 * - 'cwd':     fell back to process.cwd() — least trustworthy on desktop MCP clients
 */
export type WorkspaceSource = 'explicit' | 'env' | 'roots' | 'cwd';

export interface ResolvedWorkspace {
  path: string;
  source: WorkspaceSource;
}

/**
 * Resolve the effective workspace path.
 * Priority: explicit arg > GOLDFISH_WORKSPACE env var > roots > process.cwd()
 */
export function resolveWorkspace(explicit?: string, options: ResolveWorkspaceOptions = {}): string {
  return resolveWorkspaceWithSource(explicit, options).path;
}

/**
 * Resolve the effective workspace path along with the source it came from.
 * Callers (e.g., MCP tool handlers) can use the source tag to apply policy:
 * cwd-sourced filesystem roots are unsafe defaults on desktop MCP clients.
 */
export function resolveWorkspaceWithSource(
  explicit?: string,
  options: ResolveWorkspaceOptions = {}
): ResolvedWorkspace {
  if (explicit && explicit !== 'current') {
    return { path: explicit, source: 'explicit' };
  }
  const fromEnv = options.env ?? process.env.GOLDFISH_WORKSPACE;
  if (fromEnv) return { path: fromEnv, source: 'env' };
  const fromRoots = getWorkspaceFromRoots(options.roots);
  if (fromRoots) return { path: fromRoots, source: 'roots' };
  return { path: options.cwd ?? process.cwd(), source: 'cwd' };
}

export function getWorkspaceFromRootUri(uri: string): string | undefined {
  if (!uri.startsWith('file://')) return undefined;

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

export function assertProjectWorkspace(workspace: string | undefined, toolName: string): void {
  if (workspace === 'all') {
    throw new Error(`workspace="all" is only valid for recall, not ${toolName}`);
  }
}

// ─── Project-level .memories/ storage ────────────────────────────────

/**
 * Get the .memories/ directory path for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export function getMemoriesDir(projectPath?: string): string {
  const base = projectPath ?? resolveWorkspace();
  return join(base, '.memories');
}

/**
 * Get the .memories/briefs/ directory path for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export function getBriefsDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'briefs');
}

/**
 * Get the .memories/plans/ directory path for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export function getPlansDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'plans');
}

export function getGoldfishHomeDir(): string {
  if (process.env.GOLDFISH_HOME) return process.env.GOLDFISH_HOME;
  const homeDir = process.env.HOME || process.env.USERPROFILE || tmpdir();
  return join(homeDir, '.goldfish');
}

/**
 * Ensure .memories/ and .memories/briefs/ directories exist for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export async function ensureMemoriesDir(projectPath?: string): Promise<void> {
  const briefsDir = getBriefsDir(projectPath);

  await mkdir(briefsDir, { recursive: true });
}
