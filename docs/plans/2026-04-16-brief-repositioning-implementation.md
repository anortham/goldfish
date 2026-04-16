# Brief Repositioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use razorback:executing-plans to implement this plan task-by-task.

**Goal:** Reposition Goldfish's forward-looking artifact from `plan` to `brief`, remove harness plan mirroring, and preserve backward compatibility during the transition.

**Architecture:** Keep the current storage and handler internals as compatibility scaffolding for one release, but make `brief` the primary public concept everywhere users interact with Goldfish. New writes should land in brief storage and brief-facing APIs, while reads continue to accept legacy `plan` data and names until the compatibility window closes.

**Tech Stack:** Bun, TypeScript, YAML frontmatter, MCP SDK, Claude Code skills/hooks, Bun test runner

**Execution notes:** Use `@razorback:test-driven-development` for each task. Use `@razorback:verification-before-completion` before claiming the feature is done.

---

## File Structure

**Core storage and API**
- `src/workspace.ts` manages `.memories` path helpers
- `src/types.ts` defines checkpoint, recall, consolidation, and tool argument contracts
- `src/plans.ts` currently owns plan storage and active marker logic
- `src/handlers/plan.ts` currently owns the plan tool behavior
- `src/tools.ts` and `src/instructions.ts` define MCP-facing behavior
- `src/server.ts` registers tool names and exports handlers

**Downstream consumers of forward-looking state**
- `src/checkpoints.ts` writes checkpoint affinity metadata
- `src/recall.ts` loads the active forward-looking artifact and applies `planId` filtering
- `src/handlers/recall.ts`, `src/handlers/checkpoint.ts`, and `src/handlers/consolidate.ts` render user-facing wording and payloads
- `src/consolidation-prompt.ts`, `src/digests.ts`, and `src/ranking.ts` include the current `plan`/`planId` terminology

**Skill and hook layer**
- `hooks/hooks.json` contains the `ExitPlanMode` auto-save prompt that now causes confusion
- `hooks/session-start.ts` still primes the session with active-plan wording
- `skills/plan/SKILL.md`, `skills/plan-status/SKILL.md`, `skills/recall/SKILL.md`, `skills/standup/SKILL.md`, and `skills/consolidate/SKILL.md` all teach the old model

**Tests and release checks**
- `tests/plans.test.ts`, `tests/handlers.test.ts`, `tests/recall.test.ts`, `tests/checkpoints.test.ts`, `tests/consolidate.test.ts`, `tests/workspace.test.ts`, and `tests/server.test.ts` cover the rename blast radius
- `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `src/server.ts` must stay version-aligned when this ships

## Implementation Strategy

1. Make `brief` the canonical public term first.
2. Preserve legacy `plan` reads and tool aliases for one stable release.
3. Stop auto-mirroring harness plans in the same release so the behavior shift is real, not cosmetic.
4. Keep internal file names such as `src/plans.ts` in place for this pass unless the implementation work proves the rename is cheap. User-facing correctness matters more than internal churn.

### Task 1: Build Brief-First Storage and Type Compatibility

**Files:**
- Modify: `src/workspace.ts:83-138`
- Modify: `src/types.ts:5-25`, `src/types.ts:43-107`, `src/types.ts:156-216`
- Modify: `src/plans.ts:1-326`
- Test: `tests/workspace.test.ts:121-140`
- Test: `tests/plans.test.ts:1-260`, `tests/plans.test.ts:253-260`, `tests/plans.test.ts:500-853`

**What to build:** Add brief storage helpers and brief-facing types without breaking existing plan-based callers or stored data.

**Approach:**
- Add workspace helpers for `.memories/briefs/` and `.active-brief`.
- Keep `getPlansDir()` available for compatibility, but make new write paths use brief storage.
- Add `Brief`, `BriefInput`, `BriefUpdate`, and `BriefArgs` types or aliases in `src/types.ts`.
- Add `briefId` and `brief_id` argument fields alongside legacy `planId` and `plan_id`.
- Extend `src/plans.ts` so it can read from both brief and legacy plan locations, while writing new artifacts to brief storage.
- Add brief-named exports such as `saveBrief`, `getBrief`, `listBriefs`, `getActiveBrief`, `setActiveBrief`, and `updateBrief`.
- Keep `savePlan` and related exports as wrappers or aliases so existing imports and tests can keep working during migration.

**Acceptance criteria:**
- [ ] New writes create `.memories/briefs/<id>.md` and `.memories/.active-brief`
- [ ] Reads still succeed for legacy `.memories/plans/<id>.md` and `.memories/.active-plan`
- [ ] Brief APIs exist without removing legacy plan APIs in this release
- [ ] Storage and compatibility behavior are covered by `tests/workspace.test.ts` and `tests/plans.test.ts`
- [ ] Targeted tests pass, committed

### Task 2: Add the `brief` MCP Tool and Keep `plan` as a Compatibility Alias

**Files:**
- Create: `src/handlers/brief.ts`
- Modify: `src/handlers/index.ts`
- Modify: `src/server.ts:1-108`
- Modify: `src/tools.ts:130-320`
- Modify: `src/instructions.ts:11-50`
- Test: `tests/handlers.test.ts:580-1066`
- Test: `tests/server.test.ts:380-512`

**What to build:** Expose `brief` as the primary MCP tool while keeping old `plan` calls working during the migration window.

**Approach:**
- Implement shared handler logic behind `handleBrief`, then route `handlePlan` through the same code path.
- Register `brief` in `src/server.ts` as the primary user-facing tool name.
- Keep `plan` accepted in server dispatch as a compatibility alias.
- Make `src/tools.ts` advertise `brief` with brief language and remove the “save every ExitPlanMode plan” instruction.
- Update `src/instructions.ts` so the behavioral guidance speaks about briefs and no longer treats `ExitPlanMode` mirroring as mandatory.
- Accept `id`, `briefId`, `brief_id`, `planId`, and `plan_id` in the handler during migration, but return brief wording in responses.

**Acceptance criteria:**
- [ ] `brief` appears in the published tool list as the canonical forward-looking tool
- [ ] Old `plan` calls still succeed through server dispatch
- [ ] Handler output says `Brief saved`, `Brief updated`, `Brief completed`, and `Active Brief`
- [ ] Tool descriptions and server instructions no longer tell agents to mirror every harness plan
- [ ] Handler and server tests cover both canonical and compatibility paths
- [ ] Targeted tests pass, committed

### Task 3: Rename Recall, Checkpoint Affinity, and Consolidation Surfaces to Brief Language

**Files:**
- Modify: `src/checkpoints.ts:138-139`, `src/checkpoints.ts:318`, `src/checkpoints.ts:409-413`
- Modify: `src/digests.ts:105`
- Modify: `src/ranking.ts:110`
- Modify: `src/recall.ts:71`, `src/recall.ts:237-238`, `src/recall.ts:402-410`, `src/recall.ts:454-455`, `src/recall.ts:532-587`
- Modify: `src/handlers/checkpoint.ts:79-99`
- Modify: `src/handlers/recall.ts:39-180`
- Modify: `src/handlers/consolidate.ts:28-114`
- Modify: `src/consolidation-prompt.ts`
- Test: `tests/checkpoints.test.ts:176-196`, `tests/checkpoints.test.ts:518-553`, `tests/checkpoints.test.ts:1146-1170`
- Test: `tests/recall.test.ts:1190-1237`, `tests/recall.test.ts:1919-1983`
- Test: `tests/consolidate.test.ts:250-280`
- Test: `tests/digests.test.ts:31-87`
- Test: `tests/ranking.test.ts:66`

**What to build:** Make downstream memory flows speak in brief language while still reading legacy plan metadata.

**Approach:**
- Write `briefId` to new checkpoint frontmatter.
- Continue parsing legacy `planId` from checkpoint files and map it into the same in-memory field during migration.
- Update recall filters to accept `briefId` while still honoring legacy `planId`.
- Rename user-facing recall output from `Active Plan` to `Active Brief` and `Plan:` to `Brief:`.
- Update consolidation payloads and prompts to prefer `activeBriefPath`, while retaining legacy read support if existing callers depend on `activePlanPath`.
- Make digests and ranking include the brief identifier so semantic behavior does not regress.

**Acceptance criteria:**
- [ ] New checkpoints serialize `briefId`
- [ ] Old checkpoints with `planId` still parse and filter correctly
- [ ] `recall()` surfaces `activeBrief` and brief wording in human-readable output
- [ ] Consolidation prompts and payloads point at the active brief, not the active plan
- [ ] Recall, checkpoint, consolidate, digest, and ranking tests cover the compatibility path
- [ ] Targeted tests pass, committed

### Task 4: Remove Plan-Mode Mirroring and Reset the Skill Layer

**Files:**
- Modify: `hooks/hooks.json:20-27`
- Modify: `hooks/session-start.ts:26-44`
- Create: `skills/brief/SKILL.md`
- Create: `skills/brief-status/SKILL.md`
- Modify: `skills/recall/SKILL.md:1-95`
- Modify: `skills/standup/SKILL.md:1-137`
- Modify: `skills/consolidate/SKILL.md`
- Modify: `skills/plan/SKILL.md:1-110`
- Modify: `skills/plan-status/SKILL.md:1-142`

**What to build:** Remove the behavior that causes Goldfish to compete with harness planning, and teach the skill layer the new split between brief, checkpoints, and `docs/plans/`.

**Approach:**
- Delete the `PostToolUse` `ExitPlanMode` prompt from `hooks/hooks.json`.
- Update `hooks/session-start.ts` to talk about active briefs instead of active plans.
- Add canonical `/brief` and `/brief-status` skills.
- Turn `/plan` and `/plan-status` into compatibility shims that redirect users and agents toward the new brief semantics instead of keeping a second full instruction set alive.
- Update `/standup` and `/recall` so they interpret Goldfish brief as direction, `docs/plans/` as execution detail, and checkpoints as evidence.
- Update `/consolidate` only where its prompt or instructions still refer to active plans.

**Acceptance criteria:**
- [ ] `ExitPlanMode` no longer auto-saves harness plans into Goldfish
- [ ] `/brief` and `/brief-status` exist as the primary skills
- [ ] Old plan skills explain the compatibility path instead of reinforcing the old behavior
- [ ] Session-start and standup guidance use brief language and the new source-of-truth split
- [ ] Hook and skill files are internally consistent
- [ ] Committed

### Task 5: Update Public Docs and Release Metadata

**Files:**
- Modify: `README.md:30-250`, `README.md:349-392`
- Modify: `CONTRIBUTING.md:141-157`, `CONTRIBUTING.md:190-295`, `CONTRIBUTING.md:352`
- Modify: `docs/IMPLEMENTATION.md:23-24`, `docs/IMPLEMENTATION.md:71-100`, `docs/IMPLEMENTATION.md:139`, `docs/IMPLEMENTATION.md:218-261`
- Modify: `docs/goldfish-checkpoint.instructions-vs-code.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `src/server.ts:25`
- Test: `tests/server.test.ts:499-520`

**What to build:** Make the published story match the product and ship the rename as a versioned release.

**Approach:**
- Replace primary user-facing `plan` language with `brief` in README, contributor docs, and implementation docs.
- Document `plan` as a temporary compatibility alias where it is still mentioned.
- Update storage examples from `.memories/plans/` and `.active-plan` to brief paths.
- Update skill and hook inventories in README so the published surface matches the shipped files.
- Bump the version across `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `src/server.ts`.

**Acceptance criteria:**
- [ ] Main docs describe `brief` as the canonical artifact
- [ ] Compatibility notes explain old `plan` paths and commands where needed
- [ ] Version metadata is synchronized across runtime and plugin files
- [ ] `tests/server.test.ts` version-alignment checks still pass
- [ ] Committed

### Task 6: Full Verification and Cleanup

**Files:**
- Modify: any touched files that fail verification

**What to build:** Prove the rename works end-to-end and clean up lingering user-facing `plan` wording that should have died in Task 5.

**Approach:**
- Run targeted suites while implementing:
  - `bun test plans handlers recall checkpoints consolidate workspace server`
- Run the full suite before closing the work:
  - `bun test`
- Run a text audit for stale user-facing language:
  - `rg -n "\\bplan\\b|Active Plan|active plan|planId|.active-plan|/plan-status|/plan\\b" src skills hooks README.md CONTRIBUTING.md docs/IMPLEMENTATION.md`
- Allow compatibility mentions that are labeled as aliases or migration notes. Remove stray primary-surface uses.
- If the full suite or audit exposes drift, fix it before marking the feature done.

**Acceptance criteria:**
- [ ] Targeted suites pass during implementation
- [ ] Full test suite passes
- [ ] Remaining `plan` wording is limited to compatibility paths, migration notes, and historical docs
- [ ] Final git status is clean except for intentional release artifacts
- [ ] Final verification checkpoint saved, committed

