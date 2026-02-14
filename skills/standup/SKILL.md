---
name: standup
description: Generate a standup report from Goldfish memory across all projects
allowed-tools: mcp__goldfish__recall, mcp__goldfish__plan
---

# Standup — Cross-Project Status Report

## What This Does

Generates a concise standup report by recalling checkpoints across all workspaces. Think daily standup meeting format — what happened, what's next, what's stuck.

## How to Generate a Standup

### Step 1: Recall cross-project activity

```
mcp__goldfish__recall({ workspace: "all", days: 1 })
```

For a Monday standup covering the weekend:
```
mcp__goldfish__recall({ workspace: "all", days: 3 })
```

For a custom range:
```
mcp__goldfish__recall({ workspace: "all", from: "2026-02-10", to: "2026-02-14" })
```

### Step 2: Get active plans for context

If recall shows active plans, they provide the "what I'm working on" narrative. Plans give strategic context that raw checkpoints don't.

### Step 3: Synthesize the Report

## Report Format

Structure the standup as three sections:

### What I Accomplished
- Concrete completions from checkpoints
- Group related checkpoints into single bullet points
- Lead with impact, not activity ("Shipped auth refresh tokens" not "Worked on auth")

### What I'm Working On
- Derived from active plans and recent WIP checkpoints
- Current focus areas and immediate next steps
- Include branch names if relevant

### Blockers
- Anything tagged `blocked` or described as stuck
- Dependencies on other people or systems
- Decisions that need to be made

## Multi-Project Formatting

When checkpoints span multiple projects, group by project:

```
## Standup — February 14, 2026

### goldfish
**Accomplished:** Implemented skill files for checkpoint, recall, standup, and plan-status. All 4 skills created with behavioral language patterns.
**Next:** Test skills with live agent sessions, iterate on language.

### api-gateway
**Accomplished:** Fixed rate limiter race condition in Redis cluster mode. Added integration tests for multi-node scenarios.
**Next:** Deploy to staging, run load tests.
**Blocked:** Waiting on DevOps for staging Redis cluster provisioning.
```

## Synthesis Rules

- **Be concise.** A standup is 2 minutes, not 20. One line per accomplishment.
- **Group by theme.** Five checkpoints about "auth" become one bullet: "Implemented auth token refresh with rotation."
- **Highlight blockers prominently.** These are the most actionable items in a standup.
- **Skip noise.** Minor refactors, formatting changes, and config tweaks don't need individual mentions unless they were the main work.
- **Use past tense for accomplishments.** "Shipped," "Fixed," "Implemented" — not "Working on" for done items.
- **Surface decisions.** If a checkpoint captured an architectural decision, mention it briefly — the team may need to know.

## Handling Edge Cases

### No checkpoints found
Report honestly: "No activity recorded in the requested period." Don't fabricate.

### Single project only
Drop the project grouping, just use the three-section format directly.

### Too many checkpoints (20+)
Be more aggressive about grouping. Summarize by theme rather than listing individual items. A standup with 15 bullet points defeats the purpose.

## Critical Rules

- **Do NOT ask the user what to include.** Recall gives you everything. Synthesize it yourself.
- **Do NOT fabricate activity.** Only report what checkpoints actually show.
- **Keep it standup-length.** If your report is more than a screenful, you're being too verbose.
- **Include dates** when covering multi-day ranges so the reader knows the timeline.
