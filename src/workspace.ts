/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each project stores
 * its memories in a local .memories/ directory.
 */

import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
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
 * Resolve the effective workspace path.
 * Priority: explicit arg > GOLDFISH_WORKSPACE env var > roots > process.cwd()
 */
export function resolveWorkspace(explicit?: string, options: ResolveWorkspaceOptions = {}): string {
  if (explicit && explicit !== 'current') return explicit;
  const fromEnv = options.env ?? process.env.GOLDFISH_WORKSPACE;
  if (fromEnv) return fromEnv;
  const fromRoots = getWorkspaceFromRoots(options.roots);
  if (fromRoots) return fromRoots;
  return options.cwd ?? process.cwd();
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
 * Ensure .memories/, .memories/briefs/, and .memories/plans/ directories exist for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export async function ensureMemoriesDir(projectPath?: string): Promise<void> {
  const briefsDir = getBriefsDir(projectPath);
  const plansDir = getPlansDir(projectPath);

  await Promise.all([
    mkdir(briefsDir, { recursive: true }),
    mkdir(plansDir, { recursive: true })
  ]);
}
