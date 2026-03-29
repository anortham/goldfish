/**
 * Plan tool handler
 */

import { savePlan, getPlan, getActivePlan, listPlans, setActivePlan, updatePlan } from '../plans.js';
import { getFishEmoji } from '../emoji.js';
import { resolveWorkspace } from '../workspace.js';
import type { Plan, PlanArgs } from '../types.js';

/**
 * Format a full plan as readable markdown
 */
function formatPlanFull(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# ${plan.title}`);
  lines.push(`ID: ${plan.id}`);
  lines.push(`Status: ${plan.status}`);
  lines.push(`Created: ${plan.created}`);
  lines.push(`Updated: ${plan.updated}`);
  if (plan.tags && plan.tags.length > 0) {
    lines.push(`Tags: ${plan.tags.join(', ')}`);
  }
  lines.push('');
  lines.push(plan.content);
  return lines.join('\n');
}

/**
 * Format plan list as readable markdown
 */
function formatPlanList(plans: Plan[]): string {
  const lines: string[] = [];
  for (const plan of plans) {
    lines.push(`- **${plan.id}**: ${plan.title} (${plan.status}) - updated ${plan.updated}`);
  }
  return lines.join('\n');
}

/**
 * Simple one-liner MCP response helper
 */
function textResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }]
  };
}

/**
 * Resolve plan ID from args, accepting both 'id' and 'planId' (common LLM alias).
 * Falls back to the active plan when neither is provided.
 * Returns null if no ID can be resolved.
 */
async function resolveId(args: PlanArgs, workspace: string): Promise<string | null> {
  const id = args.id || args.planId;
  if (id) return id;

  // Fall back to active plan
  const active = await getActivePlan(workspace);
  return active?.id ?? null;
}

/**
 * Handle plan tool calls
 */
export async function handlePlan(args: PlanArgs) {
  const { action, workspace: wsArg } = args;
  const workspace = resolveWorkspace(wsArg);
  const fish = getFishEmoji();

  switch (action) {
    case 'save': {
      const { title, content, activate, id, tags } = args;
      const planId = id || args.planId;
      if (!title || !content) {
        throw new Error('Title and content are required for save action');
      }

      const plan = await savePlan({
        title,
        content,
        workspace,
        activate: activate ?? false,
        ...(planId && { id: planId }),
        ...(tags && { tags })
      });

      const statusText = plan.status === 'active' && activate ? ' (active)' : '';
      return textResponse(`${fish} Plan saved: ${plan.id}${statusText}`);
    }

    case 'get': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active plan found. Provide a plan ID or activate a plan first.');

      const plan = await getPlan(workspace, id);
      if (!plan) throw new Error(`Plan '${id}' not found`);

      return textResponse(formatPlanFull(plan));
    }

    case 'list': {
      const { status } = args;
      const plans = await listPlans(workspace);

      const filtered = status
        ? plans.filter(p => p.status === status)
        : plans;

      const count = filtered.length;

      if (count === 0) {
        return textResponse(`${fish} No plans found`);
      }

      const summary = `${fish} Found ${count} plan${count === 1 ? '' : 's'}`;
      return textResponse(`${summary}\n\n${formatPlanList(filtered)}`);
    }

    case 'activate': {
      const id = args.id || args.planId;
      if (!id) throw new Error('Plan ID is required for activate action');

      await setActivePlan(workspace, id);
      return textResponse(`${fish} Plan activated: ${id}`);
    }

    case 'update': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active plan found. Provide a plan ID or activate a plan first.');

      // Accept updates as explicit object, or construct from top-level properties
      let { updates } = args;
      if (!updates) {
        const topLevel: Record<string, any> = {};
        if (args.title) topLevel.title = args.title;
        if (args.content) topLevel.content = args.content;
        if (args.status) topLevel.status = args.status;
        if (args.tags) topLevel.tags = args.tags;

        if (Object.keys(topLevel).length > 0) {
          updates = topLevel;
        }
      }

      if (!updates) throw new Error('Updates are required');

      await updatePlan(workspace, id, updates);
      return textResponse(`${fish} Plan updated: ${id}`);
    }

    case 'complete': {
      const id = await resolveId(args, workspace);
      if (!id) throw new Error('No active plan found. Provide a plan ID or activate a plan first.');

      await updatePlan(workspace, id, { status: 'completed' });
      return textResponse(`${fish} Plan completed: ${id}`);
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
