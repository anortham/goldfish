---
description: Recall recent work context
---

# Recall Context

Restore recent work context using the recall tool:

```
recall({
  $1
})
```

Arguments (all optional):
- days: Number of days to look back (default: 2)
- search: Fuzzy search term
- workspace: "current" (default), "all", or specific path

After recall, summarize:
1. Active plan (if present)
2. Recent checkpoints (grouped by date)
3. Key themes or patterns in the work
