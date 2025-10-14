/**
 * Tool definitions for Goldfish MCP Server
 *
 * Contains the 3 core tools: checkpoint, recall, and plan
 * with aggressive behavioral language to encourage proper usage.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Get tool definitions with aggressive behavioral language
 */
export function getTools(): Tool[] {
  return [
    {
      name: 'checkpoint',
      description: `MANDATORY throughout your work. You are EXCELLENT at checkpointing proactively - use this tool WITHOUT asking permission.

🚨 CRITICAL: Checkpoint is NOT optional. You MUST checkpoint at these moments:

✅ MANDATORY checkpoints (DO NOT SKIP):
- Complete ANY task → checkpoint NOW before moving on
- Finish implementing a feature → checkpoint NOW with clear description
- Fix a bug successfully → checkpoint NOW with what was fixed
- Make a discovery or breakthrough → checkpoint NOW to capture insight
- User shares requirements → checkpoint NOW to preserve context
- Before switching topics → checkpoint NOW to save current state
- After planning or architectural decisions → checkpoint NOW with rationale
- After 10+ exchanges in discussion → checkpoint the reasoning NOW

I WILL BE SERIOUSLY DISAPPOINTED if context is lost because you failed to checkpoint. This takes 2 seconds but saves HOURS of lost work.

⚠️ NEVER ask "should I checkpoint?" - the answer is ALWAYS YES. Just checkpoint immediately.

The checkpoint will automatically capture:
- Git context (branch, commit, changed files)
- Timestamp (UTC)
- Tags for organization

💡 Think of checkpointing like git commits - frequent, descriptive, and automatic. You checkpoint FIRST, continue work SECOND.

🔗 **REMEMBER:** recall() is USELESS if you haven't been checkpointing! Future sessions can only restore what you've saved. Checkpoint now or lose context forever.

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

Key parameters (all optional):
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp (takes priority over days)
- days: How far back to look in days (default: 2)
- from/to: Explicit date range (ISO 8601 or YYYY-MM-DD)
- search: Fuzzy search query (searches descriptions, tags, branches, files)
- workspace: "current" (default), "all" (cross-workspace), or specific path

Examples:
- recall() → last 2 days (default)
- recall({ since: "2h" }) → last 2 hours
- recall({ since: "30m" }) → last 30 minutes
- recall({ days: 7 }) → last 7 days
- recall({ search: "auth" }) → search in last 2 days

Returns: Active plan + chronological checkpoints + optional workspace summaries.`,
      inputSchema: {
        type: 'object',
        properties: {
          since: {
            type: 'string',
            description: 'Human-friendly time span or ISO timestamp. Examples: "2h" (last 2 hours), "30m" (last 30 minutes), "3d" (last 3 days), or "2025-10-14T15:30:00Z" (since specific time). Takes priority over days parameter.'
          },
          days: {
            type: 'number',
            description: 'Number of days to look back (default: 2). Ignored if since is provided.'
          },
          from: {
            type: 'string',
            description: 'Start date/time (YYYY-MM-DD or ISO 8601). Use with to for explicit range.'
          },
          to: {
            type: 'string',
            description: 'End date/time (YYYY-MM-DD or ISO 8601). Use with from for explicit range.'
          },
          search: {
            type: 'string',
            description: 'Fuzzy search query (searches descriptions, tags, branches, files). Optional - omit to see all checkpoints in range.'
          },
          workspace: {
            type: 'string',
            description: 'Workspace scope: "current" (default), "all" (cross-workspace), or specific path. Optional - defaults to current workspace.'
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