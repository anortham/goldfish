---
name: plan
description: Create and manage persistent plans in Goldfish memory — use when starting multi-session work, making architectural decisions, or when the user discusses project direction, roadmaps, or design decisions that need to persist across sessions
allowed-tools: mcp__goldfish__plan
---

# Plan — Persistent Strategic Plans

## The Core Idea

Plans capture strategic direction that must survive across sessions. When you start multi-session work or make architectural decisions, save a plan immediately — the reasoning is fresh now and won't be available later. When work is done, mark the plan complete so future sessions don't waste effort on finished goals. A stale plan actively misleads; it's worse than having no plan at all.

## When to Create a Plan

Plans matter most when context needs to survive session boundaries. Without a plan, the next session starts from scratch.

- **Starting multi-session work** — save a plan with goals and approach so the next session knows where to pick up
- **After architectural decisions** — capture the direction immediately so future sessions don't re-derive or contradict it
- **After brainstorming/design sessions** — the approved design should outlive the conversation that produced it
- **New features spanning multiple sessions** — a plan keeps the thread when context compacts or sessions end
- **User describes project direction or roadmap** — that strategic context is exactly what plans are for

## How to Create a Plan

```
mcp__goldfish__plan({
  action: "save",
  title: "Auth System Overhaul",
  content: "## Goals\n\n- Migrate from session tokens to JWT...\n\n## Approach\n\n...\n\n## Tasks\n\n- [ ] Task 1\n- [ ] Task 2",
  tags: ["feature", "auth"],
  activate: true
})
```

### Plan Content Structure

Structure your plan content with clear sections:

1. **Goals** — what are we trying to achieve?
2. **Approach** — how are we going to do it?
3. **Tasks** — checklist of deliverables (use `- [ ]` / `- [x]`)
4. **Constraints** — anything we need to avoid or work around

### Key Parameters

- **activate: true** — set this so the plan appears at the top of every `recall()` response. Without activation, future sessions won't see the plan and the strategic direction is effectively lost.
- **tags** — categorize for search. Use consistent tags across checkpoints and plans.
- **id** — auto-generated from title. Only override if you need a specific slug.

## Managing Plan Lifecycle

### Check current plans
```
mcp__goldfish__plan({ action: "list" })
```

### Update a plan (add progress, change scope)
```
mcp__goldfish__plan({
  action: "update",
  id: "auth-system-overhaul",
  updates: {
    content: "## Goals\n\n...(updated content with progress noted)..."
  }
})
```

### Mark a plan complete
```
mcp__goldfish__plan({ action: "complete", id: "auth-system-overhaul" })
```

### Archive a superseded plan
```
mcp__goldfish__plan({
  action: "update",
  id: "old-plan",
  updates: { status: "archived" }
})
```

## The Active Plan

Only ONE plan can be active per workspace. The active plan:
- Appears at the top of every `recall()` response
- Guides all work in the project
- Should reflect the current strategic direction

If priorities shift, either update the active plan or archive it and create a new one.

## Why These Rules Matter

Plans exist so future sessions know the strategic direction. A plan that isn't activated or maintained actively harms future work — it's worse than having no plan at all.

- **Activate plans** so they appear in `recall()`. An inactive plan is invisible to future sessions, which defeats the purpose of creating it.
- **Mark plans complete when done.** A stale active plan misleads every future session into thinking work is still in progress and wastes effort re-investigating completed goals.
- **Complete or archive abandoned plans.** Orphaned active plans create confusion about what's actually being worked on.
- **Update plans as work progresses.** Check off tasks, note scope changes, record decisions — a plan that doesn't reflect reality isn't useful.
- **Plans are forward-looking, checkpoints are backward-looking.** Plans capture where you're going. Checkpoints capture where you've been. Use both — they serve different purposes.
