---
description: Recall recent work context
---

# Recall Context

Restore recent work context using the recall tool:

```
recall({
  since: "$1"
})
```

Arguments (all optional):
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp
- days: Number of days (default: 2)
- search: Fuzzy search term
- workspace: "current" (default), "all", or specific path

Examples:
- recall() → last 2 days (default)
- recall({ since: "2h" }) → last 2 hours
- recall({ since: "30m" }) → last 30 minutes
- recall({ days: 7 }) → last 7 days
- recall({ search: "auth" }) → search in last 2 days

After recall, summarize:
1. Active plan (if present)
2. Recent checkpoints (grouped by date)
3. Key themes or patterns in the work
