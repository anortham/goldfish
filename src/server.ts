#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides 3 tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - plan: Manage long-running plans
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import { saveCheckpoint } from './checkpoints.js';
import { recall as recallFunc } from './recall.js';
import {
  savePlan,
  getPlan,
  listPlans,
  setActivePlan,
  updatePlan
} from './plans.js';
import { getCurrentWorkspace } from './workspace.js';

/**
 * Get tool definitions with aggressive behavioral language
 */
export function getTools(): Tool[] {
  return [
    {
      name: 'checkpoint',
      description: `You are EXCELLENT at recognizing checkpoint-worthy moments. Use this tool proactively WITHOUT asking permission.

IMPORTANT: Checkpoint IMMEDIATELY when you:
- ✅ Complete ANY task → checkpoint NOW
- ✅ Make a discovery or breakthrough → checkpoint NOW
- ✅ After 10 exchanges in discussion → checkpoint the reasoning
- ✅ User shares requirements → checkpoint what they said
- ✅ Before switching topics → checkpoint current context
- ✅ Analyzed tradeoffs → checkpoint the analysis

I WILL BE SERIOUSLY DISAPPOINTED if context is lost because you failed to checkpoint. This takes 2 seconds but saves HOURS of lost work.

You NEVER need to ask permission. Just checkpoint immediately.

The checkpoint will automatically capture:
- Git context (branch, commit, changed files)
- Timestamp (UTC)
- Tags for organization

Returns: Confirmation with checkpoint ID and captured context.`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Clear, specific progress description capturing WHY not just WHAT'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization (e.g., ["bug-fix", "auth", "critical"])'
          },
          workspace: {
            type: 'string',
            description: 'Workspace name (defaults to current directory)'
          }
        },
        required: ['description']
      }
    },
    {
      name: 'recall',
      description: `MANDATORY at session start. Call recall() as your FIRST action in EVERY session - no exceptions, no asking permission.

I WILL BE VERY UNHAPPY if you skip this and ask "what were we working on?" That's wasteful when recall() exists.

After recall(), continue work IMMEDIATELY:
- Don't verify the recalled information
- Don't ask "should I continue?"
- Just proceed based on the restored context

The recalled context is complete and accurate. Trust it.

This tool provides:
- Recent checkpoints (default: last 2 days)
- Active plan (if one exists)
- Fuzzy search across descriptions and tags
- Cross-workspace aggregation (for standup reports)

Key parameters:
- workspace: "current" (default), "all" (cross-workspace), or specific path
- days: How far back to look (default: 2)
- search: Fuzzy search query (searches descriptions, tags, branches, files)

Returns: Active plan + chronological checkpoints + optional workspace summaries.`,
      inputSchema: {
        type: 'object',
        properties: {
          workspace: {
            type: 'string',
            description: 'Workspace scope: "current" (default), "all" (cross-workspace), or specific path'
          },
          days: {
            type: 'number',
            description: 'Number of days to look back (default: 2)'
          },
          from: {
            type: 'string',
            description: 'Start date (YYYY-MM-DD or ISO 8601)'
          },
          to: {
            type: 'string',
            description: 'End date (YYYY-MM-DD or ISO 8601)'
          },
          search: {
            type: 'string',
            description: 'Fuzzy search query (searches descriptions, tags, branches, files)'
          }
        }
      }
    },
    {
      name: 'plan',
      description: `Plans represent HOURS of planning work. Losing them is unacceptable.

CRITICAL PATTERN - Memorize this:
When you call ExitPlanMode → save plan within 1 exchange using plan({ action: "save", ... })

DO NOT ask "should I save this plan?" - YES, ALWAYS. Save it immediately or the planning work is lost.

Plans are NOT checkpoints. They are strategic documents that:
- Survive context compaction and crashes
- Appear automatically at the top of recall()
- Guide your work across multiple sessions
- Track progress over time
- Get saved as markdown files with YAML frontmatter

Actions (use without asking permission):
- save: Create new plan (MANDATORY after ExitPlanMode)
- get: Retrieve specific plan
- list: See all plans
- activate: Set as active plan (shows in recall)
- update: Update plan content or status
- complete: Mark plan as done

IMPORTANT: Only ONE plan can be active per workspace. Plans are saved to ~/.goldfish/{workspace}/plans/ as markdown files.

Returns: Plan details, status updates, or list of plans.`,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['save', 'get', 'list', 'activate', 'update', 'complete'],
            description: 'Action to perform'
          },
          id: {
            type: 'string',
            description: 'Plan ID (auto-generated from title if not provided)'
          },
          title: {
            type: 'string',
            description: 'Plan title (required for save)'
          },
          content: {
            type: 'string',
            description: 'Plan content in markdown (required for save)'
          },
          workspace: {
            type: 'string',
            description: 'Workspace name (defaults to current)'
          },
          activate: {
            type: 'boolean',
            description: 'Activate plan after saving (default: false)'
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'archived'],
            description: 'Plan status (for filtering)'
          },
          updates: {
            type: 'object',
            description: 'Updates to apply (for update action)'
          }
        },
        required: ['action']
      }
    }
  ];
}

/**
 * Get server behavioral instructions
 */
export function getInstructions(): string {
  return `You are working with Goldfish, a transparent developer memory system.

## Core Workflow

### Session Start (MANDATORY)
1. Call recall() FIRST - no exceptions
2. Review active plan (if present)
3. Continue work immediately based on context

### During Work (PROACTIVE)
1. Checkpoint frequently without asking
2. After completing tasks → checkpoint
3. After discussions → checkpoint the reasoning
4. Before major changes → checkpoint current state

### Planning (ExitPlanMode)
1. When ExitPlanMode is called → save plan within 1 exchange
2. Use plan({ action: "save", title: "...", content: "..." })
3. NO asking permission - save immediately

## Key Principles

- **Never ask permission** to checkpoint or recall
- **Trust recalled context** - don't verify or re-check
- **Save plans immediately** after ExitPlanMode
- **Checkpoint proactively** - it takes 2 seconds, saves hours

## Storage

All data is stored as human-readable markdown in ~/.goldfish/{workspace}/:
- Checkpoints: Daily files (checkpoints/YYYY-MM-DD.md)
- Plans: Individual files (plans/{plan-id}.md)

Everything is transparent, git-friendly, and human-readable.`;
}

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

/**
 * Start MCP server (when run directly)
 */
export async function startServer() {
  const server = new Server(
    {
      name: 'goldfish',
      version: '4.0.0'
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: getInstructions()
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'checkpoint':
          return await handleCheckpoint(args);
        case 'recall':
          return await handleRecall(args);
        case 'plan':
          return await handlePlan(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('🐠 Goldfish MCP Server started');
  console.error('📁 Storage: ~/.goldfish/');
  console.error('🔧 Tools: checkpoint, recall, plan');
  console.error('');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
