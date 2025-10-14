/**
 * Plan storage and management
 *
 * Plans are stored as individual markdown files with YAML frontmatter:
 * ~/.goldfish/{workspace}/plans/{plan-id}.md
 *
 * Active plan is tracked in: ~/.goldfish/{workspace}/.active-plan
 */

import { join } from 'path';
import { readFile, writeFile, readdir, unlink, rename } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Plan, PlanInput, PlanUpdate } from './types';
import { getWorkspacePath, ensureWorkspaceDir, getCurrentWorkspace } from './workspace';
import { withLock } from './lock';

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
  return `---\n${yaml}\n---\n\n${plan.content}`;
}

/**
 * Parse a plan markdown file (YAML frontmatter + content)
 */
export function parsePlanFile(content: string): Plan {
  // Extract frontmatter
  const match = content.match(/^---\n([\s\S]+?)\n---\n\n([\s\S]*)$/);

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

    return {
      id: frontmatter.id,
      title: frontmatter.title,
      content: markdownContent!,
      status: frontmatter.status,
      created: frontmatter.created,
      updated: frontmatter.updated,
      tags: frontmatter.tags || []
    };
  } catch (error) {
    throw new Error(`Invalid plan file: YAML parsing failed - ${error}`);
  }
}

/**
 * Generate a plan ID from title (if not provided)
 */
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

/**
 * Save a new plan
 */
export async function savePlan(input: PlanInput): Promise<Plan> {
  const workspace = input.workspace || getCurrentWorkspace();
  await ensureWorkspaceDir(workspace);

  const now = new Date().toISOString();
  const id = input.id || generatePlanId(input.title);

  const plan: Plan = {
    id,
    title: input.title,
    content: input.content,
    status: input.status || 'active',
    created: now,
    updated: now,
    tags: input.tags || []
  };

  // Write plan file atomically (fail if exists - prevents TOCTOU race)
  const planPath = join(getWorkspacePath(workspace), 'plans', `${id}.md`);
  const content = formatPlanFile(plan);

  try {
    // Use 'wx' flag for exclusive create (fails if file exists)
    await writeFile(planPath, content, { flag: 'wx', encoding: 'utf-8' });
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      throw new Error(`Plan with ID '${id}' already exists`);
    }
    throw error;
  }

  // Auto-activate if requested (default: false)
  if (input.activate) {
    await setActivePlan(workspace, id);
  }

  return plan;
}

/**
 * Get a plan by ID
 */
export async function getPlan(workspace: string, id: string): Promise<Plan | null> {
  const planPath = join(getWorkspacePath(workspace), 'plans', `${id}.md`);

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

/**
 * List all plans in a workspace (sorted by updated date, newest first)
 */
export async function listPlans(workspace: string): Promise<Plan[]> {
  const plansDir = join(getWorkspacePath(workspace), 'plans');

  let files: string[];
  try {
    files = await readdir(plansDir);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const planFiles = files.filter(file => {
    if (!file.endsWith('.md')) return false;
    if (file.startsWith('.')) return false;  // Skip .active-plan
    return true;
  });

  const plans = await Promise.all(
    planFiles.map(async (file) => {
      const id = file.replace('.md', '');
      return getPlan(workspace, id);
    })
  );

  // Sort by updated date (newest first)
  return plans
    .filter((plan): plan is Plan => plan !== null)
    .sort((a, b) =>
      new Date(b.updated).getTime() - new Date(a.updated).getTime()
    );
}

/**
 * Get the currently active plan for a workspace
 */
export async function getActivePlan(workspace: string): Promise<Plan | null> {
  const activePlanPath = join(getWorkspacePath(workspace), '.active-plan');

  try {
    const planId = (await readFile(activePlanPath, 'utf-8')).trim();
    return await getPlan(workspace, planId);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Set the active plan for a workspace
 */
export async function setActivePlan(workspace: string, planId: string): Promise<void> {
  // Verify plan exists
  const plan = await getPlan(workspace, planId);
  if (!plan) {
    throw new Error(`Plan '${planId}' does not exist`);
  }

  const activePlanPath = join(getWorkspacePath(workspace), '.active-plan');

  // Write atomically
  const tempPath = `${activePlanPath}.tmp.${Date.now()}`;
  await writeFile(tempPath, planId, 'utf-8');
  await rename(tempPath, activePlanPath);
}

/**
 * Update an existing plan
 */
export async function updatePlan(
  workspace: string,
  id: string,
  updates: PlanUpdate
): Promise<void> {
  const planPath = join(getWorkspacePath(workspace), 'plans', `${id}.md`);

  // Use file lock to prevent race conditions on concurrent updates
  await withLock(planPath, async () => {
    const plan = await getPlan(workspace, id);
    if (!plan) {
      throw new Error(`Plan '${id}' does not exist`);
    }

    // Apply updates
    const updatedPlan: Plan = {
      ...plan,
      ...updates,
      updated: new Date().toISOString()
    };

    // Write updated plan (atomic)
    const content = formatPlanFile(updatedPlan);
    const tempPath = `${planPath}.tmp.${Date.now()}`;
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, planPath);
  });
}

/**
 * Delete a plan
 */
export async function deletePlan(workspace: string, id: string): Promise<void> {
  const planPath = join(getWorkspacePath(workspace), 'plans', `${id}.md`);
  const activePlanPath = join(getWorkspacePath(workspace), '.active-plan');

  let shouldClearActive = false;
  try {
    const activePlanId = (await readFile(activePlanPath, 'utf-8')).trim();
    shouldClearActive = activePlanId === id;
  } catch (error: any) {
    if (error.code && error.code !== 'ENOENT') {
      throw error;
    }
  }

  await withLock(planPath, async () => {
    const plan = await getPlan(workspace, id);
    if (!plan) {
      throw new Error(`Plan '${id}' does not exist`);
    }

    await unlink(planPath);
  });

  if (shouldClearActive) {
    try {
      await unlink(activePlanPath);
    } catch {
      // Ignore if file doesn't exist
    }
  }
}
