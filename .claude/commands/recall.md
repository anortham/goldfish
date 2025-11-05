---
description: Recall recent work context with semantic search and LLM distillation
---

# Recall Context

Restore recent work context using the recall tool with RAG capabilities.

**Usage:**
- `/recall` or `/recall 2h` → Basic time-based recall
- `/recall smart <query>` → Semantic search with distillation
- `/recall search <query>` → Semantic search only

```
if "$ARGUMENTS" starts with "smart ":
  recall({
    search: "$ARGUMENTS after 'smart '",
    semantic: true,
    distill: true,
    days: 7
  })
else if "$ARGUMENTS" starts with "search ":
  recall({
    search: "$ARGUMENTS after 'search '",
    semantic: true,
    days: 7
  })
else if "$ARGUMENTS":
  recall({
    since: "$ARGUMENTS"
  })
else:
  recall()
```

## Basic Arguments:
- since: Human-friendly time span ("2h", "30m", "3d") or ISO timestamp
- days: Number of days (default: 2)
- search: Search term (use with semantic for intelligent search)
- workspace: "current" (default), "all", or specific path

## RAG Arguments (NEW):
- semantic: true/false - Use semantic search to find conceptually similar work
- minSimilarity: 0.0-1.0 - Minimum similarity threshold (default: 0.0)
- distill: true/false - Enable LLM distillation for compact summaries
- distillProvider: "auto", "claude", "gemini", or "none"
- distillMaxTokens: Max tokens for summary (default: 500)

## Examples:

**Basic recall:**
- recall() → last 2 days (default)
- recall({ since: "2h" }) → last 2 hours
- recall({ days: 7 }) → last 7 days

**Fuzzy search:**
- recall({ search: "auth" }) → keyword search

**Semantic search (finds conceptually similar work):**
- recall({ search: "authentication bugs", semantic: true })
- recall({ search: "database performance", semantic: true, minSimilarity: 0.7 })

**Full RAG pipeline (semantic + distillation):**
- recall({ search: "auth work", semantic: true, distill: true })
- recall({ search: "recent features", semantic: true, distill: true, distillMaxTokens: 300 })

After recall, summarize:
1. Active plan (if present)
2. Search method used (semantic/fuzzy/none)
3. Recent checkpoints (grouped by date)
4. Distilled summary (if enabled) with token reduction percentage
5. Key themes or patterns in the work
