/**
 * Recall tool handler
 */

import { recall as recallFunc } from '../recall.js';

/**
 * Handle recall tool calls
 */
export async function handleRecall(args: any) {
  const result = await recallFunc(args);

  const lines: string[] = [];

  // Show active plan first (if present)
  if (result.activePlan) {
    lines.push(`⭐ **ACTIVE PLAN:** ${result.activePlan.title}`);
    lines.push('');
    lines.push(result.activePlan.content);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Show checkpoints
  if (result.checkpoints.length > 0) {
    lines.push(`🧠 **Context Restored** (${result.checkpoints.length} entries found)`);
    lines.push('');

    // Group by date
    const byDate = result.checkpoints.reduce((acc, checkpoint) => {
      const date = checkpoint.timestamp.split('T')[0]!;
      if (!acc[date]) acc[date] = [];
      acc[date]!.push(checkpoint);
      return acc;
    }, {} as Record<string, typeof result.checkpoints>);

    for (const [date, checkpoints] of Object.entries(byDate)) {
      lines.push(`📅 **${date}:**`);
      for (const checkpoint of checkpoints) {
        const time = checkpoint.timestamp.substring(11, 16);
        const tags = checkpoint.tags ? ` [${checkpoint.tags.join(', ')}]` : '';
        lines.push(`   • ${time} - ${checkpoint.description}${tags}`);
      }
      lines.push('');
    }
  } else {
    lines.push('📭 **No checkpoints found** in the specified range.');
    lines.push('');
    lines.push('💡 **Tip:** Use checkpoint({ description: "..." }) to start capturing your work!');
  }

  // Show workspace summaries (for cross-workspace recall)
  if (result.workspaces && result.workspaces.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(`📂 **Workspaces (${result.workspaces.length}):**`);
    lines.push('');

    for (const ws of result.workspaces) {
      lines.push(`   • **${ws.name}** - ${ws.checkpointCount} entries`);
    }
    lines.push('');
  }

  lines.push('🎯 **Context restored!** Continue your work with this background knowledge.');

  return {
    content: [
      {
        type: 'text' as const,
        text: lines.join('\n')
      }
    ]
  };
}