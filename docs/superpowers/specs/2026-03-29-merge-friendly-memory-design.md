# Merge-Friendly Memory Format

## Problem

MEMORY.md and `.last-consolidated` live in `.memories/` (version-controlled). When multiple machines consolidate independently, both files produce merge conflicts:

- **MEMORY.md**: Free-form markdown gets fully rewritten each consolidation. Two machines producing semantically similar but textually different prose = conflict everywhere.
- **`.last-consolidated`**: Single-line JSON cursor. Any divergence = conflict on the only line.

Additionally, the markdown format is suboptimal for its primary consumers (LLMs reading at recall, LLMs writing at consolidation). Formatting tokens (`## `, `- **...**:`) are overhead that neither reader benefits from.

## Changes

### 1. Replace MEMORY.md (markdown) with memory.yaml (YAML)

**Format:**

```yaml
decisions:
  - "2026-03-24 | Batch cursor: use last checkpoint timestamp, not current time"
  - "2026-03-25 | Hook ordering: PreCompact fires before compaction"

open_questions:
  - "2026-03-28 | Multi-machine merge strategy for consolidation state"

deferred_work:
  - "2026-03-27 | Cross-project search UI blocked on registry refactor"

gotchas:
  - "2026-03-25 | Semantic cache: derived local state, never source of truth"
```

**Rules:**

- Four fixed section keys, always in this order when present: `decisions`, `open_questions`, `deferred_work`, `gotchas`
- Empty sections are omitted entirely (no empty arrays)
- Each entry is a plain string: `"YYYY-MM-DD | description"`
- Entries sorted chronologically within each section, newest at the bottom
- Date prefix serves as sort key, staleness signal, and age-out marker
- Blank line between sections (YAML allows this, improves readability and gives git merge context)
- Line budget carries over: green <25 entries total, yellow 25-40, red >40

**Why this is merge-friendly:**

- Fixed section keys are stable anchors for git's three-way merge
- One entry per line means two machines adding different entries = clean auto-merge
- Chronological sort with newest at bottom means new entries append, which is the position git handles best
- Entries that aren't touched produce zero diff, so two machines that share most checkpoints produce mostly identical output

### 2. Move `.last-consolidated` to `~/.goldfish/` (machine-local)

**New path:** `~/.goldfish/consolidation-state/{workspace-name}.json`

Where `{workspace-name}` is the normalized workspace name (same as `normalizeWorkspace()` produces, e.g. `goldfish`).

**Format stays the same:**
```json
{ "timestamp": "2026-03-29T15:30:45.123Z", "checkpointsConsolidated": 23 }
```

**Why:** The consolidation cursor is machine-local processing state ("where am I in processing checkpoints"), not project knowledge. It's analogous to the semantic cache, which already lives in `~/.goldfish/`. Two machines may be at different points in processing, and that's fine.

**Consequence:** Two machines may re-consolidate overlapping checkpoints. This is harmless because consolidation reads the existing memory.yaml and integrates, so the result converges regardless of which checkpoints were already processed.

### 3. Update consolidation prompt for YAML output

The subagent prompt (`consolidation-prompt.ts`) changes to instruct:

- Output YAML to `memory.yaml` instead of markdown to `MEMORY.md`
- Use the four fixed section keys
- One entry per line, date-prefixed, chronologically sorted
- **Preserve unchanged entries verbatim** (key change: minimize diff by only adding new entries and removing stale ones, not rewriting entries that haven't changed)
- Write `.last-consolidated` to `~/.goldfish/consolidation-state/{workspace}.json` instead of `.memories/.last-consolidated`

### 4. Update consolidation handler

- `handleConsolidate()` returns the new `lastConsolidatedPath` pointing to `~/.goldfish/consolidation-state/{workspace}.json`
- `memoryPath` changes from `MEMORY.md` to `memory.yaml`
- Ensure `~/.goldfish/consolidation-state/` directory is created if needed

### 5. Migration: read old format, write new

On first consolidation after this change:

- If `.memories/MEMORY.md` exists and `.memories/memory.yaml` does not, the subagent reads the old markdown as its baseline (the prompt already handles "read existing memory as baseline")
- The subagent writes the new `memory.yaml` format
- `.memories/MEMORY.md` is left in place (not deleted automatically; user can clean it up)
- If `.memories/.last-consolidated` exists, read it as fallback when the new path doesn't exist yet

On recall:

- Check for `memory.yaml` first, fall back to `MEMORY.md` for backwards compatibility
- Once `memory.yaml` exists, ignore `MEMORY.md`

## Affected Modules

| Module | Change |
|--------|--------|
| `src/memory.ts` | `readMemory()` reads `memory.yaml` (falls back to `MEMORY.md`). `writeMemory()` writes `memory.yaml`. `parseMemorySections()` replaced with `parseMemoryYaml()` (uses `yaml` package). `getMemorySummary()` updated for YAML structure. Consolidation state I/O uses `~/.goldfish/consolidation-state/{workspace}.json`. |
| `src/types.ts` | `MemorySection` type updated or replaced. `ConsolidationState` unchanged. New type for parsed YAML structure. |
| `src/consolidation-prompt.ts` | Rewrite synthesis instructions for YAML output, fixed sections, entry format, preserve-unchanged-entries behavior. Update output paths. |
| `src/handlers/consolidate.ts` | Update `memoryPath` and `lastConsolidatedPath` in returned payload. Ensure `~/.goldfish/consolidation-state/` dir creation. |
| `src/recall.ts` | Update memory loading (yaml fallback). Update section parsing for search integration (synthetic checkpoints from YAML entries). Update consolidation state reading (new path with fallback). |
| `src/handlers/recall.ts` | Update "Consolidated Memory" formatting (YAML content display). |
| `src/workspace.ts` | Add `consolidationStatePath(workspace)` helper for `~/.goldfish/consolidation-state/{name}.json`. |
| `hooks/session-start.ts` | Check for `memory.yaml` instead of (or in addition to) `MEMORY.md`. |
| `hooks/count-stale.ts` | Read `.last-consolidated` from new path with fallback to old path. |
| `skills/consolidate/SKILL.md` | Update references from MEMORY.md to memory.yaml. |
| `skills/recall/SKILL.md` | Update references. |
| `src/instructions.ts` | Update any MEMORY.md references. |
| `CLAUDE.md` | Update architecture diagram, module table, references. |
| Tests | All memory/consolidation tests updated for new format and paths. |

## What Does NOT Change

- Checkpoint format (markdown with YAML frontmatter, stored in `.memories/{date}/`)
- Plan format and storage
- `.active-plan` file
- Semantic cache location (`~/.goldfish/cache/semantic/`)
- Registry location (`~/.goldfish/registry.json`)
- MCP tool interfaces (parameter names, return structure)
- The four KEEP categories (decisions, open questions, deferred work, gotchas)
- Line/entry budget (green <25, yellow 25-40, red >40)
- 30-day age-out window

## Testing Strategy

- Unit tests for `parseMemoryYaml()` (replaces `parseMemorySections()`)
- Unit tests for `getMemorySummary()` with YAML input
- Unit tests for consolidation state read/write at new path
- Migration tests: old MEMORY.md read correctly as fallback
- Migration tests: old `.last-consolidated` read correctly as fallback
- Handler tests: correct paths in consolidation payload
- Recall tests: YAML memory loaded and searchable
- Integration: consolidation prompt produces valid YAML output (existing subagent behavior)
