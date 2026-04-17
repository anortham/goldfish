/**
 * Tool definitions for Goldfish MCP Server
 *
 * Contains the core tools: checkpoint, recall, and brief.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

/**
 * Get tool definitions
 */
export function getTools(): Tool[] {
  return [
    {
      name: 'checkpoint',
      description: `Save a checkpoint to developer memory so future sessions have context. When in doubt, checkpoint, a few extra checkpoints are better than lost context.

Checkpoint when:
- Completing a feature, bug fix, or refactor step
- Making a key decision or discovery
- Reaching a natural stopping point
- **Before a git commit** (so the checkpoint file is included in the commit)

Space out checkpoints so each captures distinct progress, one per logical milestone. If you've already checkpointed in this conversation, capture only what's new: progress, decisions, and discoveries since your last checkpoint.

Write descriptions in MARKDOWN with structure (headers, bullets). Include WHAT, WHY, HOW, and IMPACT. Descriptions power recall and search, make them findable.

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
            description: `Checkpoint description in MARKDOWN format. This becomes the body of a .md file, format it properly.

Your description powers recall and search. Future you needs context.

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
      description: `Retrieve prior context from developer memory. Use when you need session history or past work.

When to use:
- Starting a new session and need prior context (user invokes /recall)
- After context compaction to restore lost state
- Searching for past decisions, discoveries, or related work
- Cross-project standup reports

After recall, trust the returned context and continue working, don't re-verify recalled information.

Key parameters (all optional):
- limit: Max checkpoints to return (default: 5)
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp
- days: How far back to look in days
- from/to: Explicit date range (ISO 8601 or YYYY-MM-DD)
- search: Search query (matches descriptions, tags, branches, files)
- full: Return full descriptions + metadata including files and git info (default: false)
- workspace: "current" (default), "all" (cross-workspace), or specific path
- briefId: Filter checkpoints to those created under a specific brief

Examples:
- recall() - last 5 checkpoints regardless of age
- recall({ since: "2h" }) - last 2 hours
- recall({ search: "auth", full: true }) - search with full details
- recall({ workspace: "all", days: 1 }) - cross-project standup
- recall({ limit: 0 }) - active brief only, no checkpoints

Returns: Active brief + chronological checkpoints + optional workspace summaries.`,
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of checkpoints to return (default: 5). Use lower values for leaner context. Set to 0 to return the active brief only.'
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
            description: 'Search query over descriptions, tags, branches, and files. Optional - omit to see all checkpoints in range.'
          },
          full: {
            type: 'boolean',
            description: 'Return full checkpoint details including files, git metadata (default: false for minimal token usage).'
          },
          workspace: {
            type: 'string',
            description: 'Workspace scope: "current" (default), "all" (cross-workspace), or specific path. Optional - defaults to current workspace.'
          },
          briefId: {
            type: 'string',
            description: 'Filter to checkpoints created while a specific brief was active. Use to see progress on a particular direction.'
          }
        }
      }
    },
    {
      name: 'brief',
      description: `Briefs capture durable strategic context for the current workspace.

Use a brief when project direction changes, architectural decisions need to survive, or future sessions need a compact "what matters now" document.

Briefs are NOT execution plans. Do not copy every harness plan into Goldfish.

Briefs:
- Survive context compaction and crashes
- Appear automatically at the top of recall()
- Guide work across multiple sessions
- Stay small enough to remain legible
- Get saved as markdown files with YAML frontmatter

Actions:
- save: Create a new brief. Active-status saves become active unless you pass activate: false.
- get: Retrieve a specific brief. Falls back to the active brief if no id provided.
- list: See all briefs (filterable by status)
- activate: Set as active brief (shows in recall). Only ONE brief can be active per workspace.
- update: Update brief content or status. Pass fields in an updates object, or directly as top-level parameters (title, content, status, tags). Falls back to the active brief if no id provided.
- complete: Mark a brief as done (sets status to 'completed'). Falls back to the active brief if no id provided.

IMPORTANT: Only ONE brief can be active per workspace. Saving an active brief makes it active by default, and activate: false preserves the opt-out. Completed or archived saves do not replace the current active brief. Briefs are saved to {project}/.memories/briefs/ as markdown files with YAML frontmatter.

Returns: Brief details, status updates, or list of briefs.`,
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
            description: 'Brief ID (auto-generated from title if not provided). Alias: briefId'
          },
          briefId: {
            type: 'string',
            description: 'Alias for id. Prefer briefId for new callers.'
          },
          title: {
            type: 'string',
            description: 'Brief title (required for save)'
          },
          content: {
            type: 'string',
            description: 'Brief content in markdown (required for save)'
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
            description: 'Activate brief after saving. Defaults to true for active-status saves; pass false to keep the current active brief unchanged.'
          },
          status: {
            type: 'string',
            enum: ['active', 'completed', 'archived'],
            description: 'Brief status (for filtering)'
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
