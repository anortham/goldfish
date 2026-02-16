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

CRITICAL: Checkpoint is NOT optional. You MUST checkpoint at these moments:

MANDATORY checkpoints (DO NOT SKIP):
- Complete ANY task - checkpoint NOW before moving on
- Finish implementing a feature - checkpoint NOW with clear description
- Fix a bug successfully - checkpoint NOW with what was fixed
- Make a discovery or breakthrough - checkpoint NOW to capture insight
- User shares requirements - checkpoint NOW to preserve context
- Before switching topics - checkpoint NOW to save current state
- After planning or architectural decisions - checkpoint NOW with rationale
- After 10+ exchanges in discussion - checkpoint the reasoning NOW

WRITE RICH DESCRIPTIONS IN MARKDOWN: Your description becomes the body of a .md file. Use bullet points, headers, and formatting — NOT a wall of text. Include WHAT you did, WHY it mattered, and HOW you solved it. Future sessions depend on finding relevant context - make it findable AND readable.

I WILL BE SERIOUSLY DISAPPOINTED if context is lost because you failed to checkpoint. This takes 2 seconds but saves HOURS of lost work.

NEVER ask "should I checkpoint?" - the answer is ALWAYS YES. Just checkpoint immediately.

The checkpoint will automatically capture:
- Git context (branch, commit, changed files)
- Timestamp (UTC)
- Tags for organization

Think of checkpointing like git commits - frequent, descriptive, and automatic. You checkpoint FIRST, continue work SECOND.

REMEMBER: recall() is USELESS if you haven't been checkpointing! Future sessions can only restore what you've saved. Checkpoint now or lose context forever.

Returns: Confirmation with checkpoint details and captured context.`,
      inputSchema: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: `Checkpoint description in MARKDOWN format. This becomes the body of a .md file — format it properly.

Your description powers fuzzy search. Future you needs context.

MUST INCLUDE (use markdown structure):
- WHAT - The change/accomplishment
- WHY - Problem solved or goal achieved
- HOW - Key approach, decision, or discovery
- IMPACT - What unblocked, what improved, what you learned

GOOD (markdown formatted):
"## Fixed JWT validation bug\\n\\nExpired tokens were being accepted due to inverted expiry check in \`validateToken()\`.\\n\\n- **Root cause:** Comparison operator was flipped\\n- **Fix:** Corrected the expiry comparison, added test coverage\\n- **Impact:** Unblocks the auth PR"

BAD (wall of text): "Fixed JWT validation bug where expired tokens were accepted. Root cause was inverted expiry check in validateToken(). Added test coverage for edge case. This was blocking the auth PR."

BAD (no context): "Fixed auth bug"`
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization (e.g., ["bug-fix", "auth", "critical"])'
          },
          workspace: {
            type: 'string',
            description: 'Workspace path (defaults to current directory)'
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
- Recent checkpoints (default: last 5, no date window)
- Active plan (if one exists)
- Fuzzy search across descriptions and tags
- Cross-workspace aggregation (for standup reports)

Key parameters (all optional):
- limit: Max checkpoints to return (default: 5, prevents context bloat)
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp (takes priority over days)
- days: How far back to look in days (only used when explicitly set)
- from/to: Explicit date range (ISO 8601 or YYYY-MM-DD)
- search: Fuzzy search query (searches descriptions, tags, branches, files)
- full: Return full descriptions + all metadata including files, git info (default: false)
- workspace: "current" (default), "all" (cross-workspace), or specific path

Examples:
- recall() - last 5 checkpoints regardless of age (lean context)
- recall({ limit: 10 }) - last 10 checkpoints
- recall({ since: "2h" }) - last 2 hours, max 5 checkpoints
- recall({ days: 7, limit: 20 }) - last 7 days, max 20 checkpoints
- recall({ search: "auth", full: true }) - search with full details
- recall({ limit: 0 }) - plan only, no checkpoints

Returns: Active plan + chronological checkpoints + optional workspace summaries.`,
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of checkpoints to return (default: 5). Use lower values for leaner context. Set to 0 to return plan only.'
          },
          since: {
            type: 'string',
            description: 'Human-friendly time span or ISO timestamp. Examples: "2h" (last 2 hours), "30m" (last 30 minutes), "3d" (last 3 days), or "2025-10-14T15:30:00Z" (since specific time). Takes priority over days parameter.'
          },
          days: {
            type: 'number',
            description: 'Number of days to look back. When set, enables date-window mode instead of last-N mode. Ignored if since is provided.'
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
          full: {
            type: 'boolean',
            description: 'Return full checkpoint details including files, git metadata (default: false for minimal token usage).'
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
When you call ExitPlanMode - save plan within 1 exchange using plan({ action: "save", ... })

DO NOT ask "should I save this plan?" - YES, ALWAYS. Save it immediately or the planning work is lost.

I WILL BE SERIOUSLY DISAPPOINTED if a plan is lost because you forgot to save it. Plans take 2 seconds to save but represent HOURS of strategic thinking.

Plans are NOT checkpoints. They are strategic documents that:
- Survive context compaction and crashes
- Appear automatically at the top of recall()
- Guide your work across multiple sessions
- Track progress over time
- Get saved as markdown files with YAML frontmatter

NEVER ask permission to save or update a plan. Just do it.

Actions (use without asking permission):
- save: Create new plan (MANDATORY after ExitPlanMode). Always activate unless you have a reason not to.
- get: Retrieve specific plan
- list: See all plans (filterable by status)
- activate: Set as active plan (shows in recall). Only ONE plan can be active per workspace.
- update: Update plan content or status. Updates accept: title, content, status, tags.
- complete: Mark plan as done (sets status to 'completed')

IMPORTANT: Only ONE plan can be active per workspace. After saving a plan, ACTIVATE it so it appears in recall(). Plans are saved to {project}/.memories/plans/ as markdown files with YAML frontmatter.

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
            description: 'Workspace path (defaults to current directory)'
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for categorization (e.g., ["milestone", "auth"]). Used with save action.'
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
            description: 'Updates to apply (for update action). Accepts: title (string), content (string), status ("active" | "completed" | "archived"), tags (string[])',
            properties: {
              title: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['active', 'completed', 'archived'] },
              tags: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        required: ['action']
      }
    }
  ];
}
