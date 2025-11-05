---
description: Generate concise standup report across all workspaces with LLM distillation
---

# Standup Report

Generate a standup report showing work across ALL workspaces with optional LLM distillation:

**With distillation (recommended for many checkpoints):**
```
recall({
  workspace: "all",
  days: $1,
  search: "completed work and progress",
  distill: true,
  distillMaxTokens: 400
})
```

**Without distillation (for few checkpoints):**
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
- Use distilled summary if available (more concise)

## What I'm Working On
- Current active plans
- In-progress items

## Blockers
- Any issues or blockers mentioned in checkpoints

Keep it concise - this is for a standup meeting. LLM distillation can reduce token usage by 70-90%!
