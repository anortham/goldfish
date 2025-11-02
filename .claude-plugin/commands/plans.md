---
name: plans
description: List, view, and manage long-term plans across workspaces
---

# Plans Command

Manage long-term strategic plans that survive context resets and crashes.

## Task

Parse the command for different operations:

### 1. List All Plans (Default)
`/plans` or `/plans list`

```
Call: plan({ action: "list" })

Present as:
📋 Active Plans

🎯 goldfish - "Goldfish 4.0 Release" (active)
   Created: 2025-10-15
   Updated: 2025-11-01
   Tags: release, testing, documentation

🎯 julie - "Cross-Language Call Tracing" (active)
   Created: 2025-10-20
   Tags: feature, performance

💤 Completed Plans (2)
📦 Archived Plans (1)
```

### 2. View Specific Plan
`/plans [plan-id]` or `/plans show [plan-id]`

```
Call: plan({ action: "get", id: "[plan-id]" })

Present full plan content with:
- Title and status
- Created/updated timestamps
- Tags
- Full markdown content
- Related checkpoints (search by plan ID in tags)
```

### 3. Activate Plan
`/plans activate [plan-id]`

```
Call: plan({ action: "activate", id: "[plan-id]" })

Confirm activation and show plan summary
```

### 4. Complete Plan
`/plans complete [plan-id]`

```
Call: plan({ action: "complete", id: "[plan-id]" })

Mark plan as completed and celebrate!
```

### 5. Cross-Workspace View
`/plans --all`

```
Call: plan({ action: "list" })
// Note: Plan tool returns all workspaces by default

Show plans grouped by workspace
```

## Output Formats

### List View
```markdown
📋 Active Plans

🎯 [workspace] - "[title]" ([status])
   Created: [date]
   Updated: [date] ([X] days ago)
   Tags: [tag1, tag2, tag3]
   Progress: [summary from recent checkpoints]

---
Total: 2 active, 3 completed, 1 archived
```

### Detailed View
```markdown
📋 Plan: "Goldfish 4.0 Release"

**Status:** active ✅
**Workspace:** goldfish
**Created:** 2025-10-15
**Last Updated:** 2025-11-01 (1 day ago)
**Tags:** release, testing, documentation

---

## Goals
- Complete test suite (115 tests) ✅
- Implement atomic file operations ✅
- Add cross-workspace recall ✅
- Write comprehensive documentation
- Publish to npm

## Current Phase
Documentation and release preparation

## Recent Checkpoints
📅 2025-11-01 14:30 - Completed 115 test suite
📅 2025-10-31 16:00 - Added cross-workspace recall

---
4 checkpoints related to this plan
```

### Empty State
```markdown
📋 No Plans Yet

Plans help you track long-term work that spans multiple sessions.

Create a plan during your next planning session, or let Claude
create one when working on larger features.
```

## Command Variations

Support these formats:
```
/plans                    # List all plans
/plans list               # List all plans
/plans --all              # All workspaces
/plans auth-redesign      # View specific plan
/plans show auth-redesign # View specific plan
/plans activate auth-redesign
/plans complete auth-redesign
```

## Key Behaviors

- Default to current workspace
- Show active plans prominently
- Include time context (days ago)
- Link to related checkpoints
- Suggest creating plan if none exist
- Celebrate plan completion

## Error Handling

- If plan ID not found, list available plans
- If plan tool fails, explain the error
- If no plans exist, show helpful empty state

## Integration with Checkpoints

When viewing a plan, search for related checkpoints:
```
recall({
  search: "plan:[plan-id]",
  days: 90
})
```

This shows all checkpoints tagged with the plan ID.

## Examples

```
/plans
/plans --all
/plans auth-redesign
/plans activate payment-system
/plans complete goldfish-release
```
