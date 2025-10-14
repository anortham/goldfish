/**
 * Plan tool handler
 */

import { savePlan, getPlan, listPlans, setActivePlan, updatePlan } from '../plans.js';
import { getCurrentWorkspace } from '../workspace.js';

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
            text: `✅ **Plan saved successfully**

📋 **${plan.title}**
🆔 Plan ID: ${plan.id}
${activate ? '⭐ **Active** - Will appear in recall()' : '💤 **Inactive** - Use plan({ action: "activate", id: "..." }) to activate'}

Your plan is saved to: ~/.goldfish/${workspace}/plans/${plan.id}.md`
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
            text: `📋 **${plan.title}**

**Status:** ${plan.status}
**Created:** ${plan.created}
**Updated:** ${plan.updated}

---

${plan.content}`
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

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `📭 **No plans found**${status ? ` with status '${status}'` : ''}.

💡 Use plan({ action: "save", title: "...", content: "..." }) to create one.`
            }
          ]
        };
      }

      const lines = [`📋 **Plans (${filtered.length}):**`, ''];
      for (const plan of filtered) {
        const statusEmoji = plan.status === 'completed' ? '✅' : plan.status === 'active' ? '🔄' : '📦';
        const updatedDate = plan.updated.split('T')[0]; // Extract YYYY-MM-DD from ISO timestamp
        lines.push(`${statusEmoji} **${plan.title}** (${plan.id})`);
        lines.push(`   Status: ${plan.status} | Updated: ${updatedDate}`);
        lines.push('');
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: lines.join('\n')
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
            text: `⭐ **Plan activated**

Plan '${id}' is now active and will appear in recall().`
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
            text: `✅ **Plan updated**

Plan '${id}' has been updated successfully.`
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
            text: `🎉 **Plan completed**

Congratulations on completing plan '${id}'!`
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}