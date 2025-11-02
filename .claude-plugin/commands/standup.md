---
name: standup
description: Generate a cross-workspace standup report showing recent work across all projects
---

# Standup Report Command

Generate a comprehensive standup report showing checkpointed work across all workspaces.

## Task

1. **Call recall with cross-workspace parameters:**
   ```
   recall({
     workspace: "all",
     days: 1,  // default to yesterday's work
     limit: 50
   })
   ```

2. **Format the results as a standup report:**
   - Group checkpoints by workspace
   - Show checkpoint count per workspace
   - Display key accomplishments
   - Highlight active plans

3. **Present in this format:**
   ```markdown
   📊 Standup Report - Last [N] day(s)

   🎯 [workspace-1] ([count] checkpoints)
     ✅ [checkpoint description]
     ✅ [checkpoint description]
     📋 Active: [plan title]

   🎯 [workspace-2] ([count] checkpoints)
     ✅ [checkpoint description]
     ...

   💡 Highlights:
   - [Notable achievements]
   - [Patterns across workspaces]
   ```

## Optional Arguments

Users may specify:
- `/standup 7` - Last 7 days
- `/standup 2` - Last 2 days
- `/standup` - Defaults to 1 day (yesterday)

Parse the argument as the number of days to include.

## Example Output

```markdown
📊 Standup Report - Last 1 day

🎯 goldfish (4 checkpoints)
  ✅ Implemented atomic file operations for crash safety
  ✅ Added cross-workspace recall with parallelization
  ✅ Fixed empty workspace name edge cases
  ✅ Completed 115 test suite
  📋 Active: "Goldfish 4.0 Release"

🎯 julie (3 checkpoints)
  ✅ Implemented fuzzy_replace tool with DMP algorithm
  ✅ Fixed UTF-8 handling in string mutations
  ✅ Added 18 comprehensive unit tests

🎯 sherpa (2 checkpoints)
  ✅ Enhanced celebration generator with workflow-specific metaphors
  ✅ Fixed race condition in state coordinator
  📋 Active: "Behavioral Adoption System"

💡 Highlights:
- Strong focus on test coverage across all projects
- Multiple critical bug fixes delivered
- 3 active plans progressing simultaneously
```

## Error Handling

- If no checkpoints found, explain this is a fresh start
- If recall fails, report the error clearly
- If only one workspace has activity, still show the report format

## Key Behaviors

- Default to 1 day unless specified
- Show ALL workspaces with activity (not just current)
- Include active plans for context
- Keep format scannable and concise
- Highlight cross-project patterns
