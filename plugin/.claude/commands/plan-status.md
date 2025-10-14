---
description: Show active plan status
---

# Plan Status

Show the current active plan and all plans:

```
recall({
  workspace: "current"
})
```

This will show the active plan at the top of the results.

Then list all plans:

```
plan({
  action: "list",
  workspace: "current"
})
```

Summarize:
1. Active plan title and key goals
2. Recent progress (from checkpoints related to the plan)
3. Other available plans
4. Recommendation on whether the active plan should be updated based on recent checkpoints
