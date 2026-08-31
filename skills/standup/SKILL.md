---
name: standup
description: Use when the user asks for a standup, daily update, progress summary, or cross-project report built from Goldfish briefs and checkpoints
---

# Standup

## Workspace binding

For user-level MCP registrations, pass workspace as the conversation's host-native absolute project root on every checkpoint, brief, and current-project recall call. Omission and "current" work only with fixed absolute GOLDFISH_WORKSPACE or supported legacy Roots. recall({ workspace: "all" }) is explicit cross-project search, never a fallback; it is invalid for checkpoint and brief. Cwd, registry, and parent-walk candidates are suggestions only. If unbound, retry with {"workspace":"<absolute-project-root>"}.

## Core Split

- Goldfish brief explains the direction
- Checkpoints show what happened
- Standup ties the two together across projects

## Timeframe

Default to yesterday (`days: 1`). If the user gives a timeframe — as an argument (`/standup 7d`, `/standup 1w`, `/standup 3d`) or in words ("last week", "since Friday") — pass it through as `since` (accepts `m`/`h`/`d`/`w` units) or `days`. A Monday standup after a weekend usually wants `3d`; a weekly catch-up wants `1w`.

## Workflow

1. Recall cross-project activity over the requested timeframe:

```ts
recall({ workspace: "all", days: 1 })      // default: daily standup
recall({ workspace: "all", since: "1w" })  // e.g. /standup 1w
```

2. For active projects, use `recall({ workspace: "/absolute/path/to/project", limit: 0 })` or the brief tool to understand current direction.
3. Group checkpoint clusters into the few accomplishments that mattered.
4. Synthesize a short report with done, next, and blocked.

## Reporting Rules

- Lead with impact, not motion.
- Group noisy checkpoint clusters into one accomplishment.
- Call out blockers plainly.
- Mention drift when work does not line up with the brief.
- If no brief exists, say so and rely on checkpoints.

## Format

For multiple projects, group by project.

For one project, use:

- `Done`
- `Next`
- `Blocked`

Keep it short enough to read in one pass.
