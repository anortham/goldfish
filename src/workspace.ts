/**
 * Workspace detection and normalization utilities
 *
 * Workspaces represent different projects. Each workspace gets its own
 * isolated storage in ~/.goldfish/{workspace}/
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readdir } from 'fs/promises';

const GOLDFISH_BASE = join(homedir(), '.goldfish');

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

/**
 * Get the current workspace based on process.cwd()
 */
export function getCurrentWorkspace(): string {
  const cwd = process.cwd();
  return normalizeWorkspace(cwd);
}

/**
 * Get the full path for a workspace's storage directory
 */
export function getWorkspacePath(workspace: string): string {
  const normalized = normalizeWorkspace(workspace);
  return join(GOLDFISH_BASE, normalized);
}

/**
 * Ensure workspace directories exist (checkpoints/, plans/)
 */
export async function ensureWorkspaceDir(workspace: string): Promise<void> {
  const basePath = getWorkspacePath(workspace);
  const checkpointsPath = join(basePath, 'checkpoints');
  const plansPath = join(basePath, 'plans');

  await mkdir(checkpointsPath, { recursive: true });
  await mkdir(plansPath, { recursive: true });
}

/**
 * List all workspaces (directories in ~/.goldfish/)
 */
export async function listWorkspaces(): Promise<string[]> {
  try {
    const entries = await readdir(GOLDFISH_BASE, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  } catch (error: any) {
    // If .goldfish doesn't exist yet, return empty array
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get goldfish base directory (mainly for testing)
 */
export function getGoldfishBase(): string {
  return GOLDFISH_BASE;
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
