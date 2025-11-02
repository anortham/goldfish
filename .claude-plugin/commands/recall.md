---
name: recall
description: Search and retrieve checkpoints from memory with fuzzy search
---

# Recall Command

Search persistent memory for specific checkpoints, branches, or work topics.

## Task

1. **Parse user input for search terms:**
   - `/recall authentication` - Search for "authentication"
   - `/recall bug fix redis` - Search for "bug fix redis"
   - `/recall 7` - Last 7 days (no search)
   - `/recall` - Last 7 days, current workspace

2. **Call recall with appropriate parameters:**
   ```
   // With search query
   recall({
     search: "[user's search terms]",
     days: 7,
     workspace: "current"
   })

   // Without search (time-based only)
   recall({
     days: [N],
     workspace: "current"
   })
   ```

3. **Present results clearly:**
   - Show matching checkpoints with relevance
   - Include git context (branch, files)
   - Highlight search matches
   - Show active plan if relevant

## Input Patterns

Detect these patterns:

### Search Query
`/recall redis cache` → `recall({ search: "redis cache", days: 7 })`

### Time Range
`/recall 14` → `recall({ days: 14 })`

### Cross-Workspace Search
`/recall --all authentication` → `recall({ search: "authentication", workspace: "all" })`

### Combined
`/recall --all 30 bug` → `recall({ search: "bug", days: 30, workspace: "all" })`

## Output Format

### With Search Results
```markdown
🔍 Search Results for "authentication"

📅 2025-11-01 14:30
**Fixed JWT authentication timeout bug**
Branch: feature/auth-improvements
Files: src/auth/jwt.ts, tests/auth.test.ts
Tags: bug-fix, auth, critical

Implemented refresh token rotation to prevent timeout issues.

📅 2025-10-28 10:15
**Added authentication middleware for API endpoints**
Branch: feature/api-auth
Files: src/middleware/auth.ts
Tags: feature, auth, api

Created JWT verification middleware with role-based access.

---
Found 2 matches in last 7 days
```

### Time Range (No Search)
```markdown
📝 Recent Checkpoints - Last 7 days

📅 2025-11-01 14:30 - Fixed JWT authentication timeout bug
📅 2025-11-01 12:00 - Completed payment integration tests
📅 2025-10-31 16:45 - Refactored database query layer
📅 2025-10-30 11:20 - Added WebSocket reconnection logic
...

Total: 12 checkpoints
```

### No Results
```markdown
🔍 No checkpoints found matching "foobar"

Try:
- Broader search terms
- Increase time range: /recall 30 foobar
- Search all workspaces: /recall --all foobar
```

## Flags

Support these optional flags:
- `--all` - Search across all workspaces (not just current)
- `--days N` - Search last N days (alternative to positional argument)

## Key Behaviors

- Default to current workspace only
- Default to 7 days if no time specified
- Use fuzzy search (matches partial terms)
- Show most recent matches first
- Include enough context to be useful
- Suggest refinements if no results

## Examples

```
/recall authentication
/recall 14
/recall --all redis
/recall bug fix
/recall --days 30 payment
```

## Error Handling

- If recall fails, explain the error
- If no checkpoints exist yet, explain Goldfish is starting fresh
- If search is too broad, suggest narrowing with tags or time
