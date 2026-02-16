/**
 * Plan tool handler
 */

import { savePlan, getPlan, listPlans, setActivePlan, updatePlan } from '../plans.js';
import { getFishEmoji } from '../emoji.js';
import type { Plan } from '../types.js';

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
    lines.push(`- **${plan.id}**: ${plan.title} (${plan.status}) — updated ${plan.updated}`);
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
 * Handle plan tool calls
 */
export async function handlePlan(args: any) {
  const { action, workspace: wsArg } = args;
  const workspace = wsArg || process.cwd();
  const fish = getFishEmoji();

  switch (action) {
    case 'save': {
      const { title, content, activate, id, tags } = args;
      if (!title || !content) {
        throw new Error('Title and content are required for save action');
      }

      const plan = await savePlan({
        title,
        content,
        workspace,
        activate: activate ?? false,
        ...(id && { id }),
        ...(tags && { tags })
      });

      const statusText = plan.status === 'active' && activate ? ' (active)' : '';
      return textResponse(`${fish} Plan saved: ${plan.id}${statusText}`);
    }

    case 'get': {
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

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
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

      await setActivePlan(workspace, id);
      return textResponse(`${fish} Plan activated: ${id}`);
    }

    case 'update': {
      const { id, updates } = args;
      if (!id) throw new Error('Plan ID is required');
      if (!updates) throw new Error('Updates are required');

      await updatePlan(workspace, id, updates);
      return textResponse(`${fish} Plan updated: ${id}`);
    }

    case 'complete': {
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

      await updatePlan(workspace, id, { status: 'completed' });
      return textResponse(`${fish} Plan completed: ${id}`);
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
