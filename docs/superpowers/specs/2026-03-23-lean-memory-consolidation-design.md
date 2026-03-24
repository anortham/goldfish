# Lean MEMORY.md Consolidation

## Problem

MEMORY.md consolidation produces bloated documents (150+ lines) that overlap heavily with CLAUDE.md and information derivable from the codebase. This burns tokens at every session start for marginal value. A 153-line MEMORY.md for one project contained architecture descriptions, module inventories, and phase histories that could all be obtained by reading the code or running git log.

## The Rule

**If you can derive it from the codebase, git log, or tools, it doesn't belong in MEMORY.md.**

MEMORY.md exists for things that are hard to reconstruct: the reasoning behind decisions, open questions, deferred work context, and gotchas that burned time.

## What Belongs in MEMORY.md

- **Decisions + rationale**: "chose LanceDB over sqlite-vec because X" (the why isn't in the code)
- **Open questions**: unresolved uncertainties, things still being evaluated
- **Deferred work with context**: what's blocked and why, what's needed to unblock
- **Gotchas**: non-obvious things discovered through experience that would burn time again

## What Does NOT Belong

- Architecture descriptions (read the code)
- Module/file inventories (use tools like Julie, glob)
- Phase histories and changelogs (git log)
- Feature lists (read the files)
- Infrastructure/config details (read configs)
- Current state summaries (git status, tests)

## Line Budget (Traffic Light)

No hard runtime enforcement. The consolidation prompt guides the subagent:

- **Green**: under 25 lines. Healthy.
- **Yellow**: 25-40 lines. Don't add without removing something.
- **Red**: over 40 lines. Must remove something before adding.

No prescribed section template. No required headers. Content dictates structure.

## Age Window: 30 Days

Checkpoints older than 30 days are excluded from consolidation. The lifecycle:

1. **Fresh** (days): raw checkpoints, recalled directly via last-N
2. **Recent** (weeks): synthesized into MEMORY.md as decisions/rationale/gotchas
3. **Durable** (months): promoted to CLAUDE.md by the human, or discoverable via semantic search

The handler applies the 30-day filter before batching. Older checkpoints remain in `.memories/` for semantic search but are not synthesized into MEMORY.md. Truly durable knowledge should live in CLAUDE.md.

## Changes

### `src/handlers/consolidate.ts`

Add a 30-day age filter after the unconsolidated filter and before the batch cap:

```
unconsolidated checkpoints
  -> filter to last 30 days
  -> filter to .md files
  -> if all: true, take all; otherwise slice at 50
```

The `all` parameter bypasses the batch size cap (50), not the age window. `consolidate({ all: true })` means "all unconsolidated checkpoints from the last 30 days in one batch."

### `src/consolidation-prompt.ts`

Rewrite synthesis instructions:

1. Replace the current synthesis guidance with the litmus test and explicit keep/kill lists
2. Replace the 500-line hard cap with the traffic light budget (25/40 lines)
3. Drop the prescribed section template (Project Overview, Architecture, etc.)
4. Add age-out guidance: entries about work older than 30 days should be removed to make room for recent decisions

### No other files change

Handler structure, memory.ts, recall pipeline, tools.ts, skills, hooks all stay as-is.

## Expected Outcome

A typical MEMORY.md shrinks from 150+ lines to 15-25 lines. Session start recall becomes cheap enough that `includeMemory: true` as default is a non-issue even in tight context windows.
