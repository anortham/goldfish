/**
 * Brief storage management.
 *
 * New writes land in:
 * {project}/.memories/briefs/{id}.md
 *
 * Legacy reads still support:
 * {project}/.memories/plans/{id}.md
 *
 * Active state is tracked in:
 * {project}/.memories/.active-brief
 *
 * Legacy reads still support:
 * {project}/.memories/.active-plan
 */

import { join } from 'path';
import { readFile, readdir, unlink } from 'fs/promises';
import { atomicWriteFile } from './file-io';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Brief, BriefInput, BriefUpdate } from './types';
import {
  getMemoriesDir,
  getBriefsDir,
  getPlansDir,
  ensureMemoriesDir,
  resolveWorkspace
} from './workspace';
import { withLock } from './lock';

type StoredBrief = {
  brief: Brief;
  path: string;
};

const VALID_BRIEF_STATUSES = new Set(['active', 'completed', 'archived']);
const ACTIVE_BRIEF_FILENAME = '.active-brief';
const ACTIVE_PLAN_FILENAME = '.active-plan';

function assertValidBriefStatus(status: unknown): asserts status is Brief['status'] {
  if (typeof status !== 'string' || !VALID_BRIEF_STATUSES.has(status)) {
    throw new Error(`Invalid brief status '${status}'. Expected active, completed, or archived.`);
  }
}

function getBriefPath(projectPath: string, id: string): string {
  return join(getBriefsDir(projectPath), `${id}.md`);
}

function getLegacyPlanPath(projectPath: string, id: string): string {
  return join(getPlansDir(projectPath), `${id}.md`);
}

function getActiveBriefPath(projectPath: string): string {
  return join(getMemoriesDir(projectPath), ACTIVE_BRIEF_FILENAME);
}

function getLegacyActivePlanPath(projectPath: string): string {
  return join(getMemoriesDir(projectPath), ACTIVE_PLAN_FILENAME);
}

async function readBriefAtPath(briefPath: string): Promise<Brief | null> {
  try {
    const content = await readFile(briefPath, 'utf-8');
    return parseBriefFile(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getStoredBrief(projectPath: string, id: string): Promise<StoredBrief | null> {
  validateBriefId(id);

  const briefPath = getBriefPath(projectPath, id);
  const brief = await readBriefAtPath(briefPath);
  if (brief) {
    return { brief, path: briefPath };
  }

  // Legacy read: tolerate briefs that still live under .memories/plans/.
  const legacyPlanPath = getLegacyPlanPath(projectPath, id);
  const legacyBrief = await readBriefAtPath(legacyPlanPath);
  if (legacyBrief) {
    return { brief: legacyBrief, path: legacyPlanPath };
  }

  return null;
}

async function listBriefIds(dirPath: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return files
    .filter(file => file.endsWith('.md') && !file.startsWith('.'))
    .map(file => file.replace(/\.md$/, ''));
}

async function resolveActiveBriefId(projectPath: string): Promise<string | null> {
  for (const markerPath of [getActiveBriefPath(projectPath), getLegacyActivePlanPath(projectPath)]) {
    try {
      const briefId = (await readFile(markerPath, 'utf-8')).trim();
      if (briefId) {
        return briefId;
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return null;
}

async function clearActiveMarkerIfMatch(markerPath: string, id: string): Promise<void> {
  try {
    const activeBriefId = (await readFile(markerPath, 'utf-8')).trim();
    if (activeBriefId === id) {
      await unlink(markerPath);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Format a brief as markdown with YAML frontmatter
 */
export function formatBriefFile(brief: Brief): string {
  const frontmatter = {
    id: brief.id,
    title: brief.title,
    status: brief.status,
    created: brief.created,
    updated: brief.updated,
    tags: brief.tags
  };

  const yaml = stringifyYaml(frontmatter).trim();
  return `---\n${yaml}\n---\n\n${brief.content}\n`;
}

/**
 * Parse a brief markdown file (YAML frontmatter + content)
 */
export function parseBriefFile(content: string): Brief {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]+?)\n---\n\n?([\s\S]*)$/);

  if (!match) {
    throw new Error('Invalid brief file: missing YAML frontmatter');
  }

  const [, yamlContent, markdownContent] = match;

  try {
    const frontmatter = parseYaml(yamlContent!) as {
      id: string;
      title: string;
      status: 'active' | 'completed' | 'archived';
      created: string;
      updated: string;
      tags: string[];
    };

    if (!frontmatter || typeof frontmatter !== 'object' || !frontmatter.id) {
      throw new Error('missing required fields');
    }

    return {
      id: frontmatter.id,
      title: frontmatter.title,
      content: markdownContent!.replace(/\n$/, ''),
      status: frontmatter.status,
      created: frontmatter.created,
      updated: frontmatter.updated,
      tags: frontmatter.tags || []
    };
  } catch (error) {
    throw new Error(`Invalid brief file: YAML parsing failed - ${error}`);
  }
}

function generateBriefId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);

  if (base.length > 0) {
    return base;
  }

  const fallback = `brief-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return fallback.substring(0, 50);
}

function validateBriefId(id: string): void {
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    throw new Error(`Invalid brief ID '${id}': must not contain path separators or traversal sequences`);
  }
}

/**
 * Save a new brief.
 */
export async function saveBrief(input: BriefInput): Promise<Brief> {
  const projectPath = resolveWorkspace(input.workspace);
  await ensureMemoriesDir(projectPath);

  const now = new Date().toISOString();
  const id = input.id || generateBriefId(input.title);
  const status = input.status ?? 'active';
  validateBriefId(id);
  assertValidBriefStatus(status);

  const brief: Brief = {
    id,
    title: input.title,
    content: input.content,
    status,
    created: now,
    updated: now,
    tags: input.tags || []
  };

  const briefPath = getBriefPath(projectPath, id);
  const content = formatBriefFile(brief);

  await withLock(briefPath, async () => {
    const existing = await getStoredBrief(projectPath, id);
    if (existing) {
      throw new Error(`Brief with ID '${id}' already exists`);
    }

    await atomicWriteFile(briefPath, content);
  });

  if (brief.status === 'active' && input.activate !== false) {
    await setActiveBrief(projectPath, id);
  }

  return brief;
}

/**
 * Get a brief by ID.
 */
export async function getBrief(projectPath: string, id: string): Promise<Brief | null> {
  const stored = await getStoredBrief(projectPath, id);
  return stored?.brief ?? null;
}

/**
 * List all briefs in a workspace (sorted by updated date, newest first).
 * Reads from both .memories/briefs/ and the legacy .memories/plans/ directory.
 */
export async function listBriefs(projectPath: string): Promise<Brief[]> {
  const ids = new Set([
    ...await listBriefIds(getBriefsDir(projectPath)),
    ...await listBriefIds(getPlansDir(projectPath))
  ]);

  const briefs = await Promise.all(
    [...ids].map(async (id) => getBrief(projectPath, id))
  );

  return briefs
    .filter((brief): brief is Brief => brief !== null)
    .sort((a, b) =>
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
}

/**
 * Get the currently active brief for a workspace.
 */
export async function getActiveBrief(projectPath: string): Promise<Brief | null> {
  const briefId = await resolveActiveBriefId(projectPath);
  if (!briefId) {
    return null;
  }

  const brief = await getBrief(projectPath, briefId);
  if (brief && brief.status !== 'active') {
    return null;
  }

  return brief;
}

/**
 * Set the active brief for a workspace.
 */
export async function setActiveBrief(projectPath: string, briefId: string): Promise<void> {
  validateBriefId(briefId);

  const brief = await getBrief(projectPath, briefId);
  if (!brief) {
    throw new Error(`Brief '${briefId}' does not exist`);
  }
  if (brief.status !== 'active') {
    throw new Error(`Cannot activate brief '${briefId}' with status '${brief.status}'`);
  }

  const activeBriefPath = getActiveBriefPath(projectPath);
  await withLock(activeBriefPath, async () => {
    await atomicWriteFile(activeBriefPath, briefId);
  });
}

/**
 * Update an existing brief.
 */
export async function updateBrief(
  projectPath: string,
  id: string,
  updates: BriefUpdate
): Promise<void> {
  validateBriefId(id);

  const stored = await getStoredBrief(projectPath, id);
  if (!stored) {
    throw new Error(`Brief '${id}' does not exist`);
  }

  await withLock(stored.path, async () => {
    const current = await getStoredBrief(projectPath, id);
    if (!current) {
      throw new Error(`Brief '${id}' does not exist`);
    }
    if (updates.status !== undefined) {
      assertValidBriefStatus(updates.status);
    }

    const updatedBrief: Brief = {
      ...current.brief,
      ...updates,
      updated: new Date().toISOString()
    };

    if (updatedBrief.status === 'completed' && current.brief.status !== 'completed') {
      updatedBrief.content = updatedBrief.content.replace(/- \[ \]/g, '- [x]');
    }

    const content = formatBriefFile(updatedBrief);
    await atomicWriteFile(current.path, content);
  });
}

/**
 * Delete a brief.
 */
export async function deleteBrief(projectPath: string, id: string): Promise<void> {
  validateBriefId(id);

  const stored = await getStoredBrief(projectPath, id);
  if (!stored) {
    throw new Error(`Brief '${id}' does not exist`);
  }

  await withLock(stored.path, async () => {
    const current = await getStoredBrief(projectPath, id);
    if (!current) {
      throw new Error(`Brief '${id}' does not exist`);
    }

    await unlink(current.path);

    const activeBriefPath = getActiveBriefPath(projectPath);
    await withLock(activeBriefPath, async () => {
      await clearActiveMarkerIfMatch(activeBriefPath, id);
    });

    const legacyActivePlanPath = getLegacyActivePlanPath(projectPath);
    await withLock(legacyActivePlanPath, async () => {
      await clearActiveMarkerIfMatch(legacyActivePlanPath, id);
    });
  });
}
