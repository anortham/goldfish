# v7.0.0 subtract sprint design

## Goal

Reposition goldfish from "memory" to **evidence ledger**: the source-controlled, harness-agnostic, durable record of why things changed. Three legs survive (checkpoints, briefs, cross-project recall). Everything that was built for the 200K-context era or for Claude-Code-only automation gets cut. v7.0.0 also lands one new capability — a handoff skill that turns the evidence ledger into a returning-engineer summary, suitable for a different harness or agent picking up cold. The result is a smaller, faster, cross-client-symmetric tool with three MCP surface tools instead of five, six skills instead of eight, and a major version bump that earns its number with both subtraction and addition.

## Why

Original framings are no longer durable. Context windows hit 1M, so compaction-driven persistence is a niche concern. Multiple harnesses (Claude Code, Codex, OpenCode, VS Code Copilot, Cursor, Cline) have proliferated and several have native memory features. Workflow plugin ecosystems (razorback, claude-code skills) own planning, debugging, code review. Goldfish must earn the slot between static `CLAUDE.md` and ephemeral harness plan modes, and lean into the cross-client gap that no native memory feature crosses.

Detailed rationale plus Gemini and Codex second opinions are captured in `.memories/2026-04-16/185114_f1dc.md`.

## Scope

### In

1. **Orama replaces fuse.js + the local-embedding semantic stack** as the single search primitive
2. **Hooks deleted** (SessionStart, PreCompact)
3. **Consolidation deleted** (tool, prompt builder, state files, memory.yaml read/write paths, hook-side staleness counting)
4. **Plan tool retired clean** (no compatibility alias); `plans.ts` renamed to `briefs.ts`
5. **Doc cleanup** of stale exploration and pre-brief planning artifacts
6. **Agent docs refreshed** (`CLAUDE.md`, `AGENTS.md`) to match the new module map and skill inventory
7. **Server instructions updated** to keep behavioral nudges that previously rode in the SessionStart hook
8. **New `/handoff` skill** that produces a returning-engineer summary from active brief + recent checkpoints + git delta, composed entirely from existing MCP tools and shell commands (no new tool surface)
9. **Version bumped to 7.0.0**

### Out

- **Adding API-based embeddings** (deferred until evidence shows BM25 alone is insufficient; Orama's vector slot keeps the door open)
- **Adding a `recall({ handoff: true })` MCP shortcut** for the handoff output (the skill composes existing tools first; promote to a tool surface only if token-cost evidence justifies it)
- **Changes to the on-disk format** of checkpoint files or brief files (no migration of user data)

---

## Pillar 1: Orama replaces fuse + semantic stack

### Decision

Use `@orama/orama` BM25 as the single search primitive. Empirical comparison on this repo's 94 checkpoints (results captured in the brainstorming conversation) showed fuse.js silently returning zero results on natural-language queries that Orama handled cleanly. The "embeddings improved quality" effect was largely the BM25 layer that came free with hybrid rerank, not the embeddings themselves.

### Indexing

Build the Orama index per recall call, once per workspace. Justified because:

- Goldfish loads checkpoints fresh per call already (no in-memory cache)
- 94 checkpoints index in single-digit milliseconds
- A persistent index would need invalidation logic that's worse than rebuilding
- Matches the current fuse pattern (built per call inside `searchCheckpoints`)

If indexing latency becomes a problem at >1,000 checkpoints in a single workspace, revisit by caching the Orama instance keyed on the checkpoint id list.

### Schema

Mirror the current fuse field set, with arrays joined to strings, indexed body sourced from `buildRetrievalDigest(checkpoint)` (preserving the existing search-optimized body):

```ts
{
  id, description, decision, impact, context,
  alternatives, evidence, symbols, unknowns, next,
  tags, branch, files
}
```

English tokenizer with stemming. Boosts mirror current fuse weights so ranking changes are isolated to BM25-vs-fuzzy-distance, not field weighting:

| Field | Boost |
|-------|-------|
| description | 2.0 |
| decision | 1.5 |
| impact | 1.3 |
| context | 1.1 |
| tags | 1.0 |
| alternatives | 0.8 |
| evidence | 0.7 |
| symbols | 0.7 |
| unknowns | 0.6 |
| next | 0.5 |
| branch | 0.5 |
| files | 0.3 |

### Module changes

- Add: `@orama/orama` runtime dependency
- Modify: `src/ranking.ts` becomes a thin Orama wrapper exporting `searchCheckpoints(query, checkpoints)` only. `rankSearchCheckpoints`, `buildHybridRanking`, hybrid scoring, and lexical-candidate-rebuilding all go.
- Modify: `src/recall.ts` removes hybrid ranking, query embedding plumbing, semantic maintenance, fallback paths, `_semanticRuntime` parameter handling
- Modify: `src/types.ts` removes `SemanticRuntime`, `SemanticModelInfo`, `_semanticRuntime` from `RecallOptions`
- Modify: `src/workspace.ts` deletes `getSemanticCacheDir` and `getModelCacheDir`. Keep `getSemanticWorkspaceKey` under its current name until Pillar 3 deletes it along with consolidation (skip the rename: simpler, one fewer churned symbol).
- Modify: `src/server.ts` drops `pruneOrphanedSemanticCaches` call
- Delete: `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`
- Delete dependency: `@huggingface/transformers`

### One-shot migration

On server startup in `createServer`, best-effort delete (try/catch silenced):

- `~/.goldfish/cache/semantic/`
- `~/.goldfish/models/transformers/`

The cleanup code stays in v7.0.0 only and is removed in v7.1.0. After first start on a clean machine, it's a no-op.

---

## Pillar 2: Hook removal

### Decision

Delete both `SessionStart` and `PreCompact` hooks, plus the `hooks/` directory entirely. Hooks are Claude-Code-only, fire prompt-injection guidance the user hasn't asked for, and are dead weight at 1M context. The behavioral pattern (agent autonomously checkpoints; user explicitly asks for recall) works on every harness without harness-specific automation.

### Module changes

- Delete: `hooks/` directory (`hooks.json`, `session-start.ts`, `pre-compact.ts`, `count-stale.ts`)
- Delete: `tests/count-stale.test.ts`
- Modify: `.claude-plugin/plugin.json` if it references hook discovery (verify; current manifest does not name hooks explicitly, so likely no change beyond version bump)
- Modify: `src/server.ts` removes any code that anticipated hook injection

### Behavioral nudges that survive

The SessionStart hook injected an `additionalContext` payload with three rules:

- Checkpoint BEFORE git commits, not after
- Always commit `.memories/` to source control
- Never ask permission to checkpoint or save briefs

These rules need to live somewhere now that the hook is gone. Move them into `src/instructions.ts` (the MCP server-instructions string, currently 2k-capped). They fit. Verify the 2k cap test still passes after the addition.

---

## Pillar 3: Consolidation removal

### Decision

Delete the consolidation routine entirely. The token math is net-negative as wired today (recall loads `memory.yaml` AND re-reads checkpoints AND triggers stale recomputation), and 1M context windows make synthesized summaries less load-bearing than they were at 200K. Briefs already cover "compact strategic context"; checkpoints already cover "evidence trail." `memory.yaml` was filling a niche between them that doesn't survive scrutiny.

### Module changes

- Delete: `src/consolidation-prompt.ts`
- Delete: `src/handlers/consolidate.ts` (remove from `handlers/index.ts` exports)
- Delete: consolidation-state I/O from `src/memory.ts` (`readConsolidationState`, `writeConsolidationState`)
- Delete: `memory.yaml` read/parse paths from `src/memory.ts` (`readMemory`, `getMemorySummary`, `parseMemorySections`) and from `src/recall.ts`
- Delete: `consolidation.needed` flag and `delta` checkpoint shaping from `src/recall.ts`
- Delete: `consolidate` from `src/tools.ts` and the `consolidate` case in `src/server.ts`
- Modify: `src/types.ts` drops `MemorySection`, consolidation-related fields from `RecallResult`
- Modify: `src/instructions.ts` removes the "Consolidation" section
- Delete: `skills/consolidate/SKILL.md` and the `skills/consolidate/` directory
- Delete: `tests/consolidate.test.ts`
- Modify: `tests/memory.test.ts` shrinks to whatever read/write paths still survive (likely just `getMemoriesDir` and friends; if nothing remains, delete the file)
- Modify: `tests/recall.test.ts` removes consolidation-aware paths
- Modify: `src/handlers/recall.ts` no longer formats memory sections in the response

### Migration of existing user data

Existing `.memories/memory.yaml` files in user repos are left alone (read by humans, harmless). Existing `~/.goldfish/consolidation-state/` files are deleted on startup as part of the same one-shot migration that handles the semantic cache. The `getConsolidationStatePath` and `getConsolidationStateDir` functions get deleted too.

`getSemanticWorkspaceKey` had been preserved through Pillar 1 because `getConsolidationStatePath` was still calling it. With consolidation gone, it has no remaining caller. Delete the function and `getConsolidationStateDir`/`getConsolidationStatePath` along with it.

---

## Pillar 4: Plan tool retirement

### Decision

Clean cut. No compatibility alias. The `plan` tool, `plan` skill, `plan-status` skill all go. Existing `.memories/plans/` directories on user disks are left alone as readable markdown. New writes go to `.memories/briefs/` exclusively.

### Module changes

- Delete: `plan` tool from `src/tools.ts`
- Delete: `plan` case from `src/server.ts` switch
- Delete: `handlePlan` from `src/handlers/` (and from re-exports)
- Delete: `planId` aliases from `brief` tool args, `recall` tool args, `RecallOptions`, `BriefArgs`
- Rename: `src/plans.ts` → `src/briefs.ts` (and `tests/plans.test.ts` → `tests/briefs.test.ts`)
- Modify: all imports of `./plans` → `./briefs` across the codebase
- Modify: `src/types.ts` drops `Plan`, `PlanArgs` types (consider whether `Brief` type should replace; rename for clarity)
- Modify: `src/workspace.ts` removes `getPlansDir` (briefs use `getBriefsDir`)
- Delete: `skills/plan/SKILL.md`, `skills/plan-status/SKILL.md`
- Modify: `src/recall.ts` drops `planId` filter parameter
- Modify: `tests/recall.test.ts`, `tests/handlers.test.ts`, `tests/server.test.ts` drop plan-related coverage

### Cross-client artifacts

`.agents/skills/plan/` and `.agents/skills/plan-status/` get deleted by `scripts/sync-agent-skills.ts` automatically on first run because they no longer exist in canonical `skills/`. Verify the sync script handles the deletion path correctly (it already removes mirrored dirs not present in source).

---

## Pillar 5: Doc cleanup

### Delete (stale exploration / pre-current artifacts)

- `docs/JULIE_BUNDLING_STRATEGY.md` (Julie integration was never adopted; doc reads as live planning)
- `docs/JULIE_INTEGRATION_PLAN.md` (same)
- `docs/RAG_PLANNING.md` (predates the markdown-storage decision; misleading)
- `docs/superpowers/` (predates razorback; superseded)
- `docs/plans/2026-02-14-revival-*.md` (revival phase docs from iteration #5 startup; landed)
- `docs/plans/2026-02-16-v5.1-*.md` (v5.1 specs; landed)
- `docs/plans/2026-02-24-plan-checkpoint-affinity*.md` (plan-tool-era; superseded by retirement)
- `docs/plans/2026-04-14-recall-input-hardening-design.md` (landed in v6.5.3)
- `docs/plans/2026-04-16-brief-repositioning-*.md` (brief migration landed; design doc no longer load-bearing)
- `docs/plans/2026-04-16-cross-client-portability-*.md` (landed in 6.6/6.7)
- `test-julie-integration.ts` at repo root (Julie integration was never adopted)

### Keep

- `docs/IMPLEMENTATION.md` (reference; will be updated to reflect post-v7 architecture)
- `docs/TEST_COVERAGE.md` (verify still accurate; update if not)
- `docs/goldfish-checkpoint.instructions-vs-code.md` (active VS Code adapter doc)
- This design doc (kept as v7.0.0 record)

### Sweep

After targeted deletes, do one grep pass for references to deleted modules in remaining docs and update or delete those references.

---

## Pillar 6: Agent docs refresh (`CLAUDE.md`, `AGENTS.md`)

`CLAUDE.md` and `AGENTS.md` are byte-identical today and both stale ("5 Claude Code skills" when there are 8). Two changes:

1. **Update content** to reflect v7.0.0 architecture: 3 tools, 6 skills (brief, brief-status, checkpoint, handoff, recall, standup), no hooks, no consolidation, no semantic, no plan. Module map matches reality.
2. **Reduce duplication**: keep `CLAUDE.md` as canonical. Generate `AGENTS.md` from `CLAUDE.md` in the same `sync:agent-skills` script (cheap, no symlink portability concerns). Document the generation in the script header so future contributors edit `CLAUDE.md` and run the sync.

Also update `README.md` to remove references to: hooks, consolidation, semantic recall, MiniLM, `@huggingface/transformers`, plan tool, plan/plan-status skills. Tool count goes 4→3 and skill count goes 8→6 in the prose. Add a short section describing the new `/handoff` skill.

Update `docs/IMPLEMENTATION.md` likewise to reflect the new module map.

Drop stale TODO.md items (e.g. "ExitPlanMode → plan save hook" question that was never implemented).

---

## Pillar 7: Handoff skill

### Decision

Add a single new skill, `/handoff`, that produces a returning-engineer summary suitable for any harness or agent picking up cold. The skill composes existing MCP tools (`recall`, `brief`) plus standard shell (`git status`, `git log`) and synthesizes the result into a structured markdown document. No new MCP tool, no handler, no schema change. Skill-only is the cheapest possible v7.0.0 addition that earns the major version bump.

### What the handoff produces

A markdown document with these sections, in order:

1. **Direction** — pulled from the active brief (`recall({ limit: 0 })`); summarize the goal, constraints, and current status in 3-5 lines
2. **State at handoff** — current branch (`git rev-parse --abbrev-ref HEAD`), uncommitted changes (`git status -s`), last commit (`git log -1 --oneline`)
3. **Recent activity** — last 5-10 checkpoints (`recall({ days: 3, limit: 10 })`), grouped by logical milestone, dense format
4. **Next steps** — pulled from the most recent checkpoint's `next` field, supplemented by anything in the brief's success criteria not yet achieved
5. **Open questions** — pulled from the most recent checkpoints' `unknowns` fields and from any open items in the active brief
6. **Source pointers** — paths to the brief file, the most recent checkpoint files, and any referenced `docs/plans/` documents so the receiving agent can read deeper

### Format choice

Markdown, structured headers, dense bullets. Designed to be:

- Read by a human in one pass
- Parsed by a different agent on a different harness without ambiguity
- Pasted directly into a new session prompt or appended to a CLAUDE.md-equivalent without reformatting

### Time scoping

The skill takes one optional argument: a time window (`--since 2d`, `--since 4h`). Default is "since the last commit on the current branch" if that's a sensible boundary; otherwise the last 3 days. The skill description explains both modes.

### Distinction from `/standup`

- `/standup` aggregates *across projects* for a daily-update audience (you, looking at what you did everywhere)
- `/handoff` synthesizes *within one project* for a session-resumption audience (a different agent or a returning you, picking up cold)

The skill descriptions both spell this out so an agent picks the right one.

### Module changes

- Add: `skills/handoff/SKILL.md`
- The sync script (`scripts/sync-agent-skills.ts`) automatically mirrors it to `.agents/skills/handoff/SKILL.md`
- Update: `README.md` skill table includes `/handoff`
- Update: `CLAUDE.md` skill inventory mentions handoff
- Update: server instructions (`src/instructions.ts`) gets a one-line mention of `/handoff` if there's room under the 2k cap

### Test strategy

The skill is markdown content, not code, so unit tests don't apply. Acceptance is "run `/handoff` in this repo and verify the output is useful for a different agent picking up cold." Capture one example output as a fixture in the design's checkpoint trail.

### Why now (in v7.0.0)

A major version bump should ship a new capability, not only deletions. The handoff skill is cheap (one markdown file), composable (no new tool surface), and directly addresses the cross-client gap the rest of the sprint was implicitly setting up: now that hooks are gone and the surface is unified, handoff is the explicit answer to "how does work resume on a different harness?"

---

## Test strategy

TDD per project rules. Each pillar gets its own commit (or small commit cluster) with tests written first.

### New tests

`tests/search.test.ts` (or fold into `tests/ranking.test.ts`):
- Single-term lexical match returns expected checkpoint
- Stemming: "tuning" matches checkpoint containing "tuned"
- Multi-term query prefers checkpoints containing both terms
- Field boosts: match in `description` outranks same term in `files`
- Tags searchable
- Empty query returns input unchanged
- Empty corpus returns empty
- Special characters tolerated
- Regression contract: returns at least one result for each of the 5 queries that fuse returned zero on (`hook loop token burn`, `fuse alternative search engine`, `embedding model download`, `semantic recall broken`, `memory.yaml stale`)

Migration cleanup test:
- Server startup deletes `~/.goldfish/cache/semantic/` and `~/.goldfish/models/transformers/` if present
- Server startup deletes `~/.goldfish/consolidation-state/` if present
- Cleanup is no-op when directories don't exist (no error)

### Tests deleted

- `tests/semantic.test.ts`
- `tests/semantic-cache.test.ts`
- `tests/transformers-embedder.test.ts`
- `tests/consolidate.test.ts`
- `tests/count-stale.test.ts`

### Tests rewritten

- `tests/ranking.test.ts`: replace search tests with Orama equivalents; keep helpers if any survive
- `tests/recall.test.ts`: drop `_semanticRuntime` paths, drop consolidation/memory.yaml paths, drop plan filtering; update search assertions for Orama
- `tests/memory.test.ts`: shrink to what survives (likely deletable entirely)
- `tests/handlers.test.ts`: drop `consolidate` and `plan` handler tests
- `tests/server.test.ts`: 3 tools listed (not 5); no `consolidate`/`plan` routing; instructions string updated; 2k cap still enforced; no plan/consolidation references in the description checks
- `tests/plans.test.ts` → `tests/briefs.test.ts`: drop plan-compat assertions

### Quality bar

Banned patterns still apply: no tautological tests, no smoke-only tests, no copy-paste tests where parameterization fits. Field boosts asserted with concrete expected ordering. Stemming tested with realistic terms from this codebase.

`bun test` and `bun run typecheck` both pass. Existing typecheck errors in test files (logger.test.ts, memory.test.ts, ranking.test.ts, recall.test.ts, semantic-cache.test.ts) get fixed as part of this work since most of those files are being touched or deleted anyway.

---

## Risks and mitigations

| Risk | Mitigation |
|------|-----------|
| Orama major version churn | Pin minor version; audit API on every upgrade |
| BM25 ranks differently than fuse on previously-tuned queries | Comparison harness showed differences are one-sided positive (fuse failed silently, Orama recovered); regression contract enforces this |
| Stemming surprises | Test concrete behavior; fall back to `'simple'` tokenizer if English stemmer is wrong for our domain |
| User has unconsolidated work in memory.yaml that they care about | memory.yaml files on disk are left alone; humans can still read them; consolidation state cleanup is the only deletion that touches user-adjacent storage |
| Removing hooks regresses Claude Code UX for users who relied on auto-recall | Server instructions still nudge agents to call recall; the loss is non-determinism (sometimes the agent will skip), not capability; documented in release notes |
| Plan retirement breaks calls from older harness configs | Clean cut is documented as a major-version breaking change in CHANGELOG; v7.0.0 release notes flag it explicitly |
| The doc sweep deletes something useful | Keep deletions in their own commit so individual reverts are cheap; review the delete list before committing the sweep |

---

## Acceptance criteria

### Code

- [ ] `bun test` passes
- [ ] `bun run typecheck` passes (currently broken on main; fix during this work)
- [ ] `package.json` no longer depends on `@huggingface/transformers`; `@orama/orama` added
- [ ] Source modules deleted: `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`, `src/consolidation-prompt.ts`
- [ ] `src/recall.ts` has no references to: semantic, embedding, hybrid, runtime, maintenance, memory.yaml, consolidation, planId
- [ ] `src/ranking.ts` exports a single `searchCheckpoints(query, checkpoints)` backed by Orama
- [ ] `src/types.ts` no longer exports `SemanticRuntime`, `SemanticModelInfo`, `Plan`, `PlanArgs`, `MemorySection`
- [ ] `src/plans.ts` renamed to `src/briefs.ts`; tests renamed; all imports updated
- [ ] `src/tools.ts` exports 3 tools (checkpoint, recall, brief)
- [ ] `src/handlers/` exports 3 handlers (handleCheckpoint, handleRecall, handleBrief)
- [ ] `hooks/` directory deleted
- [ ] `skills/` contains 6 directories: brief, brief-status, checkpoint, handoff, recall, standup
- [ ] `.agents/skills/` mirrors the same 6
- [ ] `getSemanticWorkspaceKey`, `getConsolidationStatePath`, `getConsolidationStateDir` all deleted (no remaining callers after consolidation removal)
- [ ] Server startup deletes `~/.goldfish/cache/semantic/`, `~/.goldfish/models/transformers/`, `~/.goldfish/consolidation-state/` if present

### Docs

- [ ] `README.md` updated: 3 tools, 6 skills, no hooks/consolidation/semantic/plan/MiniLM mentions, includes `/handoff` description
- [ ] `CLAUDE.md` is canonical; `AGENTS.md` generated from `CLAUDE.md` via `scripts/sync-agent-skills.ts` (or a sibling script)
- [ ] `docs/IMPLEMENTATION.md` updated to reflect new module map
- [ ] Stale docs deleted per pillar 5 list
- [ ] `TODO.md` cleaned of items that no longer apply
- [ ] `test-julie-integration.ts` deleted

### Handoff skill

- [ ] `skills/handoff/SKILL.md` exists, mirrored to `.agents/skills/handoff/`
- [ ] Skill description disambiguates from `/standup` (cross-project standup vs single-project session resumption)
- [ ] Skill explains time-window argument and default behavior
- [ ] One example output captured as a fixture in the design's checkpoint trail (run it on this repo and save the result)

### Release

- [ ] Version bumped to `7.0.0` in `package.json`, `.claude-plugin/plugin.json`, `src/server.ts`
- [ ] Release notes draft listing all breaking changes
- [ ] No changes to `.memories/` markdown file shape (checkpoint.md, brief.md frontmatter and body unchanged)

### Empirical

- [ ] On the 12-query comparison set, the new search returns at least one result for every query

---

## Files touched (estimate)

**Modified:** `package.json`, `.claude-plugin/plugin.json`, `src/server.ts`, `src/recall.ts`, `src/ranking.ts`, `src/workspace.ts`, `src/types.ts`, `src/instructions.ts`, `src/tools.ts`, `src/memory.ts`, `src/handlers/index.ts`, `src/handlers/recall.ts`, `src/handlers/checkpoint.ts`, `tests/ranking.test.ts`, `tests/recall.test.ts`, `tests/handlers.test.ts`, `tests/server.test.ts`, `tests/workspace.test.ts`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/IMPLEMENTATION.md`, `TODO.md`

**Renamed:** `src/plans.ts` → `src/briefs.ts`, `tests/plans.test.ts` → `tests/briefs.test.ts`

**Deleted source:** `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`, `src/consolidation-prompt.ts`, `src/handlers/consolidate.ts`, `src/handlers/plan.ts`

**Deleted hooks:** `hooks/hooks.json`, `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/count-stale.ts` (entire `hooks/` directory)

**Deleted skills:** `skills/consolidate/`, `skills/plan/`, `skills/plan-status/`

**Deleted tests:** `tests/semantic.test.ts`, `tests/semantic-cache.test.ts`, `tests/transformers-embedder.test.ts`, `tests/consolidate.test.ts`, `tests/count-stale.test.ts`, possibly `tests/memory.test.ts`

**Deleted docs:** per pillar 5 list

**Added:** `skills/handoff/SKILL.md`, possibly `scripts/sync-claude-md.ts` (or extension of `sync-agent-skills.ts`) for `AGENTS.md` generation

**Net change:** roughly minus 4,500 source lines, minus 6,000 test lines, plus 200-400 source lines for the Orama wrapper and migration cleanup, plus 400-600 test lines for new BM25 + migration coverage, plus one new skill markdown file. Server tools 5→3. Skills 8→6. Hooks 2→0.
