---
description: Generate standup report across all workspaces
---

# Standup Report

Generate a standup report showing work across ALL workspaces:

```
recall({
  workspace: "all",
  days: $1
})
```

Default: yesterday's work (1 day)

Then format the results as a standup report:

## What I Accomplished
- List completed work by workspace
- Focus on outcomes, not minutiae

## What I'm Working On
- Current active plans
- In-progress items

## Blockers
- Any issues or blockers mentioned in checkpoints

Keep it concise - this is for a standup meeting.
