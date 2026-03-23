# Memory Consolidation Design

**Date:** 2026-03-23
**Scope:** Goldfish plugin (general-purpose) + Sealab/XO integration (consumer-specific)
**Status:** Design approved, pending implementation

## Problem

Goldfish does checkpointing well but has no consolidation. Every session starts by loading N raw checkpoints and reasoning about them from scratch. This wastes tokens, loses signal in noise as checkpoints accumulate, and fails to build cumulative understanding. The original vision for Goldfish was event sourcing: events (checkpoints) should periodically collapse into state (understanding). That collapse never got built.

## Core Concept: Event Sourcing for Developer Memory

Checkpoints are events. MEMORY.md is the snapshot. Unconsolidated checkpoints are the delta since the last snapshot. Recall replays the delta on top of the snapshot to give current state.

This maps to three memory types (per Google's 2025 agent memory whitepaper):
- **Procedural** (CLAUDE.md): How to operate. Rules, conventions, workflows.
- **Semantic** (MEMORY.md): What is known. Accumulated understanding, decisions, current state.
- **Episodic** (Checkpoints): What happened. Timeline of events, immutable.

## The Three-Layer Memory Model

Every Goldfish-enabled project gets three layers in `.memories/`:

```
.memories/
├── MEMORY.md              # Semantic layer (consolidated understanding)
├── .last-consolidated     # Canonical consolidation timestamp (plain ISO 8601 string)
├── plans/                 # Strategic plans (unchanged from today)
│   └── {plan-id}.md
├── 2026-03-22/            # Episodic checkpoints (unchanged)
│   ├── 191537_ddd8.md
│   └── 210128_f4b2.md
└── 2026-03-23/
    └── 151400_354f.md
```

### MEMORY.md

The project's accumulated understanding. Written in natural prose. Hard cap at 500 lines. No frontmatter; all metadata lives in `.last-consolidated` (see below).

Example:

```markdown
## Project Overview
Sealab is Murphy's personal second brain and assistant...

## Architecture
Four-tier memory system: Sparks (knowledge base), Goldfish (dev memory)...

## Key Decisions
- Chose LanceDB over SQLite for vector store because...
- Voice cloning uses Chatterbox TTS locally, not cloud API...

## Current State
Arr stack skills (Lidarr, Sonarr, Radarr) built and ready for testing...

## Active Concerns
- Sonarr has 3 removed TVDB series to clean up
- DJ skill Chrome automation is slow
```

### .last-consolidated

A small file containing a single JSON object. This is the **canonical source of truth** for consolidation state. MEMORY.md has no frontmatter; all consolidation metadata lives here.

```json
{
  "timestamp": "2026-03-23T15:14:00Z",
  "checkpointsConsolidated": 12
}
```

- `timestamp`: ISO 8601 UTC. When consolidation last completed. All staleness comparisons use this value. Never use MEMORY.md filesystem mtime (fragile: branch checkouts, editors, copies can change it).
- `checkpointsConsolidated`: Running total across all consolidations. Subagent reads previous value and increments by the number of checkpoints in the current batch.

### Checkpoints (unchanged)

Still append-only, still searchable, still valuable for timeline and forensics. Consolidation reads them but never modifies or deletes them.

### Plans (unchanged)

Strategic documents, same lifecycle as today.

## The Consolidation Pipeline

### The `consolidate()` Tool

When called, does the following (all cheap, no LLM call):

1. Loads current MEMORY.md (or empty string if first consolidation)
2. Reads `.last-consolidated` timestamp (or epoch zero if first consolidation)
3. Loads all checkpoints since that timestamp (full checkpoint objects with all fields: description, type, tags, context, decision, alternatives, impact, evidence, symbols, next, confidence, unknowns, git, planId)
4. Loads the active plan (if any) for additional context
5. Packages everything into a consolidation payload
6. Returns the payload to the calling agent with a subagent prompt template

Return shape:

```json
{
  "status": "ready",
  "currentMemory": "## Project Overview\nSealab is...",
  "unconsolidatedCheckpoints": [
    {
      "timestamp": "2026-03-23T15:14:00Z",
      "description": "## Built Lidarr skill...",
      "type": "checkpoint",
      "tags": ["lidarr", "skill"],
      "decision": "Used Lidarr API v1 because...",
      "alternatives": "Considered direct database access but...",
      "impact": "Media management now automated",
      "symbols": ["LidarrClient", "search_artist"],
      "next": "Test in live session",
      "git": { "branch": "main", "commit": "abc123" }
    }
  ],
  "activePlan": "...",
  "checkpointCount": 3,
  "lastConsolidated": { "timestamp": "2026-03-22T21:30:00Z", "checkpointsConsolidated": 9 },
  "prompt": "You are a memory consolidation agent..."
}
```

If there are zero unconsolidated checkpoints, returns `{ "status": "current", "message": "Memory is up to date." }` and skips the payload.

**First consolidation (bootstrap):** When no MEMORY.md exists yet, `consolidate()` loads up to the most recent 50 checkpoints (newest first). If the project has more than 50, the subagent notes the starting point and subsequent consolidations pick up from there. 50 is a practical cap to stay within subagent context limits; checkpoint descriptions can be long.

### The Consolidation Subagent

The calling agent dispatches a subagent (background, non-blocking) with the prompt template from `consolidate()`. The subagent writes files directly using standard file tools (Write/Edit). There is no round-trip back through Goldfish's MCP tools.

The subagent:

1. Reads current MEMORY.md as baseline (from the payload, no file read needed)
2. Reads each unconsolidated checkpoint (from the payload)
3. If an active plan is provided, uses it to understand project direction and prioritize what's durable
4. Synthesizes: extracts durable facts, updates existing sections, adds new sections
5. **Overwrites contradictions**: "switched from X to Y" updates memory to Y, doesn't keep both
6. **Prunes ephemeral details**: doesn't carry forward "tried A then B then C," carries forward "chose C because A had problem X"
7. **Preserves document voice**: prose, not bullet-point soup
8. **Respects the 500-line hard cap**: if the document would exceed 500 lines, compress or remove sections about resolved concerns and completed work. Prioritize recent and high-impact information.
9. Writes updated MEMORY.md to `.memories/MEMORY.md` (using Write tool)
10. Writes updated `.last-consolidated` with new timestamp and incremented `checkpointsConsolidated` count (using Write tool)

The subagent does NOT:
- Delete or modify checkpoints (immutable episodic records)
- Touch plans
- Make any changes outside `.memories/MEMORY.md` and `.memories/.last-consolidated`

### Who Does What

- **Goldfish** (`consolidate()` tool): Gathers materials, provides subagent prompt template. Read-only; does not write files.
- **Calling agent**: Receives payload, dispatches subagent with it (one Agent tool call). Not blocked.
- **Subagent**: Does the LLM synthesis, writes MEMORY.md and .last-consolidated directly via file tools.

## Recall Evolution

Recall changes from "here are your last N checkpoints" to a smarter response:

### Three Parts

**Part 1: Semantic Memory (default recall)**
MEMORY.md content. Primary context. One document, full project understanding.

**Part 2: Delta Checkpoints (included when stale)**
Checkpoints with timestamps after `.last-consolidated` timestamp. Events not yet synthesized. Omitted entirely if delta is empty.

**Part 3: Consolidation Flag (metadata)**
```
consolidation: { needed: true, staleCheckpoints: 3, lastConsolidated: "2026-03-23T15:14:00Z" }
```
Reads `.last-consolidated` file and compares against checkpoint timestamps. No LLM call, just timestamp comparison.

### MEMORY.md Inclusion Logic

| Scenario | Call | Gets MEMORY.md? |
|---|---|---|
| New session (SessionStart hook) | `recall()` | Yes, full document |
| After `/clear` (SessionStart hook) | `recall()` | Yes, full document |
| Searching for past work | `recall({ search: "voice" })` | Only matching sections |
| Manual re-orient | `recall({ includeMemory: true })` | Yes, forced on |
| Just want checkpoints | `recall({ includeMemory: false })` | No, skipped |

Default recall (no search param): `includeMemory` defaults to `true`.
Search recall (search param provided): `includeMemory` defaults to `false`. MEMORY.md sections are in the search index (chunked by `##` header) and show up in results if they match.

### `includeMemory` Parameter

New optional parameter on `recall()`. Controls whether the full MEMORY.md is included in the response.

- Defaults to `true` when no `search` param (bootstrap mode)
- Defaults to `false` when `search` param is provided (search mode)
- Can be explicitly overridden in either direction

**NOTE:** Tool descriptions must be precise about this defaulting behavior. Ambiguous descriptions lead to agents misusing the parameter. Be explicit about which mode you're in and what the default is for that mode.

### Semantic Search Integration

MEMORY.md is indexed for semantic search, chunked by `##` headers. Each section becomes its own searchable record with an ID like `memory_section_{header_slug}` (e.g., `memory_section_key-decisions`).

**Re-indexing lifecycle:** After consolidation writes a new MEMORY.md, the old section records are invalidated (via content hash comparison, same pattern as checkpoint digest staleness). On the next recall that triggers semantic maintenance, stale sections are re-chunked and re-embedded. This uses the existing bounded-maintenance pipeline (at most 3 records + ~150ms per recall pass). A full MEMORY.md rewrite with 5-6 sections will be fully re-indexed within 2-3 recall cycles.

When searching, MEMORY.md sections rank alongside checkpoint results in the hybrid search pipeline.

### Cross-Project Recall Enhancement

`recall({ workspace: "all" })` currently returns `WorkspaceSummary` objects with `name`, `path`, `checkpointCount`, and `lastActivity`. With this change, each summary gains a `memorySummary` field: the first 3-5 lines of the project's MEMORY.md (up to the first `##` header or 300 characters, whichever comes first). This gives standup reports a human-readable project summary without loading full MEMORY.md files for every project.

Projects with no MEMORY.md yet return `memorySummary: null` and continue showing checkpoint counts as today.

## Consolidation Triggers (Four Safety Nets)

| Trigger | When | Catches |
|---|---|---|
| **PreCompact hook** | Context window filling up | Long sessions that exhaust context |
| **Recall staleness detection** | Next session's bootstrap recall | Sessions that ended without consolidating |
| **Explicit `consolidate()` tool** | Agent or user calls it | Manual control, any time |
| **Consumer's scheduled beat** | Configured by consumer (e.g., XO's evening wrap-up) | Scheduled cadence |

### PreCompact Hook (updated, Bun script)

Currently a dumb echo string. Updated to a Bun script that:
1. Reads `.last-consolidated` timestamp
2. Counts checkpoint files with dates after that timestamp
3. Only injects consolidation instructions if there's actually a delta
4. Skips consolidation prompt if MEMORY.md is already fresh

```
Your conversation is about to be compacted. First, checkpoint your current progress.
Then, if there are unconsolidated checkpoints, call consolidate() and dispatch a
background subagent to update the project memory.
```

**Constraint:** Hooks are Bun scripts because Goldfish requires Bun as a runtime dependency. If Goldfish ever ships as an npm package installable without Bun, hooks would need to be portable Node scripts or shell scripts. For now, Bun is a hard requirement.

### SessionStart Hook (updated, Bun script)

Updated to a Bun script that checks state and tailors instructions:
- If MEMORY.md exists and is stale: "Call recall(). You have N unconsolidated checkpoints; dispatch consolidation after orienting."
- If MEMORY.md exists and is fresh: "Call recall(). Memory is up to date."
- If no MEMORY.md: "Call recall(). No consolidated memory exists yet; consider running consolidation after your first few checkpoints."

### Recall Staleness Detection (automatic)

Baked into recall. Reads `.last-consolidated` file and compares timestamp against checkpoint timestamps. Returns consolidation flag in response metadata. Agent behavioral instructions say: "If recall flags consolidation needed, dispatch a background consolidation subagent."

### Explicit `consolidate()` Tool

Available any time. Returns payload + subagent prompt. Consumer decides when to call.

## Boundaries and Non-Overlap

### CLAUDE.md vs MEMORY.md

| | CLAUDE.md | MEMORY.md |
|---|---|---|
| **Type** | Procedural | Semantic |
| **Contains** | How to operate: rules, conventions, tool quirks | What is known: decisions, state, understanding |
| **Who writes it** | Human (or human-approved) | Consolidation subagent |
| **Mutability** | Edited deliberately | Rewritten on consolidation |
| **Injected** | Every turn (by harness) | On recall (by Goldfish) |

**Litmus test:** "Is this an instruction or a fact?" Instructions go in CLAUDE.md. Facts go in MEMORY.md.

### Goldfish MEMORY.md vs Harness Auto-Memory

- **Auto-memory** (.claude/memory/): Cross-project personal knowledge. User preferences, feedback, references. Follows the user across all projects.
- **Goldfish MEMORY.md**: Project-scoped understanding. What this project is, what's been decided, where it stands. Lives with the project.

No overlap. Auto-memory is "who am I working with." MEMORY.md is "what am I working on."

### For XO Specifically (Full Stack)

| Layer | System | Scope | Lifespan | Example |
|---|---|---|---|---|
| Procedural | CLAUDE.md | Per-project | Permanent | "Use `uv run pytest -q` for tests" |
| Semantic (project) | Goldfish MEMORY.md | Per-project | Rewritten on consolidation | "Arr stack ready for live testing" |
| Semantic (personal) | Auto-memory | Cross-project | Updated as learned | "Murphy prefers direct communication" |
| Episodic | Goldfish checkpoints | Per-project | Append-only, permanent | "2026-03-23: Built Lidarr skill" |
| Knowledge | Sparks | Cross-project | Permanent | "Murphy had CABG surgery Dec 2025" |
| Ephemeral | SESSION-STATE.md | Per-session | Cleaned daily | "Debugging mail skill inbox parsing" |

## XO Integration (Sealab-Specific)

### Two Workspaces, Two MEMORY.md Files

- **`~/sealab/.memories/MEMORY.md`**: XO's brain memory. State of the ship, ongoing concerns, Murphy's life context.
- **`~/source/sealab/.memories/MEMORY.md`**: Developer memory for the engine. Architecture, recent code changes, technical decisions.

Both are standard Goldfish project-scoped MEMORY.md files. No special XO logic needed.

### Evening Beat Consolidation

XO's evening wrap-up (existing HEARTBEAT.md beat) gains one step: call `consolidate()` for the `~/sealab` workspace and dispatch a background subagent. Tomorrow's bootstrap recall gets fresh synthesis.

### SESSION-STATE.md Scope Reduction

With MEMORY.md capturing durable project state, SESSION-STATE.md can focus purely on ephemeral working context: current task, immediate blockers, mood. It no longer needs to awkwardly preserve project state across compaction.

### Cross-Project Standup

`recall({ workspace: "all" })` returns each project's `memorySummary` (first lines of MEMORY.md) alongside checkpoint counts. Standup reports go from "sealab: 3 checkpoints" to "sealab: Sealab is Murphy's personal second brain... (3 checkpoints, last activity 2h ago)."

## Implementation Notes

### Source Control

`.memories/` (including MEMORY.md) MUST always be committed to source control. This is a Goldfish server-level instruction, not project-specific. MEMORY.md is the consolidated understanding of the project; losing it to a .gitignore forces a full rebuild from checkpoints. This instruction must appear in Goldfish's plugin-level behavioral text so it applies to all consumers without per-project configuration.

### Tool Description Precision

Tool descriptions for `recall()` and `consolidate()` must be detailed and unambiguous about:
- Default behavior for each parameter
- How `includeMemory` interacts with `search`
- What the consolidation flag means and what the agent should do about it
- When MEMORY.md is vs isn't included

Ambiguous tool descriptions are the #1 cause of agents misusing tools. Be explicit. This is a requirement, not a suggestion.
