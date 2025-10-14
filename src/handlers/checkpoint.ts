/**
 * Checkpoint tool handler
 */

import { saveCheckpoint } from '../checkpoints.js';
import { getCurrentWorkspace } from '../workspace.js';

/**
 * Handle checkpoint tool calls
 */
export async function handleCheckpoint(args: any) {
  const { description, tags, workspace } = args;

  if (!description) {
    throw new Error('Description is required');
  }

  await saveCheckpoint({
    description,
    tags,
    workspace: workspace || getCurrentWorkspace()
  });

  const now = new Date();
  const timeUTC = now.toISOString().substring(11, 16); // HH:MM in UTC
  return {
    content: [
      {
        type: 'text' as const,
        text: `✅ **Checkpoint saved**

📝 **Progress:** ${description}
⏰ **Time:** ${timeUTC} UTC
${tags && tags.length > 0 ? `🏷️ **Tags:** ${tags.join(', ')}` : ''}

Your progress is now safely captured and will survive session restarts! 🐠

💡 **Next:** Use recall() when starting your next session to restore this context.`
      }
    ]
  };
}