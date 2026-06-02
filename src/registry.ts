/**
 * Cross-project registry for Goldfish.
 *
 * Manages a registry at ~/.goldfish/registry.json that tracks which projects
 * use Goldfish. Enables cross-project recall (standup reports, timeline aggregation).
 */

import { join, resolve } from 'path';
import { mkdir, stat, rename } from 'fs/promises';
import { randomBytes } from 'crypto';
import { atomicWriteFile } from './file-io';
import { withLock } from './lock';
import { normalizeWorkspace, getGoldfishHomeDir } from './workspace';
import { getLogger } from './logger';
import type { Registry, RegisteredProject } from './types';

/**
 * Normalize a path to forward slashes for consistent cross-platform storage.
 * Windows `resolve()` returns backslashes; we normalize to `/` so registry
 * entries are portable and comparable regardless of OS.
 */
function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, '/');
}

/**
 * Returns the default registry file path: ~/.goldfish/registry.json
 * Respects GOLDFISH_HOME env var via getGoldfishHomeDir().
 */
export function getRegistryPath(): string {
  return join(getGoldfishHomeDir(), 'registry.json');
}

/**
 * Read and parse the registry file.
 * Returns empty registry if file doesn't exist or is corrupted.
 *
 * @param registryDir - Directory containing registry.json (defaults to ~/.goldfish)
 */
export async function getRegistry(registryDir?: string): Promise<Registry> {
  const dir = registryDir ?? getGoldfishHomeDir();
  const filePath = join(dir, 'registry.json');

  try {
    const content = await Bun.file(filePath).text();
    const parsed = JSON.parse(content);
    // Basic validation: ensure it has a projects array
    if (parsed && Array.isArray(parsed.projects)) {
      return parsed as Registry;
    }
    return { projects: [] };
  } catch {
    // File doesn't exist (ENOENT) or invalid JSON - return empty
    return { projects: [] };
  }
}

/**
 * Read the registry for a mutation. Unlike getRegistry (the read path), a
 * corrupt registry file here is NOT silently swallowed: overwriting it would
 * permanently drop every other registered project. Instead the corrupt file is
 * renamed aside to registry.json.corrupt-<ts>-<rand> so the data is recoverable,
 * then we start fresh. Callers must already hold the registry lock.
 *
 * @param filePath - Absolute path to registry.json
 */
async function loadRegistryForWrite(filePath: string): Promise<Registry> {
  let content: string;
  try {
    content = await Bun.file(filePath).text();
  } catch {
    // File doesn't exist yet - a fresh registry is the correct starting point.
    return { projects: [] };
  }

  try {
    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.projects)) {
      return parsed as Registry;
    }
    // Parsed but structurally wrong (e.g. {} or an array) - treat as corrupt.
  } catch {
    // Invalid JSON - fall through to backup.
  }

  const backupPath = `${filePath}.corrupt-${Date.now()}-${randomBytes(4).toString('hex')}`;
  try {
    await rename(filePath, backupPath);
    getLogger().warn(
      `registry at ${filePath} is corrupt; backed up to ${backupPath} and reinitialized`
    );
  } catch (error: any) {
    // If we cannot preserve the corrupt file, fail loudly rather than wipe it.
    throw new Error(
      `registry at ${filePath} is corrupt and could not be backed up: ${error?.message ?? 'rename failed'}`
    );
  }

  return { projects: [] };
}

/**
 * Register a project in the cross-project registry.
 * Idempotent - if the project path already exists, this is a no-op.
 *
 * @param projectPath - Path to the project root
 * @param registryDir - Directory containing registry.json (defaults to ~/.goldfish)
 */
export async function registerProject(projectPath: string, registryDir?: string): Promise<void> {
  const dir = registryDir ?? getGoldfishHomeDir();
  const absolutePath = normalizePath(projectPath);
  const filePath = join(dir, 'registry.json');

  // Ensure directory exists before acquiring lock (lock file needs the dir)
  await mkdir(dir, { recursive: true });

  await withLock(filePath, async () => {
    // Read current registry (inside lock to prevent races). Use the write-path
    // loader so a corrupt file is preserved, not silently overwritten.
    const registry = await loadRegistryForWrite(filePath);

    // Check for existing entry (idempotent, normalize stored paths for comparison)
    const exists = registry.projects.some(p => p.path.replace(/\\/g, '/') === absolutePath);
    if (exists) {
      return;
    }

    // Add new entry
    const entry: RegisteredProject = {
      path: absolutePath,
      name: normalizeWorkspace(absolutePath),
      registered: new Date().toISOString(),
    };
    registry.projects.push(entry);

    await atomicWriteFile(filePath, JSON.stringify(registry, null, 2));
  });
}

/**
 * Remove a project from the registry.
 * No-op if the project is not registered.
 *
 * @param projectPath - Path to the project root
 * @param registryDir - Directory containing registry.json (defaults to ~/.goldfish)
 */
export async function unregisterProject(projectPath: string, registryDir?: string): Promise<void> {
  const dir = registryDir ?? getGoldfishHomeDir();
  const absolutePath = normalizePath(projectPath);
  const filePath = join(dir, 'registry.json');

  // Ensure directory exists before acquiring lock (lock file needs the dir)
  await mkdir(dir, { recursive: true });

  await withLock(filePath, async () => {
    // loadRegistryForWrite backs up + heals a corrupt file rather than leaving
    // the corruption to silently break every later read.
    const registry = await loadRegistryForWrite(filePath);

    const filtered = registry.projects.filter(p => p.path.replace(/\\/g, '/') !== absolutePath);

    // Only write if something changed
    if (filtered.length !== registry.projects.length) {
      registry.projects = filtered;

      await atomicWriteFile(filePath, JSON.stringify(registry, null, 2));
    }
  });
}

/**
 * List registered projects that have an active .memories/ directory.
 * Stale entries (where .memories/ doesn't exist) are filtered from the result
 * but NOT removed from the registry file.
 *
 * @param registryDir - Directory containing registry.json (defaults to ~/.goldfish)
 * @returns Projects sorted by name, filtered to only those with .memories/
 */
export async function listRegisteredProjects(registryDir?: string): Promise<RegisteredProject[]> {
  const dir = registryDir ?? getGoldfishHomeDir();
  const registry = await getRegistry(dir);

  // Check which projects have .memories/ directories
  const validProjects: RegisteredProject[] = [];

  for (const project of registry.projects) {
    try {
      const memoriesPath = `${project.path}/.memories`;
      const stats = await stat(memoriesPath);
      if (stats.isDirectory()) {
        validProjects.push(project);
      }
    } catch {
      // .memories/ doesn't exist or not accessible - skip (stale)
    }
  }

  // Sort by name
  validProjects.sort((a, b) => a.name.localeCompare(b.name));

  return validProjects;
}
