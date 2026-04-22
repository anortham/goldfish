# Changelog

All notable changes to Goldfish are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.0.2] - 2026-04-22

Patch release for the reviewed defect sweep.

### Fixed

- Prevented duplicate checkpoint IDs when two saves collide on timestamp and
  description. Collision handling now suffixes the persisted checkpoint ID as
  well as the filename, so search recall no longer trips Orama's duplicate-doc
  guard.
- Awaited cross-project registration before `saveCheckpoint()` returns, so an
  immediate `recall({ workspace: "all" })` sees the newly written workspace.
- Hardened legacy JSON checkpoint reads. Files missing an `id` or carrying an
  invalid timestamp are now rejected and skipped instead of surfacing garbage
  checkpoint entries.
- Fixed cross-workspace search summaries so `workspaces[]` includes only
  matching workspaces and `checkpointCount` reflects matched hits instead of the
  pre-search candidate pool.
- Coerced brief `tags` from MCP JSON-string inputs on save and update, matching
  the checkpoint handler behavior.
- Rejected `workspace: "all"` for write-oriented `checkpoint` and `brief`
  operations, closing the footgun that could create `.memories/` under a literal
  `./all/` path.

### Changed

- `ensureMemoriesDir()` no longer creates the dead `.memories/plans/`
  directory during normal setup. Legacy reads from `.memories/plans/` remain
  intact.

## [7.0.1] - 2026-04-17

Patch release to clean up the v7 surface after the subtract sprint landed.

### Fixed

- Restored `bun run typecheck` to green under `exactOptionalPropertyTypes`.
  Workspace-root hydration, recall option normalization, git spawn options,
  and related tests now satisfy the stricter typing contract instead of
  passing only under Bun's runtime test path.
- Removed stale post-v7 guidance that still mentioned fuzzy search,
  consolidation, and `/consolidate` after those concepts were deleted.
  Tool descriptions, recall skills, and regression tests now describe the
  shipped v7 behavior.

### Documentation

- Documented the Codex Desktop caveat that it does not send MCP roots today.
  The README now recommends a project-local `.codex/config.toml` with
  `GOLDFISH_WORKSPACE` set per repo so Goldfish binds to the correct
  workspace.

## [7.0.0] - 2026-04-16

The "subtract sprint" release. Goldfish shrinks its surface to three MCP tools
and six skills, replaces the semantic stack with BM25 search, and ships one new
capability (`/handoff`). The story is: shrink the surface, sharpen the
primitives, add one focused thing.

For the full design and execution record see
[`docs/plans/2026-04-16-v7-subtract-sprint-design.md`](docs/plans/2026-04-16-v7-subtract-sprint-design.md)
and
[`docs/plans/2026-04-16-v7-subtract-sprint-implementation.md`](docs/plans/2026-04-16-v7-subtract-sprint-implementation.md).

### Breaking Changes

- Removed the `mcp__goldfish__plan` MCP tool. There is no compatibility alias.
  Callers must move to `mcp__goldfish__brief`, which carries broader semantics:
  durable strategic context, not execution checklists.
- Removed the `mcp__goldfish__consolidate` MCP tool and the consolidation
  routine. Token math was net-negative in practice; recall now reads
  checkpoints directly.
- Removed the SessionStart and PreCompact Claude Code hooks. They were
  intrusive at 1M context and Claude-Code-only. Recall is invoked manually
  (or via the `/recall` skill) and works without auto-triggering.
- Removed the `consolidate`, `plan`, and `plan-status` skills.
- Dropped `@huggingface/transformers` and the local embedding stack. Semantic
  recall is gone; a single search primitive replaces it.
- Dropped `fuse.js`. BM25 ranking via Orama replaces the fuzzy matcher.

### Added

- `/handoff` skill at `skills/handoff/SKILL.md`. Composes the existing `recall`
  and `brief` MCP tools with `Bash` (git) to produce a structured
  session-resumption summary: Direction, State at handoff, Recent activity,
  Next steps, Open questions, Source pointers. No new MCP tool surface; this
  is pure skill composition built on primitives that already shipped.

### Changed

- Search engine swapped from `fuse.js` fuzzy matching to `@orama/orama` BM25
  ranking with the English tokenizer (stemming + stopword removal). The
  ranker uses a two-pass strategy: AND semantics first, fall back to OR if
  AND returns no matches. Validated empirically against 12 conversational
  queries where fuse silently returned zero hits on five of them.
- Renamed `src/plans.ts` to `src/briefs.ts`. The narrower "plan" tool's role
  is now filled by the broader `brief` tool that already existed.
- MCP tool surface shrunk from 5 to 3: `checkpoint`, `recall`, `brief`.
- Skill surface shrunk from 8 to 6: `brief`, `brief-status`, `checkpoint`,
  `handoff`, `recall`, `standup`.
- `src/recall.ts` shrunk from 799 to roughly 400 lines after stripping the
  semantic and consolidation paths.
- `RecallOptions` cleaned up: `_semanticRuntime` removed.
  `Checkpoint.planId` is retained ONLY for legacy file-read compatibility so
  existing on-disk checkpoints continue to load; new checkpoints write
  `briefId` instead.
- The server self-cleans legacy on-disk artifacts on startup:
  `~/.goldfish/cache/semantic/`, `~/.goldfish/models/transformers/`, and
  `~/.goldfish/consolidation-state/`. The cleanup call sites are marked
  "REMOVE IN v7.1.0" in source.
- Repositioned: Goldfish is framed as an "evidence ledger" or "git for
  intent" instead of a memory system. README and tool descriptions reflect
  the shift.
- `AGENTS.md` is auto-generated byte-for-byte from `CLAUDE.md` by
  `scripts/sync-agent-skills.ts` so non-Claude harnesses (Codex, OpenCode,
  Copilot via the `.agents/skills` mirror) read identical instructions. Edit
  `CLAUDE.md` and rerun `bun run sync:agent-skills`.

### Removed

- Source modules deleted: `src/semantic.ts`, `src/semantic-cache.ts`,
  `src/transformers-embedder.ts`, `src/consolidation-prompt.ts`,
  `src/handlers/consolidate.ts`, `src/handlers/plan.ts`, `src/memory.ts`.
- The `hooks/` directory deleted along with all SessionStart and PreCompact
  hook scripts.

### Migration Notes (6.x to 7.0)

- Anything calling `mcp__goldfish__plan` must move to `mcp__goldfish__brief`.
  The brief tool stores durable strategic context, not execution checklists;
  if your prior plan content was a checklist, lift the strategic intent into
  the brief and let the harness own the checklist.
- Anything calling `mcp__goldfish__consolidate` should drop the dependency.
  Recall reads checkpoints directly and the consolidation routine is gone.
- Anyone who installed the SessionStart or PreCompact hooks should remove
  them. Recall works fine without auto-triggering.
- `@huggingface/transformers` is no longer pulled in at install. Uninstall
  is automatic via the missing dependency on next `bun install`. Local
  caches at `~/.goldfish/cache/semantic/` and
  `~/.goldfish/models/transformers/` are deleted automatically on first
  v7 startup; the consolidation state directory is cleaned the same way.
- No data migration is required for `.memories/` content. Existing
  checkpoint and brief markdown is read as-is, and old checkpoints retaining
  `planId` continue to load through the legacy compatibility path.
