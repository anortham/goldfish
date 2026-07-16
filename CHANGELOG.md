# Changelog

All notable changes to Goldfish are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [7.5.0] - 2026-07-16

Review-driven release: cross-workspace recall correctness, brief lifecycle adoption nudges at the moments that matter, large performance gains from validated in-memory caches, and wider harness support. Externally reviewed (Codex) with all findings fixed.

### Added

- Checkpoint responses show the saved file path with a commit-inclusion reminder, and nudge when the active brief's text is 7+ days old ("still the direction? Update or complete it.")
- Server instructions carry brief lifecycle triggers (update when goals shift, complete when the work lands, archive when superseded), not just save guidance
- Stale-brief notices include a content gist (first non-heading line) so complete-vs-update is decidable without another call, and offer update as a first-class action
- Generated instruction-tier usage ruleset (`docs/agent-instructions/goldfish-usage.md`, built from the server instructions) for harnesses that read repo instruction files but never surface MCP server instructions
- `docs/agent-portability.md`: harness support matrix, deliberate non-support decisions, and the uninstall story for `~/.goldfish/registry.json`
- Release version guard: every release tag on HEAD must equal `SERVER_VERSION` (`bun run check:version-tag`, also enforced by tests on tagged commits) — catches all version surfaces going stale together
- Drift-guard tests for mirrored agent assets (`.agents/skills` byte-equality, AGENTS.md mirror, generated usage-doc freshness)
- Committed working client configs: `opencode.json` and `.vscode/mcp.json`

### Fixed

- Cross-workspace recall without date parameters silently capped every workspace at 5 checkpoints and under-reported workspace summary counts; `/standup`-style aggregation now sees the full corpus
- Skills no longer hardcode `mcp__goldfish__*` tool names (they never match plugin installs, which namespace tools differently); examples now use bare tool names
- Checkpoint skill no longer instructs checkpointing after commits — contradicting the checkpoint-before-commit rule — and no longer references the PreCompact hook removed in 7.0
- Stale-brief thresholds documented correctly: 7-day stale suppression and 14-day refresh nudge are distinct
- Compact search descriptions no longer waste their 220-char budget repeating the heading/decision; containment dedup is word-boundary-aware so short tags are not swallowed by unrelated words
- Stale-brief notices no longer claim an exact activity age beyond what was verified; past the bounded 28-day scan they report a lower bound ("untouched 28d+")

### Changed

- Search over a 1,000-checkpoint corpus: ~247ms per call → ~11ms warm. A per-day corpus cache (file-stat fingerprints including ctime and inode, validated on every read; nothing derived is written to disk) removes repeated read+parse work, and a corpus-fingerprint-keyed Orama index cache removes per-call index rebuilds
- Structured recall filters (`type`/`tags`/`file`/`symbol`): ~122ms → ~10ms at the same corpus size
- Checkpoint saves: git context capture runs its five git queries concurrently with async spawns (~43ms → ~21ms) and no longer blocks the MCP server's event loop
- `recall({ limit: 0 })` no longer scans deep history for brief activity (bounded 28-day window)
- Full-mode recall output is budgeted at 20k chars with explicit truncation notes — a single tool call can no longer flood the caller's context window; default-mode `next` fields cap at 140 chars

## [7.4.3] - 2026-07-07

Patch release for a file-lock mutual exclusion race and Bun 1.3 compatibility on Windows.

### Fixed

- **File locking could admit two concurrent holders.** `writeFile(lockPath, data, {flag: 'wx'})` creates the lock file before its content lands, so a concurrent waiter could read it empty, treat it as malformed/stale, and steal a live lock. A malformed lock is now given a 1s mtime grace window (presumed mid-write) before it can be reclaimed; genuinely corrupt old locks are still stolen promptly. Bun 1.3 on Windows widened the create-to-content window enough to lose cross-project registry updates under concurrency.
- Atomic writes now retry the final rename on transient Windows sharing violations (`EPERM`/`EACCES`/`EBUSY`), which occur when the destination is briefly held open by a concurrent replace, an unclosed reader, or an antivirus scan. The temp file is also cleaned up when the rename ultimately fails.
- `bun install` no longer fails under Bun 1.3, whose built-in shell rejects two consecutive redirects (`>/dev/null 2>&1`) in the `prepare` script. The script now uses the combined `&>/dev/null` form, which Bun's shell parses and which remains valid bash/zsh.
- Tests are no longer platform-dependent on Windows: workspace/recall assertions compare paths separator-insensitively, roots fixtures use real absolute paths (Windows `fileURLToPath` rejects drive-less `file:///` URLs), the registry drive-case dedup test uses genuine drive-letter case variants, and the two POSIX-only `chmod`-based lock tests are skipped on Windows where directory write bits are not enforced.

## [7.4.2] - 2026-07-06

Patch release for source archive install safety.

### Fixed

- `bun install --frozen-lockfile` now succeeds from GitHub-generated source archives by making the `prepare` script skip git hook configuration outside a git checkout.

## [7.4.1] - 2026-07-06

Patch release for Windows registry deduplication and stuck MCP roots recovery.

### Fixed

- Windows registry path comparisons now use a case-insensitive normalized key, so `C:/...`, `c:/...`, and separator variants do not register as duplicate workspaces. Listing registered projects also collapses legacy duplicate entries on read so cross-workspace recall does not scan the same workspace twice.
- Request-time MCP `roots/list` hydration now times out and falls back through the existing workspace resolution/recovery path instead of hanging indefinitely when a client connection is dead or desynced.
- The package build script now targets Bun, matching the server runtime and Bun APIs used by the source.

## [7.4.0] - 2026-07-03

Intent-blame recall filters and a brief refresh nudge for zombie briefs.

### Added

- Brief refresh nudge when an active brief has not been updated in 14+ days but recent checkpoints keep it from being suppressed (non-destructive)
- `file:` recall filter for intent-blame queries over `git.files` (path-suffix match with normalization)
- `symbol:` recall filter for exact, case-insensitive symbol name match over checkpoint `symbols`
- Compact recall results retain `Files:` / `Symbols:` metadata when the matching filter is active

### Fixed

- Abandoned-staleness suppression now honors `brief.updated`, so updating an abandoned brief un-suppresses it

## [7.3.0] - 2026-06-26

Workspace recovery for harnesses that spawn the plugin with an unsafe cwd and no MCP roots, plus a realpath fix to the unsafe-cwd guard.

### Added

- Registry + parent-walk workspace recovery. When the resolution chain (explicit arg > `GOLDFISH_WORKSPACE` > MCP `roots/list`) falls through to `process.cwd()`, goldfish now tries to recover a project root before accepting cwd or refusing: (4a) gather the deepest registered ancestor candidate; (5) gather the nearest safe parent-walk candidate containing `.memories/` (preferred) or `.git/`; choose the deeper candidate, keeping `registry` when both identify the same on-disk path; (4b) else, if exactly one project is registered and the calling tool is `recall`, use it. This resolves the Cursor plugin scenario where the plugin server is spawned with `cwd=home` and the `roots` capability is never advertised to plugin-launched servers (only to user-config servers), so every `checkpoint`/`recall`/`brief` call previously hard-refused. Recovery runs on every cwd fallback, so a safe cwd that is a subdirectory of a project now resolves to the nearest project root instead of writing `.memories/` into the subdir or an outer registered repo.
- `recoverWorkspace` orchestrator in a new `src/workspace-recovery.ts` module (kept out of `workspace.ts` to avoid a cycle with `registry.ts`, which already imports from `workspace.ts`). The registry reader is injected, so tests never touch the real `~/.goldfish/registry.json`.
- `parentWalkWorkspace` pure helper in `src/workspace.ts` (registry-free) and `resolveUnsafeCwdReason` async helper (realpath-aware).
- Sharpened refusal message: when recovery fails and the cwd is unsafe, the error now appends a "Known projects: … — pass one as `workspace:`." line listing registered projects when the registry is non-empty, turning a generic refusal into actionable guidance.
- Observability: recovery events are logged (`workspace.recovered source=registry|walk path=… cwd=…`).
- Recovery feedback: `checkpoint` and `brief` responses now append a `Workspace: <path> (recovered via <source>)` line when the workspace was recovered, so a wrong-but-plausible root (e.g. a parent `.git`) is visible to the agent instead of silent. `recall` already prints its workspace line.

### Changed

- `4b` single-registered auto-pick is `recall`-only. A single historical registration is usable evidence for where to *read* memories from, not where to *write* them; `checkpoint` and `brief` refuse-with-list so a wrong-path write (a silent data-placement bug) cannot happen. A safe-subdir cwd that is inside a registered or markered project still resolves via 4a/5 for all tools.

### Fixed

- The unsafe-cwd guard now recognizes home through a symlink. Previously `getUnsafeCwdWorkspaceReason` compared `cwd` against `HOME` via string equality, so on macOS — where `process.cwd()` resolves to `/private/var/...` while `HOME` is `/var/...` — a home cwd slipped past the guard and `.memories/` could be written into home. `resolveUnsafeCwdReason` canonicalizes both sides through `fs.realpath` (with a string-compare fallback when `realpath` fails) and is used at the async call sites (server hydration, parent walk, recovery). The sync `getUnsafeCwdWorkspaceReason` is unchanged for the cheap checks (`/`, `~`, Windows system dirs) and still used where async is not available.
- A registered `$HOME` can no longer bypass the mutating-tool guard. The 4a registry-ancestor candidate is now checked with `resolveUnsafeCwdReason` for mutating tools (`checkpoint`/`brief`); if the registered candidate is itself an unsafe dir (e.g. `~` was registered after a one-off run from home), it is dropped and recovery falls back to the parent walk rather than writing into home. Recall remains read-only and may still use a registered home. Closes a regression where the new recovery layer would have re-opened the silent-home-write class of bug it was built to prevent.

## [7.2.1] - 2026-06-26

Fixes a stale-roots-cache bug that blocked desktop MCP clients from recovering a usable workspace.

### Fixed

- `roots/list` results are no longer cached when empty or failed. Previously, `getCachedRoots` cached empty root lists and thrown/failed lookups for the entire session, so a desktop MCP client (Cursor) that spawned the plugin with a home or filesystem-root cwd — and returned empty roots or a transient failure on the first tool call — would lock every later `checkpoint`/`recall`/`brief` call out of the workspace, surfacing as "Refusing to use home directory (/Users/...) as workspace from process cwd" even after the client later advertised the real project root. Only non-empty successful results are cached now; empty and failed lookups return without caching so the next workspace-aware call re-queries `roots/list` and recovers. This mirrors the deferred-retry pattern already used by Miller and Eros in the same Cursor environment.

## [7.2.0] - 2026-06-01

Recall filtering plus a cluster of resilience fixes for corrupt or contended state.

### Added

- Recall `type` filter: `recall({ type: "decision" })` narrows to a single checkpoint type (`checkpoint` | `decision` | `incident` | `learning`). Untyped checkpoints count as `checkpoint`. Matched case-insensitively.
- Recall `tags` filter: `recall({ tags: ["db", "ops"] })` returns checkpoints carrying ALL listed tags (case-insensitive AND match). Accepts an array or a comma-separated string for non-Claude clients.
- Both filters compose with each other and with `search`, and scan the full corpus (not just the most-recent-N window) so older matches are not lost — in single- and cross-workspace recall.
- Checkpoint `type` is now part of the BM25 search corpus, so a free-text search like `incident` surfaces incident-typed checkpoints even when the word is absent from the body.

### Fixed

- File locking no longer stalls ~30s when the lock directory is unwritable: non-`EEXIST` errors now fail fast. Stale-lock detection is liveness-aware (checks the holder PID on the same host via `process.kill(pid, 0)`, age-based otherwise) and reclaims via atomic rename to close a TOCTOU window.
- A corrupt `.active-brief` file (or any unreadable brief) no longer crashes recall: `getActiveBrief` returns null and `listBriefs` skips the bad file, both with a warning. `getBrief` still throws loudly for direct callers.
- A corrupt `~/.goldfish/registry.json` is backed up to `registry.json.corrupt-<ts>-<rand>` and reinitialized instead of being silently overwritten (which previously dropped every registered project). Applies to both register and unregister; if the backup itself fails, the write aborts rather than wiping data.
- The active-brief staleness scan is bounded to date directories at/after the brief's creation date, keeping fresh-brief recall off a full-history scan.

### Removed

- Dead v7.0 legacy-directory cleanup code in the server startup path (the migration window has passed).

## [7.1.0] - 2026-05-28

Stale active briefs no longer clutter recall.

### Added

- Recall now detects stale active briefs and, instead of surfacing the full brief on every call, emits a one-line action-oriented nudge ("complete or archive it, or it'll keep surfacing stale"). Staleness is based on the newest checkpoint referencing the brief (falling back to the brief's creation time), with a 7-day threshold.
- `findLatestCheckpointTimestampForBrief` in the checkpoint store: a newest-first, early-exiting scan that returns the most recent checkpoint timestamp referencing a brief (matches both `briefId` and legacy `planId`).
- `RecallResult.staleBrief` (`StaleBriefNotice`) carries the suppressed brief's id, title, last-activity timestamp, and age in days.

### Changed

- Single-workspace recall withholds the active brief body once it is stale and surfaces the nudge in its place; the header reads `+ stale brief notice`. Cross-workspace (`workspace: 'all'`) recall is unchanged.

### Notes

- Fully non-destructive: a brief's `status` on disk is never mutated by recall (covered by a regression test). Auto-archiving, retire-on-supersede, and applying staleness to handoff/standup/brief-status were considered and deliberately left out of this release.

## [7.0.5] - 2026-05-09

Patch release for safer default workspace resolution in user-level MCP installs.

### Added

- Added source-aware workspace resolution so MCP request hydration can distinguish explicit, environment, roots-derived, and weak cwd-derived workspace paths.
- Added unsafe cwd fallback detection for filesystem roots, home directories, Windows user-profile roots, and Windows system directories.

### Fixed

- Goldfish now refuses unsafe cwd-derived default workspaces with a helpful `GOLDFISH_WORKSPACE`/project-folder error instead of writing `.memories/` into broad system or home paths.
- MCP roots and explicit workspace overrides still take precedence, allowing user-level installs to bind correctly when the client provides project roots or the caller passes a concrete workspace.

## [7.0.4] - 2026-05-05

Patch release for the brief deletion MCP surface.

### Fixed

- Exposed `delete` as a documented `brief` action in the MCP tool schema, with
  handler coverage and guidance that deletion requires an explicit brief ID.

## [7.0.3] - 2026-04-22

Patch release for the structured checkpoint search fix.

### Fixed

- Search now indexes the raw checkpoint description again, so narrative text on
  structured checkpoints remains searchable instead of disappearing behind the
  digest fallback.
- Restored search hits for `briefId` and legacy `planId` terms by indexing them
  explicitly, preserving brief-linked recall while keeping the description fix.
- Awaited Orama `create()`, `insert()`, and `search()` operations and added a
  deterministic score, timestamp, and ID tie-break for stable result ordering.

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
