---
name: standup
description: Use when the user asks for a standup, daily update, progress summary, or cross-project report built from Goldfish memory and current execution docs
allowed-tools: mcp__goldfish__recall, mcp__goldfish__brief
---

# Standup

## Core Split

- Goldfish brief explains the direction
- `docs/plans/` explains execution detail
- Checkpoints show what happened

## Workflow

1. Recall cross-project activity:

```ts
mcp__goldfish__recall({ workspace: "all", days: 1 })
```

2. For active projects, use `recall({ limit: 0 })` or the brief tool to understand current direction.
3. Read `docs/plans/` for implementation progress where it matters.
4. Synthesize a short report with done, next, and blocked.

## Reporting Rules

- Lead with impact, not motion.
- Group noisy checkpoint clusters into one accomplishment.
- Call out blockers plainly.
- Mention drift when work does not line up with the brief.
- If no brief exists, say so and rely on checkpoints plus `docs/plans/`.

## Format

For multiple projects, group by project.

For one project, use:

- `Done`
- `Next`
- `Blocked`

Keep it short enough to read in one pass.
