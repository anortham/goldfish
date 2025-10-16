/**
 * Plan tool handler
 */

import { savePlan, getPlan, listPlans, setActivePlan, updatePlan } from '../plans.js';
import { getCurrentWorkspace } from '../workspace.js';
import { getFishEmoji } from '../emoji.js';

/**
 * Handle plan tool calls
 */
export async function handlePlan(args: any) {
  const { action, workspace: wsArg } = args;
  const workspace = wsArg || getCurrentWorkspace();

  switch (action) {
    case 'save': {
      const { title, content, activate } = args;
      if (!title || !content) {
        throw new Error('Title and content are required for save action');
      }

      const plan = await savePlan({
        title,
        content,
        workspace,
        activate: activate ?? false
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: `${getFishEmoji()} Plan saved: ${title}`,
              success: true,
              plan
            })
          }
        ]
      };
    }

    case 'get': {
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

      const plan = await getPlan(workspace, id);
      if (!plan) throw new Error(`Plan '${id}' not found`);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: `${getFishEmoji()} Plan retrieved: ${plan.title}`,
              plan
            })
          }
        ]
      };
    }

    case 'list': {
      const { status } = args;
      const plans = await listPlans(workspace);

      const filtered = status
        ? plans.filter(p => p.status === status)
        : plans;

      const count = filtered.length;
      const fish = getFishEmoji();
      const summary = count === 0
        ? `${fish} No plans found`
        : `${fish} Found ${count} plan${count === 1 ? '' : 's'}`;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary,
              plans: filtered,
              count: filtered.length
            })
          }
        ]
      };
    }

    case 'activate': {
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

      await setActivePlan(workspace, id);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: `${getFishEmoji()} Plan activated: ${id}`,
              success: true,
              action: 'activate',
              planId: id
            })
          }
        ]
      };
    }

    case 'update': {
      const { id, updates } = args;
      if (!id) throw new Error('Plan ID is required');
      if (!updates) throw new Error('Updates are required');

      await updatePlan(workspace, id, updates);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: `${getFishEmoji()} Plan updated: ${id}`,
              success: true,
              action: 'update',
              planId: id
            })
          }
        ]
      };
    }

    case 'complete': {
      const { id } = args;
      if (!id) throw new Error('Plan ID is required');

      await updatePlan(workspace, id, { status: 'completed' });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: `${getFishEmoji()} Plan completed: ${id}`,
              success: true,
              action: 'complete',
              planId: id
            })
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}