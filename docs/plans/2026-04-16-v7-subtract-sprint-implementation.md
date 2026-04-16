# Goldfish v7.0.0 Subtract Sprint Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use razorback:executing-plans to implement this plan task-by-task.

**Goal:** Land the v7.0.0 release as designed in `docs/plans/2026-04-16-v7-subtract-sprint-design.md`. Replace fuse.js + the local-embedding stack with Orama BM25, delete hooks and consolidation, retire the plan tool, clean up stale docs, refresh agent docs, and add the new `/handoff` skill.

**Architecture:** Four sequential phases corresponding to natural commit clusters. Each phase ends with `bun test` and `bun run typecheck` both passing. Phases are sequential (not parallel) because Phase 2 simplifies code Phase 1 already touched, Phase 3 renames files Phase 2 imported, and Phase 4 documents the final shape.

**Tech Stack:** Bun, TypeScript, `@orama/orama` (new), `@modelcontextprotocol/sdk`, `yaml` (kept; still used for brief frontmatter).

**TDD discipline:** Every behavior change starts with a failing test. The project's CLAUDE.md is non-negotiable on this. Implementer judgment governs the within-task TDD choreography.

---

## Phase 1: Orama swap + semantic stack deletion

Replace fuse.js + semantic stack with Orama BM25 as the single search primitive. End state: `bun test` passes, `@huggingface/transformers` is gone from `package.json`, no module references `semantic`, `embedding`, `runtime`, or `hybrid`.

### Task 1.1: Add Orama, write the failing search tests

**Files:**
- Modify: `package.json` (add `@orama/orama`)
- Create: `tests/search.test.ts` (or extend `tests/ranking.test.ts`)

**What to build:** Failing tests that pin the BM25 contract before implementation. The tests assert behaviors the design promised: stemming, multi-term scoring, field boosts mirroring fuse weights, the regression contract on the 5 queries fuse silently failed.

**Approach:** Use `@orama/orama`'s `create`, `insertMultiple`, `search`. Test cases come from realistic checkpoint shapes built via test fixtures. The five regression-contract queries — `hook loop token burn`, `fuse alternative search engine`, `embedding model download`, `semantic recall broken`, `memory.yaml stale` — can use minimal synthetic checkpoints that contain only the keywords each query should hit. Don't load real `.memories/` data into tests.

**Acceptance criteria:**
- [ ] `@orama/orama` added as runtime dependency in `package.json` and `bun.lock`
- [ ] Test file exists with failing tests for: single-term match, stemming (`tuning` matches `tuned`), multi-term ordering, field-boost ordering (description > files), tag search, empty query, empty corpus, special-character tolerance, and the 5-query regression contract
- [ ] Tests fail with the expected "function not implemented" or "import not found" shape (not crash)

### Task 1.2: Implement the Orama-backed `searchCheckpoints`

**Files:**
- Modify: `src/ranking.ts` (replace fuse implementation; keep export shape for `searchCheckpoints(query, checkpoints)`)

**What to build:** A new `searchCheckpoints` that builds an Orama index per call, runs BM25 search with the boost table from the design doc, and returns checkpoints in score order. Drop fuse import.

**Approach:** Keep the function signature compatible with current callers. Inside: build the index from the checkpoint array, joining string-array fields (`tags`, `alternatives`, `evidence`, `symbols`, `unknowns`, `git.files`) with spaces. Use the english tokenizer with stemming. Use the boost table from the design (description 2.0, decision 1.5, impact 1.3, context 1.1, tags 1.0, alternatives 0.8, evidence 0.7, symbols 0.7, unknowns 0.6, next 0.5, branch 0.5, files 0.3). The `description` field for the index should be the result of `buildRetrievalDigest(checkpoint)` from `src/digests.ts` so the indexed body matches what the previous hybrid path used.

**Acceptance criteria:**
- [ ] All Phase 1 tests pass
- [ ] No `fuse.js` import remains in `src/ranking.ts`
- [ ] Function signature `searchCheckpoints(query: string, checkpoints: Checkpoint[]): Checkpoint[]` unchanged
- [ ] Empty query and empty corpus paths preserved

### Task 1.3: Strip hybrid/semantic plumbing from `ranking.ts` and `recall.ts`

**Files:**
- Modify: `src/ranking.ts` (delete `rankSearchCheckpoints`, `buildHybridRanking`, `cosineSimilarity` helpers, `ReadySemanticRecord` export, `MINIMUM_SEARCH_RELEVANCE` if only used by hybrid, lexical-candidate-rebuilding logic)
- Modify: `src/recall.ts` (drop all imports from `semantic`, `semantic-cache`, `transformers-embedder`; drop `loadReadySemanticRecords`, `runSearchSemanticMaintenance`, query-embedding plumbing, `_semanticRuntime` parameter usage; replace `rankSearchCheckpoints` calls with direct `searchCheckpoints`)
- Modify: `src/types.ts` (delete `SemanticRuntime`, `SemanticModelInfo`, `_semanticRuntime` from `RecallOptions`)
- Modify: `tests/recall.test.ts` (delete every test that touches `_semanticRuntime`, semantic maintenance, or hybrid ranking; keep date-window, limit, search-result, workspace-scope, registry, cross-workspace, brief-filter tests)
- Modify: `tests/ranking.test.ts` (delete hybrid-ranking tests; keep search and helper tests; the new search tests from 1.1 may already cover what's needed)

**What to build:** Recall now has one search path: load checkpoints, call `searchCheckpoints`, return results. No fallback, no maintenance, no embedding wait, no candidate union.

**Approach:** Read `src/recall.ts` end-to-end before editing. The two `rankSearchCheckpoints` call sites (around line 504 and 713) become single-line `searchCheckpoints` calls. Delete the surrounding plumbing (`loadReadySemanticRecords`, `runSearchSemanticMaintenance`, query-embedding-promise builder, the abort-controller machinery) wholesale. The `MINIMUM_SEARCH_RELEVANCE` filter goes away with hybrid ranking; verify no test depends on that filtering behavior, and if any does, port it to the Orama path or document why it's gone.

**Acceptance criteria:**
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes (existing test typecheck errors fixed in passing as we touch those files)
- [ ] `src/recall.ts` no longer imports from `./semantic`, `./semantic-cache`, `./transformers-embedder`, or `./ranking` for anything other than `searchCheckpoints`
- [ ] `src/ranking.ts` exports only `searchCheckpoints`
- [ ] `RecallOptions` no longer mentions `_semanticRuntime`

### Task 1.4: Delete the semantic modules and the transformers dependency

**Files:**
- Delete: `src/semantic.ts`, `src/semantic-cache.ts`, `src/transformers-embedder.ts`
- Delete: `tests/semantic.test.ts`, `tests/semantic-cache.test.ts`, `tests/transformers-embedder.test.ts`
- Modify: `src/workspace.ts` (delete `getSemanticCacheDir`, `getModelCacheDir`; keep `getSemanticWorkspaceKey` for now since `getConsolidationStatePath` still calls it — Phase 2 deletes both)
- Modify: `src/server.ts` (drop the `pruneOrphanedSemanticCaches` import and call)
- Modify: `package.json` (remove `@huggingface/transformers` from dependencies)
- Modify: `tests/workspace.test.ts` (drop tests for deleted helpers)

**What to build:** Source tree no longer contains the semantic stack; dependency footprint shrinks by 90MB.

**Approach:** Delete files first, then run `bun test` to surface every dangling import. Fix each one. Re-run `bun install` to refresh the lockfile after the dependency removal.

**Acceptance criteria:**
- [ ] Three source files and three test files deleted
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes
- [ ] `package.json` has no `@huggingface/transformers` line
- [ ] `bun.lock` no longer references the transformers package
- [ ] `node_modules/@huggingface/` does not exist after `bun install`

### Task 1.5: Migration cleanup on server startup

**Files:**
- Modify: `src/server.ts` (add a one-shot best-effort cleanup of `~/.goldfish/cache/semantic/` and `~/.goldfish/models/transformers/` on first call to `createServer` per process)
- Create or modify: `tests/server.test.ts` (test that the cleanup is called and is no-op-safe when directories don't exist)

**What to build:** First v7 server start prunes the semantic cache and model directories. After that it's a silent no-op. The cleanup code stays in v7.0 only; remove in v7.1.

**Approach:** Use `rm` from `fs/promises` with `recursive: true, force: true` so missing directories don't throw. Wrap in try/catch and log nothing (best-effort, silent). Add a comment noting the v7.0-only deletion plan.

**Acceptance criteria:**
- [ ] Cleanup runs on first `createServer` call
- [ ] Test verifies cleanup invocation and no-throw on missing dirs
- [ ] Comment marks the cleanup as v7.0.0-only
- [ ] `bun test` passes

### Phase 1 commit boundary

Commit message: `feat: replace fuse.js + semantic stack with Orama BM25`

After this commit, the project should run end-to-end with Orama as its only search engine, no semantic plumbing remaining, and the transformers dependency gone.

---

## Phase 2: Hook deletion + consolidation deletion

Delete the `hooks/` directory and the consolidation routine. End state: `bun test` passes, no `consolidate` tool surface, no `memory.yaml` read/write code, no `~/.goldfish/consolidation-state/` writes.

### Task 2.1: Migrate behavioral nudges from session-start hook into server instructions

**Files:**
- Modify: `src/instructions.ts` (add the three nudges that were in the SessionStart hook's `additionalContext`: checkpoint before commits, always commit `.memories/`, never ask permission)
- Modify: `tests/server.test.ts` (assert the nudges are present in the instructions string and the instructions still fit under the 2k cap)

**What to build:** The three behavioral rules survive the hook removal. They live in the server instructions string going forward.

**Approach:** Read `src/instructions.ts` in full. Insert a new section near the top (before "Checkpointing" or as part of it) titled "Source Control" or fold into existing sections. Keep the wording terse. Verify the existing 2k cap test still passes; if not, trim other sections (the "Consolidation" section is going to be deleted in Task 2.6 anyway, so its bytes will free up shortly — sequence the edits so the cap test stays green at every commit).

**Acceptance criteria:**
- [ ] Three nudges present in instructions
- [ ] 2k cap test passes
- [ ] Test assertions added for the new content

### Task 2.2: Delete the hooks directory

**Files:**
- Delete: `hooks/hooks.json`, `hooks/session-start.ts`, `hooks/pre-compact.ts`, `hooks/count-stale.ts`
- Delete: `tests/count-stale.test.ts`
- Verify: `.claude-plugin/plugin.json` does not reference hook discovery (current manifest only declares `mcpServers`; verify no change needed beyond version bump)

**What to build:** No more hook automation. Claude Code will silently stop firing the hooks since the directory and definition file are gone.

**Approach:** `git rm` the directory and the test. Confirm `bun test` passes.

**Acceptance criteria:**
- [ ] `hooks/` directory does not exist
- [ ] `tests/count-stale.test.ts` does not exist
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

### Task 2.3: Failing tests for consolidation removal

**Files:**
- Modify: `tests/server.test.ts` (assert that `getTools()` returns 3 tools: checkpoint, recall, brief — no `consolidate`, no `plan`)
- Modify: `tests/handlers.test.ts` (delete the `handleConsolidate` test block; expect tests to fail because the handler is still being routed)
- Modify: `tests/recall.test.ts` (assert recall response no longer includes a `memory` field, no `consolidation` flag, no delta-vs-bootstrap distinction; expect tests to fail because recall still returns those)

**What to build:** The test suite pins the post-consolidation contract so the implementation has a clear target.

**Approach:** Update assertions, do not delete tests yet. The failures drive the implementation in Tasks 2.4-2.6.

**Acceptance criteria:**
- [ ] `bun test` shows the new assertions failing for the documented reasons
- [ ] No assertion relies on consolidation being present

### Task 2.4: Remove the consolidate tool surface

**Files:**
- Modify: `src/tools.ts` (delete the `consolidate` tool entry)
- Modify: `src/server.ts` (delete the `case 'consolidate':` arm; delete `handleConsolidate` from imports/re-exports; remove `'consolidate'` from `WORKSPACE_AWARE_TOOLS`)
- Modify: `src/handlers/index.ts` (delete the `handleConsolidate` re-export)
- Delete: `src/handlers/consolidate.ts`
- Delete: `src/consolidation-prompt.ts`
- Delete: `tests/consolidate.test.ts`
- Modify: `src/types.ts` (delete `ConsolidateArgs`)

**What to build:** No more consolidate tool. Server only routes 4 tools (checkpoint, recall, brief, plan — plan still being retired in Phase 3).

**Approach:** Remove the surface area. Run `bun test` after each file change to keep failures focused.

**Acceptance criteria:**
- [ ] `getTools()` returns one fewer tool
- [ ] No `consolidate` references in `src/`, `tests/`, or `skills/`
- [ ] `tests/server.test.ts` consolidate-related assertions pass
- [ ] `bun test` passes

### Task 2.5: Delete consolidation skill and consolidation-state I/O

**Files:**
- Delete: `skills/consolidate/SKILL.md` and `skills/consolidate/` directory
- Modify: `src/memory.ts` (delete `readConsolidationState`, `writeConsolidationState`, `parseMemoryYaml`, `parseMemorySections`, `parseYamlSections`, `parseMarkdownSections`, `getMemorySummary`, `headerToSlug`, `readMemory`, `writeMemory`, `isYamlMemory`, `isEnoent`, `MEMORY_YAML`, `MEMORY_MD_LEGACY`, `CONSOLIDATION_STATE_FILE_LEGACY`, `SECTION_DISPLAY_NAMES`, `SECTION_KEYS`, `memoriesDir`; if nothing remains in the file, delete it entirely and update imports)
- Modify: `src/types.ts` (delete `ConsolidationState`, `MemoryData`, `MemorySection`)
- Modify: `src/workspace.ts` (delete `getConsolidationStatePath`, `getConsolidationStateDir`, and `getSemanticWorkspaceKey` — no remaining callers)
- Modify: `tests/memory.test.ts` (delete entirely since the module is gone — verify nothing else imports from it before deletion)
- Modify: `tests/workspace.test.ts` (drop tests for deleted helpers)

**What to build:** No more consolidation-state files written; no more `memory.yaml` parsing; no helper functions for either.

**Approach:** `src/memory.ts` is likely deletable in full. Verify with grep before deleting: search for `from './memory'` in `src/` and `tests/` to find every importer. Each importer needs its import updated or the dependency removed.

**Acceptance criteria:**
- [ ] `src/memory.ts` either deleted or empty of consolidation/memory.yaml logic
- [ ] No `~/.goldfish/consolidation-state/` write paths remain
- [ ] `getSemanticWorkspaceKey`, `getConsolidationStatePath`, `getConsolidationStateDir` all gone
- [ ] `bun test` passes

### Task 2.6: Strip consolidation paths from `recall.ts` and `instructions.ts`

**Files:**
- Modify: `src/recall.ts` (delete imports from `./memory`; delete `readMemory`/`getMemorySummary`/`parseMemorySections` calls; delete `consolidation.needed` flag composition; delete `delta` vs bootstrap distinction in checkpoint selection; delete `MEMORY_SECTION_PREFIX` constant; delete memory-section search candidates from search path; simplify `RecallResult` shaping accordingly)
- Modify: `src/instructions.ts` (delete the entire "Consolidation" section)
- Modify: `src/types.ts` (drop `consolidation` and `memory` fields from `RecallResult`)
- Modify: `src/handlers/recall.ts` (drop response formatting that touched memory sections, consolidation flag, or delta wording)
- Modify: `tests/recall.test.ts` (update remaining assertions to match the new response shape; the failing assertions from Task 2.3 should now pass)

**What to build:** Recall returns: active brief + checkpoints. No memory sections, no consolidation flag, no delta wording. The response shape is simpler and the formatting code shrinks accordingly.

**Approach:** Trace one full recall flow end-to-end before editing. Identify every place `consolidation.needed` is composed and every place `parseMemorySections` is called. Delete each. Update the response formatter so the user-facing output stays clean.

**Acceptance criteria:**
- [ ] Recall response contains only brief + checkpoints + (for cross-workspace) workspace summaries
- [ ] No `consolidation` field in `RecallResult` type
- [ ] All Task 2.3 failing tests now pass
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

### Task 2.7: Migration cleanup for consolidation state

**Files:**
- Modify: `src/server.ts` (extend the v7.0-only cleanup from Task 1.5 to also delete `~/.goldfish/consolidation-state/`)
- Modify: `tests/server.test.ts` (assert the cleanup includes the consolidation-state directory)

**What to build:** First v7 server start also prunes the consolidation-state directory.

**Approach:** Same pattern as Task 1.5: best-effort `rm` with `recursive: true, force: true`. Update the comment to list all three directories being cleaned.

**Acceptance criteria:**
- [ ] Cleanup deletes the consolidation-state directory if present
- [ ] No-throw on missing
- [ ] Test assertion added

### Phase 2 commit boundary

Commit message: `feat: delete hooks and consolidation routine`

After this commit, the project should run with no hooks, no consolidation, no memory.yaml read/write. Server tools are 4 (checkpoint, recall, brief, plan). Plan retirement comes next.

---

## Phase 3: Plan tool retirement + briefs.ts rename

Cut `plan` clean. Rename `plans.ts` → `briefs.ts`. Drop `planId` aliases. End state: server exposes 3 tools (checkpoint, recall, brief), 6 skills (brief, brief-status, checkpoint, recall, standup — handoff comes in Phase 4), and `src/briefs.ts` is the canonical brief module.

### Task 3.1: Failing tests for plan retirement

**Files:**
- Modify: `tests/server.test.ts` (assert `getTools()` returns 3 tools and the description list includes only checkpoint, recall, brief)
- Modify: `tests/handlers.test.ts` (delete the `handlePlan` test block; assert the export doesn't exist)
- Modify: `tests/recall.test.ts` (delete `planId` filter tests; assert the parameter is no longer accepted)
- Modify: `tests/plans.test.ts` (rename to `tests/briefs.test.ts`, drop any plan-compat assertions, keep brief behavior tests)

**What to build:** Test suite pins the post-plan-retirement contract.

**Approach:** Make the assertions, run tests, see the failures.

**Acceptance criteria:**
- [ ] Failing tests document the target shape

### Task 3.2: Delete the plan tool and handler

**Files:**
- Modify: `src/tools.ts` (delete the `plan` tool entry)
- Modify: `src/server.ts` (delete `case 'plan':`; delete `handlePlan` from imports/re-exports; remove `'plan'` from `WORKSPACE_AWARE_TOOLS`)
- Delete: `src/handlers/plan.ts`
- Modify: `src/handlers/index.ts` (delete the `handlePlan` re-export)
- Modify: `src/types.ts` (delete `PlanArgs`)

**What to build:** No more plan tool surface.

**Approach:** Surgical deletes. Run tests after each file.

**Acceptance criteria:**
- [ ] `getTools()` returns 3 tools
- [ ] No `plan` references in `src/server.ts`, `src/tools.ts`, or `src/handlers/`
- [ ] Failing assertions from Task 3.1 (tool count and handler) now pass

### Task 3.3: Rename `plans.ts` to `briefs.ts` and clean planId aliases

**Files:**
- Rename via `git mv`: `src/plans.ts` → `src/briefs.ts`
- Rename via `git mv`: `tests/plans.test.ts` → `tests/briefs.test.ts`
- Modify all imports: search for `from './plans'` and `from '../src/plans'` across `src/` and `tests/`, update to `briefs`
- Modify: `src/tools.ts` (delete `planId` from `brief` and `recall` schemas; delete `planId` from any tool description prose)
- Modify: `src/types.ts` (delete `Plan`, `PlanArgs`; delete `planId` from `BriefArgs` and `RecallOptions`; consider renaming `Plan`-suffixed types to `Brief`-suffixed if any survive)
- Modify: `src/handlers/brief.ts` (drop `planId` alias resolution)
- Modify: `src/handlers/recall.ts` (drop `planId` alias)
- Modify: `src/recall.ts` (drop `planId` parameter handling; if only `briefId` filter remains, simplify the filter logic)
- Modify: `src/checkpoints.ts` (search for `planId` references; the type field on `Checkpoint` may still need `planId` for reading legacy checkpoint files — keep the read path, drop any write path)
- Modify: `src/workspace.ts` (delete `getPlansDir`; briefs use `getBriefsDir`)
- Modify: any test that imports from `./plans` or references `planId`

**What to build:** All code references the new name. `planId` is no longer accepted as a parameter alias on any tool. Existing checkpoint files with `planId:` in frontmatter still read correctly (legacy field on the `Checkpoint` type stays for read compatibility, no new writes use it).

**Approach:** Do the renames via `git mv` first so git tracks the move. Then sweep imports with grep. The `Checkpoint.planId` legacy field is the one place to be careful: existing user `.memories/2026-*/​*.md` files have `planId:` in frontmatter. Those must continue to parse. The field can be removed from the *write* path but must stay in the *read* path. Verify with the existing checkpoint-file fixtures in tests.

**Acceptance criteria:**
- [ ] `src/plans.ts` does not exist; `src/briefs.ts` does
- [ ] `tests/plans.test.ts` does not exist; `tests/briefs.test.ts` does
- [ ] No code imports from `./plans` or `../src/plans`
- [ ] No tool schema accepts `planId`
- [ ] Existing checkpoint frontmatter with `planId:` still parses without error (regression test)
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

### Task 3.4: Delete plan and plan-status skills

**Files:**
- Delete: `skills/plan/SKILL.md` and `skills/plan/` directory
- Delete: `skills/plan-status/SKILL.md` and `skills/plan-status/` directory
- Run: `bun run sync:agent-skills` to mirror the deletions to `.agents/skills/`

**What to build:** Skill inventory drops plan and plan-status.

**Approach:** Delete the directories. The sync script already handles deletions (it removes mirrored dirs not present in source). Verify by inspecting `.agents/skills/` after running the script.

**Acceptance criteria:**
- [ ] `skills/plan/`, `skills/plan-status/` do not exist
- [ ] `.agents/skills/plan/`, `.agents/skills/plan-status/` do not exist after running the sync script
- [ ] `bun test` passes (test that scans the skill inventory should also pass — verify via `tests/server.test.ts` or similar)

### Phase 3 commit boundary

Commit message: `feat: retire plan tool, rename plans.ts to briefs.ts`

After this commit, the project exposes 3 MCP tools and 5 skills (brief, brief-status, checkpoint, recall, standup). Phase 4 adds the 6th (handoff) and refreshes documentation.

---

## Phase 4: Doc cleanup, agent docs refresh, handoff skill, version bump

Final phase: delete stale docs, update README/CLAUDE.md/AGENTS.md, add the handoff skill, bump to v7.0.0, capture release notes.

### Task 4.1: Delete stale documentation

**Files:**
- Delete: `docs/JULIE_BUNDLING_STRATEGY.md`
- Delete: `docs/JULIE_INTEGRATION_PLAN.md`
- Delete: `docs/RAG_PLANNING.md`
- Delete: `docs/superpowers/` directory
- Delete: `docs/plans/2026-02-14-revival-design.md`
- Delete: `docs/plans/2026-02-14-revival-phase1.md`
- Delete: `docs/plans/2026-02-14-revival-phase2.md`
- Delete: `docs/plans/2026-02-14-revival-phase3.md`
- Delete: `docs/plans/2026-02-14-revival-phase4.md`
- Delete: `docs/plans/2026-02-14-revival-phase5.md`
- Delete: `docs/plans/2026-02-16-v5.1-implementation.md`
- Delete: `docs/plans/2026-02-16-v5.1-skills-refresh-design.md`
- Delete: `docs/plans/2026-02-24-plan-checkpoint-affinity-design.md`
- Delete: `docs/plans/2026-02-24-plan-checkpoint-affinity.md`
- Delete: `docs/plans/2026-04-14-recall-input-hardening-design.md`
- Delete: `test-julie-integration.ts` (repo root)

**What to build:** Stale exploration docs and pre-current planning docs are gone.

**Approach:** `git rm` each. Keep the v6.6/v6.7-era docs (`2026-04-16-brief-repositioning-*`, `2026-04-16-cross-client-portability-*`) as recent history per the design.

**Acceptance criteria:**
- [ ] All listed paths gone
- [ ] `git status -s` shows no extra deletions
- [ ] `bun test` passes

### Task 4.2: Sweep remaining doc references to deleted modules

**Files:**
- Modify: any `.md` file in `docs/` or `README.md` that mentions: `semantic`, `embeddings`, `MiniLM`, `transformers`, `consolidation`, `consolidate`, `memory.yaml`, `memory.md`, `MEMORY.md`, `plan tool`, `/plan`, `/plan-status`, `hooks`, `SessionStart`, `PreCompact`, `julie`, `RAG`

**What to build:** No reference rot. Every deleted concept is also gone from prose.

**Approach:** `grep -ri` for each term across `docs/`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `TODO.md`. Update or delete each reference. Reference rot is a maintenance trap; one careful sweep now beats discovering stale references for months.

**Acceptance criteria:**
- [ ] `grep -ri "semantic\|MiniLM\|transformers\|consolidate\|memory.yaml\|/plan\b\|SessionStart\|PreCompact\|julie\|RAG" docs/ README.md CLAUDE.md AGENTS.md TODO.md` returns only intentional references (e.g. semantic in a release-notes "removed" line)

### Task 4.3: Update README, IMPLEMENTATION.md, TODO.md

**Files:**
- Modify: `README.md` (3 tools, 6 skills, no hooks/consolidation/semantic/plan/MiniLM, includes `/handoff` description, updated module map at the bottom)
- Modify: `docs/IMPLEMENTATION.md` (new module map: no semantic.ts, semantic-cache.ts, transformers-embedder.ts, consolidation-prompt.ts, plans.ts, plan.ts handler, hooks/; add briefs.ts, handoff skill)
- Modify: `TODO.md` (drop ExitPlanMode question, drop "Tune skill language" if landed, drop any item about consolidation tuning, refresh "From Real Usage" section)
- Modify: `CLAUDE.md` (3 tools, 6 skills, updated module map, drop semantic and consolidation references, drop hook references, drop plan compatibility language)

**What to build:** All user- and contributor-facing docs match the v7.0.0 reality.

**Approach:** Read each file end-to-end before editing. Make a single thorough edit per file rather than incremental nibbling. The 7-pillar design doc is the source of truth for what the post-v7 architecture looks like.

**Acceptance criteria:**
- [ ] README skill table lists 6 skills
- [ ] README tool count is 3
- [ ] README mentions `/handoff` with a 1-2 sentence description
- [ ] CLAUDE.md test/module references match reality (verify with `bun test` count, file paths)
- [ ] IMPLEMENTATION.md module map matches `src/`

### Task 4.4: Generate AGENTS.md from CLAUDE.md

**Files:**
- Modify: `scripts/sync-agent-skills.ts` (or create sibling `scripts/sync-claude-md.ts`) to copy `CLAUDE.md` to `AGENTS.md` after writing the skill mirror
- Run: the script
- Modify: header comment in the script explaining that `CLAUDE.md` is canonical

**What to build:** `AGENTS.md` is generated from `CLAUDE.md` and the two files cannot drift.

**Approach:** Cleanest is to extend the existing `sync-agent-skills.ts` since it already runs as `bun run sync:agent-skills`. Add a final step that does atomic copy from `CLAUDE.md` to `AGENTS.md`. Document in the script header. Verify the copy includes the same content byte-for-byte.

**Acceptance criteria:**
- [ ] Sync script writes `AGENTS.md` after the skill mirror
- [ ] `diff CLAUDE.md AGENTS.md` returns no differences
- [ ] Script's purpose is documented in its header
- [ ] `package.json` script `sync:agent-skills` still works

### Task 4.5: Add the `/handoff` skill

**Files:**
- Create: `skills/handoff/SKILL.md`
- Run: `bun run sync:agent-skills` to mirror to `.agents/skills/handoff/SKILL.md`
- Modify: `README.md` skill table (add `/handoff`)
- Modify: `CLAUDE.md` skill inventory (add handoff)

**What to build:** The 6th skill exists. It instructs the agent to compose recall, brief, and git into a returning-engineer summary.

**Approach:** Write the skill following the format used by other Goldfish skills (YAML frontmatter with `name`, `description`, `allowed-tools`; markdown body with sections for "When To Use", "Workflow", "Output Format", "Distinction from /standup"). Use the design doc's Pillar 7 spec as the content guide. The `allowed-tools` line should include `mcp__goldfish__recall`, `mcp__goldfish__brief`, and `Bash` (for `git status` and `git log`).

The skill body should:
1. Explain when handoff applies (returning to a project, switching harnesses, agent handover)
2. Lay out the 4-step workflow: load brief, load recent checkpoints, capture git state, synthesize
3. Specify the output structure (Direction, State at handoff, Recent activity, Next steps, Open questions, Source pointers)
4. Distinguish from `/standup` (handoff = single-project session resumption; standup = cross-project daily summary)
5. Document the time-window argument (`--since 2d` etc.) with default behavior (last 3 days, or since last commit on current branch when sensible)

**Acceptance criteria:**
- [ ] `skills/handoff/SKILL.md` exists with valid YAML frontmatter
- [ ] `.agents/skills/handoff/SKILL.md` exists with the same content
- [ ] Skill description disambiguates from `/standup`
- [ ] README and CLAUDE.md mention `/handoff`
- [ ] No new MCP tool added; skill composes existing ones

### Task 4.6: Capture an example handoff output

**Files:**
- Run: `/handoff` (manually) on this repo
- Save: the output as a checkpoint via `mcp__goldfish__checkpoint` with type=`learning`, tagged `handoff`, `fixture`, `v7.0.0`

**What to build:** A real example of `/handoff` output captured as a checkpoint, so future agents have a concrete reference when invoking the skill.

**Approach:** After everything else is in place, manually invoke the skill on the goldfish repo. The output should be a structured markdown document covering brief, state, activity, next, questions, pointers. Save the entire output as the checkpoint description.

**Acceptance criteria:**
- [ ] One handoff output captured as a checkpoint in `.memories/`
- [ ] Output includes all six sections from the design
- [ ] Output is parseable enough that a different agent could resume work from it

### Task 4.7: Bump to v7.0.0 and write release notes

**Files:**
- Modify: `package.json` (version → `7.0.0`)
- Modify: `.claude-plugin/plugin.json` (version → `7.0.0`)
- Modify: `src/server.ts` (`SERVER_VERSION` → `'7.0.0'`)
- Create or modify: `CHANGELOG.md` (add v7.0.0 section listing breaking changes and additions)

**What to build:** Major version bump synchronized across all three places (a test enforces this). CHANGELOG documents the breaking changes for users.

**Approach:** Update the three version locations in one commit. Write CHANGELOG entries grouped by: Breaking Changes (hooks, consolidation, plan tool, semantic recall, transformers dep), Added (`/handoff` skill, Orama BM25 search), Changed (improved search relevance, simplified module map), Migration Notes (existing memory.yaml and consolidation-state files are left/cleaned automatically).

**Acceptance criteria:**
- [ ] All three version locations show `7.0.0`
- [ ] Version-sync test passes
- [ ] `CHANGELOG.md` (or release-notes section) covers all v7.0.0 changes
- [ ] `bun test` passes
- [ ] `bun run typecheck` passes

### Phase 4 commit boundary

Commit message: `chore: release v7.0.0` (with the CHANGELOG section in the commit body)

After this commit, the project is on v7.0.0 with all seven design pillars landed. Tag the commit: `git tag v7.0.0`.

---

## End-of-sprint verification

Before declaring done:

- [ ] `bun test` passes (no skipped tests, no `xit`/`xdescribe`)
- [ ] `bun run typecheck` passes with no errors
- [ ] `git status -s` is clean
- [ ] `package.json` dependencies do not include `@huggingface/transformers` or `fuse.js`
- [ ] `package.json` dependencies include `@orama/orama`
- [ ] `bun run sync:agent-skills` is a no-op (everything already in sync)
- [ ] `diff CLAUDE.md AGENTS.md` returns no differences
- [ ] `find src/ -name "semantic*.ts" -o -name "transformers*.ts" -o -name "consolidation*.ts" -o -name "plans.ts"` returns nothing
- [ ] `find skills -type d -name "plan*" -o -name "consolidate"` returns nothing
- [ ] `find hooks -type f` returns nothing (or `hooks/` is gone)
- [ ] `getTools()` from `src/tools.ts` returns 3 entries
- [ ] `skills/` contains exactly 6 directories
- [ ] Manually run `/handoff` on this repo and verify the output is usable
- [ ] Manually run `recall({ search: "hook loop token burn" })` and verify it returns relevant results (regression contract)

---

## Notes for implementers

- **Don't ask permission to checkpoint.** Goldfish's own behavioral rule applies to this work.
- **Commit per task, not per phase.** Smaller commits are easier to revert and review. The phase boundaries are commit messages for the *final* commit of each phase, not the only commit.
- **Use Julie tools** (`get_context`, `deep_dive`, `get_symbols`, `fast_refs`) before modifying any non-trivial symbol.
- **Run `bun test` between tasks**, not just at phase boundaries. Catch regressions early.
- **If a deletion surfaces a dangling import you didn't anticipate**, fix it in the same commit as the deletion. Don't leave broken intermediate states.
- **The design doc is canonical** for any architectural question this plan glosses. When in doubt, re-read `docs/plans/2026-04-16-v7-subtract-sprint-design.md`.
