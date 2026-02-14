/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each project stores
 * its memories in a local .memories/ directory.
 */

import { join } from 'path';
import { mkdir } from 'fs/promises';

/**
 * Normalize a workspace identifier (path or name) to a simple name
 *
 * Examples:
 *   /Users/murphy/source/goldfish → goldfish
 *   C:\source\goldfish → goldfish
 *   @coa/goldfish-mcp → coa-goldfish-mcp
 *   My Project! → my-project-
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

// ─── Project-level .memories/ storage ────────────────────────────────

/**
 * Get the .memories/ directory path for a project.
 * Falls back to process.cwd() if no projectPath is provided.
 */
export function getMemoriesDir(projectPath?: string): string {
  const base = projectPath ?? process.cwd();
  return join(base, '.memories');
}

/**
 * Get the .memories/plans/ directory path for a project.
 * Falls back to process.cwd() if no projectPath is provided.
 */
export function getPlansDir(projectPath?: string): string {
  return join(getMemoriesDir(projectPath), 'plans');
}

/**
 * Ensure .memories/ and .memories/plans/ directories exist for a project.
 * Falls back to process.cwd() if no projectPath is provided.
 */
export async function ensureMemoriesDir(projectPath?: string): Promise<void> {
  const plansDir = getPlansDir(projectPath);
  // Creating plans/ with recursive:true also creates .memories/ parent
  await mkdir(plansDir, { recursive: true });
}
