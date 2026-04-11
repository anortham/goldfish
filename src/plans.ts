/**
 * Plan storage and management
 *
 * Plans are stored as individual markdown files with YAML frontmatter:
 * {project}/.memories/plans/{plan-id}.md
 *
 * Active plan is tracked in: {project}/.memories/.active-plan
 */

import { join } from 'path';
import { readFile, writeFile, readdir, unlink, rename } from 'fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Plan, PlanInput, PlanUpdate } from './types';
import { getMemoriesDir, getPlansDir, ensureMemoriesDir, resolveWorkspace } from './workspace';
import { withLock } from './lock';

const VALID_PLAN_STATUSES = new Set(['active', 'completed', 'archived']);

function assertValidPlanStatus(status: unknown): asserts status is Plan['status'] {
  if (typeof status !== 'string' || !VALID_PLAN_STATUSES.has(status)) {
    throw new Error(`Invalid plan status '${status}'. Expected active, completed, or archived.`);
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
  // Strip BOM and normalize CRLF → LF (Windows git checkout / Notepad)
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  // Extract frontmatter (accept single or double newline after closing ---)
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
 * Validate that a plan ID is safe for use in file paths.
 * Rejects IDs containing path separators or traversal sequences.
 */
function validatePlanId(id: string): void {
  if (id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')) {
    throw new Error(`Invalid plan ID '${id}': must not contain path separators or traversal sequences`);
  }
}

/**
 * Save a new plan
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

  // Write plan file atomically under lock to prevent TOCTOU race
  const planPath = join(getPlansDir(projectPath), `${id}.md`);
  const content = formatPlanFile(plan);

  await withLock(planPath, async () => {
    // Check for duplicate ID before writing
    try {
      await readFile(planPath, 'utf-8');
      throw new Error(`Plan with ID '${id}' already exists`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }

    // Atomic write: temp file then rename
    const tempPath = `${planPath}.tmp.${Date.now()}`;
    await writeFile(tempPath, content, 'utf-8');
    try {
      await rename(tempPath, planPath);
    } catch (error: any) {
      if (error.code === 'ENOENT' && process.platform === 'win32') {
        await writeFile(planPath, content, 'utf-8');
        try { await unlink(tempPath); } catch {}
      } else {
        throw error;
      }
    }
  });

  // Only active-status plans may become the workspace's active plan.
  if (plan.status === 'active' && input.activate !== false) {
    await setActivePlan(projectPath, id);
  }

  return plan;
}

/**
 * Get a plan by ID
 */
export async function getPlan(projectPath: string, id: string): Promise<Plan | null> {
  validatePlanId(id);
  const planPath = join(getPlansDir(projectPath), `${id}.md`);

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
export async function listPlans(projectPath: string): Promise<Plan[]> {
  const plansDir = getPlansDir(projectPath);

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
      return getPlan(projectPath, id);
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
export async function getActivePlan(projectPath: string): Promise<Plan | null> {
  const activePlanPath = join(getMemoriesDir(projectPath), '.active-plan');

  try {
    const planId = (await readFile(activePlanPath, 'utf-8')).trim();
    const plan = await getPlan(projectPath, planId);
    if (plan && plan.status !== 'active') {
      return null;
    }
    return plan;
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
export async function setActivePlan(projectPath: string, planId: string): Promise<void> {
  validatePlanId(planId);
  // Verify plan exists
  const plan = await getPlan(projectPath, planId);
  if (!plan) {
    throw new Error(`Plan '${planId}' does not exist`);
  }
  if (plan.status !== 'active') {
    throw new Error(`Cannot activate plan '${planId}' with status '${plan.status}'`);
  }

  const activePlanPath = join(getMemoriesDir(projectPath), '.active-plan');

  await withLock(activePlanPath, async () => {
    // Write atomically
    const tempPath = `${activePlanPath}.tmp.${Date.now()}`;
    await writeFile(tempPath, planId, 'utf-8');
    try {
      await rename(tempPath, activePlanPath);
    } catch (error: any) {
      if (error.code === 'ENOENT' && process.platform === 'win32') {
        await writeFile(activePlanPath, planId, 'utf-8');
        try { await unlink(tempPath); } catch {}
      } else {
        throw error;
      }
    }
  });
}

/**
 * Update an existing plan
 */
export async function updatePlan(
  projectPath: string,
  id: string,
  updates: PlanUpdate
): Promise<void> {
  validatePlanId(id);
  const planPath = join(getPlansDir(projectPath), `${id}.md`);

  // Use file lock to prevent race conditions on concurrent updates
  await withLock(planPath, async () => {
    const plan = await getPlan(projectPath, id);
    if (!plan) {
      throw new Error(`Plan '${id}' does not exist`);
    }
    if (updates.status !== undefined) {
      assertValidPlanStatus(updates.status);
    }

    // Apply updates
    const updatedPlan: Plan = {
      ...plan,
      ...updates,
      updated: new Date().toISOString()
    };

    // Auto-check all unchecked boxes when completing a plan
    if (updatedPlan.status === 'completed' && plan.status !== 'completed') {
      updatedPlan.content = updatedPlan.content.replace(/- \[ \]/g, '- [x]');
    }

    // Write updated plan (atomic)
    const content = formatPlanFile(updatedPlan);
    const tempPath = `${planPath}.tmp.${Date.now()}`;
    await writeFile(tempPath, content, 'utf-8');
    try {
      await rename(tempPath, planPath);
    } catch (error: any) {
      if (error.code === 'ENOENT' && process.platform === 'win32') {
        await writeFile(planPath, content, 'utf-8');
        try { await unlink(tempPath); } catch {}
      } else {
        throw error;
      }
    }
  });
}

/**
 * Delete a plan
 */
export async function deletePlan(projectPath: string, id: string): Promise<void> {
  validatePlanId(id);
  const planPath = join(getPlansDir(projectPath), `${id}.md`);
  const activePlanPath = join(getMemoriesDir(projectPath), '.active-plan');

  await withLock(planPath, async () => {
    const plan = await getPlan(projectPath, id);
    if (!plan) {
      throw new Error(`Plan '${id}' does not exist`);
    }

    await unlink(planPath);

    // Lock .active-plan to avoid racing with setActivePlan
    await withLock(activePlanPath, async () => {
      try {
        const activePlanId = (await readFile(activePlanPath, 'utf-8')).trim();
        if (activePlanId === id) {
          await unlink(activePlanPath);
        }
      } catch {
        // No active plan file — nothing to clear
      }
    });
  });
}
