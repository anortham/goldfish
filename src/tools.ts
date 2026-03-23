/**
 * Tool definitions for Goldfish MCP Server
 *
 * Contains the 4 core tools: checkpoint, recall, plan, and consolidate.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Get tool definitions
 */
export function getTools(): Tool[] {
  return [
    {
      name: 'checkpoint',
      description: `Save a checkpoint to developer memory so future sessions have context. When in doubt, checkpoint — a few extra checkpoints are better than lost context.

Checkpoint after:
- Completing a feature, bug fix, or refactor step
- Making a key decision or discovery
- Committing or pushing completed work
- Reaching a natural stopping point

Space out checkpoints so each captures distinct progress — one per logical milestone.

Write descriptions in MARKDOWN with structure (headers, bullets). Include WHAT, WHY, HOW, and IMPACT. Descriptions power fuzzy search — make them findable.

Automatically captures git context (branch, commit, changed files), timestamp (UTC), and tags.

Classify with \`type\` for better recall:
- \`type: "decision"\` → include \`decision\` + \`alternatives\`
- \`type: "incident"\` → include \`context\` + \`evidence\`
- \`type: "learning"\` → include \`impact\`

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
          type: {
            type: 'string',
            enum: ['checkpoint', 'decision', 'incident', 'learning'],
            description: 'Optional memory type for stronger retrieval: checkpoint, decision, incident, or learning.'
          },
          context: {
            type: 'string',
            description: 'Optional context: what problem/state triggered this work.'
          },
          decision: {
            type: 'string',
            description: 'Optional decision statement: the chosen approach (one sentence).'
          },
          alternatives: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional rejected alternatives and why they were not chosen.'
          },
          impact: {
            type: 'string',
            description: 'Optional impact: what changed, improved, unblocked, or what risk was introduced.'
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional verification evidence (tests, metrics, logs, PRs, benchmarks).'
          },
          symbols: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional symbols touched/affected (e.g., ["AuthMiddleware.handle", "refreshToken"]).'
          },
          next: {
            type: 'string',
            description: 'Optional concrete next step or open question.'
          },
          confidence: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            description: 'Optional confidence score from 1 (low) to 5 (high).'
          },
          unknowns: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional unresolved uncertainties or risks.'
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
      description: `Retrieve prior context from developer memory. Use when you need to restore context from previous sessions or find past work.

When to use:
- Starting a new session and need prior context (user invokes /recall)
- After context compaction to restore lost state
- Searching for past decisions, discoveries, or work on a topic
- Cross-project standup reports

After recall, trust the returned context and continue working — don't re-verify recalled information.

Key parameters (all optional):
- limit: Max checkpoints to return (default: 5)
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp
- days: How far back to look in days
- from/to: Explicit date range (ISO 8601 or YYYY-MM-DD)
- search: Fuzzy search query (searches descriptions, tags, branches, files)
- full: Return full descriptions + all metadata including files, git info (default: false)
- workspace: "current" (default), "all" (cross-workspace), or specific path
- planId: Filter checkpoints to those created under a specific plan
- includeMemory: Include full MEMORY.md in response. Defaults to true (bootstrap mode, no search). Defaults to false (search mode, with search param). Override explicitly with true/false.

Recall now returns three layers:
1. Consolidated memory (MEMORY.md) - project understanding, included by default
2. Delta checkpoints - events since last consolidation, included when stale
3. Consolidation flag - metadata indicating if consolidation is needed

If consolidation.needed is true: dispatch a BACKGROUND consolidation subagent (call consolidate() first to get the payload).

Examples:
- recall() - last 5 checkpoints regardless of age
- recall({ since: "2h" }) - last 2 hours
- recall({ search: "auth", full: true }) - search with full details
- recall({ workspace: "all", days: 1 }) - cross-project standup
- recall({ limit: 0 }) - active plan only, no checkpoints

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
          },
          planId: {
            type: 'string',
            description: 'Filter to checkpoints created while a specific plan was active. Use to see progress on a particular plan.'
          },
          includeMemory: {
            type: 'boolean',
            description: 'Include full MEMORY.md in response. Default: true when no search param (bootstrap mode), false when search param provided (search mode). MEMORY.md sections are always searchable regardless of this setting.'
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
    },
    {
      name: 'consolidate',
      description: `Prepare memory consolidation. Gathers current MEMORY.md + unconsolidated checkpoints into a payload for a consolidation subagent.

When to use:
- When recall flags consolidation.needed: true
- Before ending a long session with significant new work
- On a scheduled cadence (e.g., daily wrap-up)

Workflow:
1. Call consolidate() - returns payload with subagent prompt
2. If status is "ready": dispatch a BACKGROUND subagent with the payload's prompt field, passing currentMemory and unconsolidatedCheckpoints as context
3. If status is "current": nothing to do, memory is up to date

The subagent writes two files: .memories/MEMORY.md (updated understanding) and .memories/.last-consolidated (timestamp).

Returns: JSON payload with status, current memory, unconsolidated checkpoints, and subagent prompt template.`,
      inputSchema: {
        type: 'object',
        properties: {
          workspace: {
            type: 'string',
            description: 'Workspace path (defaults to current directory)'
          }
        }
      }
    }
  ];
}
