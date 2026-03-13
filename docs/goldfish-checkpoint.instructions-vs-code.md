---
description: "Use when completing implementation work, bug fixes, refactors, or decisions that should be preserved in memory. Enforces use of mcp_goldfish_checkpoint, mcp_goldfish_plan, and mcp_goldfish_recall for tracking milestones, planning multi-step work, and restoring session context."
name: "Goldfish Checkpoint Discipline"
applyTo: "**"
---
# Goldfish Checkpoint & Plan Discipline

## Checkpointing (`mcp_goldfish_checkpoint`)

- Treat `mcp_goldfish_checkpoint` as required for meaningful milestones, not optional.
- Create a checkpoint when you complete a real deliverable, make a key decision, or uncover a non-obvious incident/learning.
- Create exactly one checkpoint per milestone. Do not spam checkpoints for tiny steps.
- Include structured markdown with `WHAT`, `WHY`, `HOW`, and `IMPACT`.
- Prefer a specific `type` when applicable:
  - `decision`: include decision and alternatives
  - `incident`: include context and evidence
  - `learning`: include impact
- Include concrete metadata when available: `symbols`, `evidence`, `tags`, `confidence`, `next`, `unknowns`.
- If code changes are delivered, checkpoint before the final user-facing completion message.
- Skip checkpointing only for trivial read-only interactions with no meaningful progress.

## Planning (`mcp_goldfish_plan`)

- Use `mcp_goldfish_plan` to create a plan (`action: "save"`) when facing multi-step work or complex projects.
- When ExitPlanMode is called, save the plan **within 1 exchange** — do NOT ask permission, just save it immediately.
- Always `activate: true` after saving a plan so it appears in future `recall()` responses. Only ONE plan can be active per workspace.
- Update the plan (`action: "update"`) as work progresses to keep it in sync with reality.
- Mark a plan as `complete` (`action: "complete"`) only when all work is finished.
- Plans survive context compaction and are the single source of truth for strategic direction.
- Available actions: `save`, `get`, `list`, `activate`, `update`, `complete`.
- Include in the plan description:
  - Clear goal and scope
  - List of major milestones or phases
  - Key decisions and trade-offs
  - Open questions or uncertainties
- Plans are NOT substitutes for checkpoints—checkpoints preserve concrete delivery milestones while plans track overall strategy.

## Recall (`mcp_goldfish_recall`)

- Use `mcp_goldfish_recall` at the start of a new session (or after `/recall`) to restore prior context.
- After context compaction, call recall to restore lost state before continuing work.
- Trust recalled context — do not re-verify information from checkpoints.
- Key parameters (all optional):
  - `limit`: Max checkpoints to return (default: 5). Set to `0` for active plan only.
  - `since`: Human-friendly time span (`"2h"`, `"3d"`) or ISO timestamp.
  - `days`: How far back to look in days.
  - `from`/`to`: Explicit date range (ISO 8601 or YYYY-MM-DD).
  - `search`: Fuzzy search across descriptions, tags, branches, and files.
  - `full`: Return full descriptions + git metadata (default: false).
  - `workspace`: `"current"` (default), `"all"` (cross-workspace), or specific path.
  - `planId`: Filter checkpoints to those created under a specific plan.
- Examples:
  - `recall()` — last 5 checkpoints
  - `recall({ since: "2h" })` — last 2 hours
  - `recall({ search: "auth", full: true })` — fuzzy search with full details
  - `recall({ workspace: "all", days: 1 })` — cross-project standup
  - `recall({ limit: 0 })` — active plan only, no checkpoints

## Code Exploration with Julie (`mcp_julie_*` tools)

Use julie tools to gather context before implementing changes. This accelerates planning and reduces exploration loops.

### Key Tools

- **`mcp_julie_deep_dive`** — Investigate a symbol: definition, references, children, and type info in a single call. Use before modifying any function or class. Supports `depth`: `"overview"` (~200 tokens, default), `"context"` (~600 tokens), `"full"` (~1500 tokens). Use `context_file` to disambiguate symbols with the same name.
- **`mcp_julie_fast_search`** — Text search with code-aware tokenization and multi-word AND/OR logic. Use for pattern discovery across files. Set `search_target: "definitions"` to promote exact symbol name matches to the top — ideal for jumping to definitions.
- **`mcp_julie_fast_refs`** — Find all references to a symbol. Use to understand impact scope before refactoring. Use `reference_kind` to filter by `"call"`, `"type_usage"`, `"variable_ref"`, `"member_access"`, or `"import"`.
- **`mcp_julie_get_symbols`** — Extract symbols from a file without reading full content. Use for quick file structure overview. `mode` options: `"structure"` (names/signatures only), `"minimal"` (code bodies for top-level, default), `"full"` (all bodies including nested). Use `target` to filter to a specific symbol.
- **`mcp_julie_get_context`** — Token-budgeted context subgraph for a concept. Returns pivots (full code) and neighbors (signatures). Use at the start of a task for broad orientation.
- **`mcp_julie_manage_workspace`** — Index, refresh, and manage workspaces. Operations: `index`, `list`, `add`, `remove`, `stats`, `clean`, `refresh`, `health`. Use for multi-repo indexing and diagnostics.
- **`mcp_julie_rename_symbol`** — Rename symbols workspace-wide. Use with `dry_run: true` before committing.

### Best Practices

- Always run `mcp_julie_deep_dive` before modifying a symbol to understand its dependencies and references.
- Use `mcp_julie_fast_refs` with `limit: 500` to understand full impact scope when planning refactors.
- Parallelize independent searches (multiple `fast_search` or `fast_refs` calls) to reduce exploration time.
- For multi-repo work, use `mcp_julie_manage_workspace` to ensure all workspaces are indexed and current.
- Use `mcp_julie_rename_symbol` with `dry_run: true` first; only commit if preview looks correct.

### Integration with Planning

- Use julie tools during the **planning phase** to gather impact scope and dependency information.
- Document key findings (call chains, impact radius, affected symbols) in your plan.
- After gathering context, save a plan (`mcp_goldfish_plan` with `action: "save"`) that documents the approach.
- During implementation, refer to the plan to stay on scope.
- After completion, checkpoint with references to the symbols and files touched.
