/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each project stores
 * its memories in a local .memories/ directory.
 */

import { createHash } from 'crypto';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

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

    // Get last path component
    name = name.replace(/^.*[/\\]/, '');
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
 * Priority: explicit arg > GOLDFISH_WORKSPACE env var > process.cwd()
 */
export function resolveWorkspace(explicit?: string): string {
  if (explicit && explicit !== 'current') return explicit;
  const fromEnv = process.env.GOLDFISH_WORKSPACE;
  if (fromEnv) return fromEnv;
  return process.cwd();
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
 * Get the .memories/plans/ directory path for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export function getPlansDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'plans');
}

export function getGoldfishHomeDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || tmpdir();
  return join(homeDir, '.goldfish');
}

export function getModelCacheDir(): string {
  return join(getGoldfishHomeDir(), 'models', 'transformers');
}

export function getSemanticWorkspaceKey(projectPath: string): string {
  const normalizedPath = resolve(projectPath);

  return createHash('sha256')
    .update(normalizedPath)
    .digest('hex')
    .slice(0, 12);
}

export function getSemanticCacheDir(projectPath?: string): string {
  const workspacePath = resolveWorkspace(projectPath);
  return join(
    getGoldfishHomeDir(),
    'cache',
    'semantic',
    getSemanticWorkspaceKey(workspacePath)
  );
}

/**
 * Ensure .memories/ and .memories/plans/ directories exist for a project.
 * Falls back to resolveWorkspace() if no projectPath is provided.
 */
export async function ensureMemoriesDir(projectPath?: string): Promise<void> {
  const plansDir = getPlansDir(projectPath);
  // Creating plans/ with recursive:true also creates .memories/ parent
  await mkdir(plansDir, { recursive: true });
}
