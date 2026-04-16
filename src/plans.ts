/**
 * Plan and brief storage management.
 *
 * New writes land in:
 * {project}/.memories/briefs/{id}.md
 *
 * Legacy reads still support:
 * {project}/.memories/plans/{id}.md
 *
 * New active state is tracked in:
 * {project}/.memories/.active-brief
 *
 * Legacy reads still support:
 * {project}/.memories/.active-plan
 */

import { join } from 'path';
import { readFile, readdir, unlink } from 'fs/promises';
import { atomicWriteFile } from './file-io';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Plan, PlanInput, PlanUpdate } from './types';
import {
  getMemoriesDir,
  getBriefsDir,
  getPlansDir,
  ensureMemoriesDir,
  resolveWorkspace
} from './workspace';
import { withLock } from './lock';

type StoredPlan = {
  plan: Plan;
  path: string;
};

const VALID_PLAN_STATUSES = new Set(['active', 'completed', 'archived']);
const ACTIVE_BRIEF_FILENAME = '.active-brief';
const ACTIVE_PLAN_FILENAME = '.active-plan';

function assertValidPlanStatus(status: unknown): asserts status is Plan['status'] {
  if (typeof status !== 'string' || !VALID_PLAN_STATUSES.has(status)) {
    throw new Error(`Invalid plan status '${status}'. Expected active, completed, or archived.`);
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

async function readPlanAtPath(planPath: string): Promise<Plan | null> {
  try {
    const content = await readFile(planPath, 'utf-8');
    return parsePlanFile(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getStoredPlan(projectPath: string, id: string): Promise<StoredPlan | null> {
  validatePlanId(id);

  const briefPath = getBriefPath(projectPath, id);
  const brief = await readPlanAtPath(briefPath);
  if (brief) {
    return { plan: brief, path: briefPath };
  }

  const legacyPlanPath = getLegacyPlanPath(projectPath, id);
  const legacyPlan = await readPlanAtPath(legacyPlanPath);
  if (legacyPlan) {
    return { plan: legacyPlan, path: legacyPlanPath };
  }

  return null;
}

async function listPlanIds(dirPath: string): Promise<string[]> {
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

async function resolveActivePlanId(projectPath: string): Promise<string | null> {
  for (const markerPath of [getActiveBriefPath(projectPath), getLegacyActivePlanPath(projectPath)]) {
    try {
      const planId = (await readFile(markerPath, 'utf-8')).trim();
      if (planId) {
        return planId;
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
    const activePlanId = (await readFile(markerPath, 'utf-8')).trim();
    if (activePlanId === id) {
      await unlink(markerPath);
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Format a plan as markdown with YAML frontmatter
 */
export function formatPlanFile(plan: Plan): string {
  const frontmatter = {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    created: plan.created,
    updated: plan.updated,
    tags: plan.tags
  };

  const yaml = stringifyYaml(frontmatter).trim();
  return `---\n${yaml}\n---\n\n${plan.content}\n`;
}

/**
 * Parse a plan markdown file (YAML frontmatter + content)
 */
export function parsePlanFile(content: string): Plan {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]+?)\n---\n\n?([\s\S]*)$/);

  if (!match) {
    throw new Error('Invalid plan file: missing YAML frontmatter');
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
    throw new Error(`Invalid plan file: YAML parsing failed - ${error}`);
  }
}

function generatePlanId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 50);

  if (base.length > 0) {
    return base;
  }

  const fallback = `plan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return fallback.substring(0, 50);
}

function validatePlanId(id: string): void {
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    throw new Error(`Invalid plan ID '${id}': must not contain path separators or traversal sequences`);
  }
}

/**
 * Save a new plan. Compatibility wrapper for the new brief storage path.
 */
export async function savePlan(input: PlanInput): Promise<Plan> {
  const projectPath = resolveWorkspace(input.workspace);
  await ensureMemoriesDir(projectPath);

  const now = new Date().toISOString();
  const id = input.id || generatePlanId(input.title);
  const status = input.status ?? 'active';
  validatePlanId(id);
  assertValidPlanStatus(status);

  const plan: Plan = {
    id,
    title: input.title,
    content: input.content,
    status,
    created: now,
    updated: now,
    tags: input.tags || []
  };

  const planPath = getBriefPath(projectPath, id);
  const content = formatPlanFile(plan);

  await withLock(planPath, async () => {
    const existing = await getStoredPlan(projectPath, id);
    if (existing) {
      throw new Error(`Plan with ID '${id}' already exists`);
    }

    await atomicWriteFile(planPath, content);
  });

  if (plan.status === 'active' && input.activate !== false) {
    await setActivePlan(projectPath, id);
  }

  return plan;
}

export async function saveBrief(input: PlanInput): Promise<Plan> {
  return savePlan(input);
}

/**
 * Get a plan by ID.
 */
export async function getPlan(projectPath: string, id: string): Promise<Plan | null> {
  const stored = await getStoredPlan(projectPath, id);
  return stored?.plan ?? null;
}

export async function getBrief(projectPath: string, id: string): Promise<Plan | null> {
  return getPlan(projectPath, id);
}

/**
 * List all plans in a workspace (sorted by updated date, newest first)
 */
export async function listPlans(projectPath: string): Promise<Plan[]> {
  const ids = new Set([
    ...await listPlanIds(getBriefsDir(projectPath)),
    ...await listPlanIds(getPlansDir(projectPath))
  ]);

  const plans = await Promise.all(
    [...ids].map(async (id) => getPlan(projectPath, id))
  );

  return plans
    .filter((plan): plan is Plan => plan !== null)
    .sort((a, b) =>
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
}

export async function listBriefs(projectPath: string): Promise<Plan[]> {
  return listPlans(projectPath);
}

/**
 * Get the currently active plan for a workspace.
 */
export async function getActivePlan(projectPath: string): Promise<Plan | null> {
  const planId = await resolveActivePlanId(projectPath);
  if (!planId) {
    return null;
  }

  const plan = await getPlan(projectPath, planId);
  if (plan && plan.status !== 'active') {
    return null;
  }

  return plan;
}

export async function getActiveBrief(projectPath: string): Promise<Plan | null> {
  return getActivePlan(projectPath);
}

/**
 * Set the active plan for a workspace.
 */
export async function setActivePlan(projectPath: string, planId: string): Promise<void> {
  validatePlanId(planId);

  const plan = await getPlan(projectPath, planId);
  if (!plan) {
    throw new Error(`Plan '${planId}' does not exist`);
  }
  if (plan.status !== 'active') {
    throw new Error(`Cannot activate plan '${planId}' with status '${plan.status}'`);
  }

  const activePlanPath = getActiveBriefPath(projectPath);
  await withLock(activePlanPath, async () => {
    await atomicWriteFile(activePlanPath, planId);
  });
}

export async function setActiveBrief(projectPath: string, planId: string): Promise<void> {
  await setActivePlan(projectPath, planId);
}

/**
 * Update an existing plan.
 */
export async function updatePlan(
  projectPath: string,
  id: string,
  updates: PlanUpdate
): Promise<void> {
  validatePlanId(id);

  const stored = await getStoredPlan(projectPath, id);
  if (!stored) {
    throw new Error(`Plan '${id}' does not exist`);
  }

  await withLock(stored.path, async () => {
    const current = await getStoredPlan(projectPath, id);
    if (!current) {
      throw new Error(`Plan '${id}' does not exist`);
    }
    if (updates.status !== undefined) {
      assertValidPlanStatus(updates.status);
    }

    const updatedPlan: Plan = {
      ...current.plan,
      ...updates,
      updated: new Date().toISOString()
    };

    if (updatedPlan.status === 'completed' && current.plan.status !== 'completed') {
      updatedPlan.content = updatedPlan.content.replace(/- \[ \]/g, '- [x]');
    }

    const content = formatPlanFile(updatedPlan);
    await atomicWriteFile(current.path, content);
  });
}

export async function updateBrief(
  projectPath: string,
  id: string,
  updates: PlanUpdate
): Promise<void> {
  await updatePlan(projectPath, id, updates);
}

/**
 * Delete a plan.
 */
export async function deletePlan(projectPath: string, id: string): Promise<void> {
  validatePlanId(id);

  const stored = await getStoredPlan(projectPath, id);
  if (!stored) {
    throw new Error(`Plan '${id}' does not exist`);
  }

  await withLock(stored.path, async () => {
    const current = await getStoredPlan(projectPath, id);
    if (!current) {
      throw new Error(`Plan '${id}' does not exist`);
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

export async function deleteBrief(projectPath: string, id: string): Promise<void> {
  await deletePlan(projectPath, id);
}
