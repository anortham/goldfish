# Reviewed Defects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use razorback:subagent-driven-development when subagent delegation is available. Fall back to razorback:executing-plans for single-task, tightly-sequential, or no-delegation runs.

**Goal:** Fix the concrete defects found in the review pass without widening scope into unrelated refactors.

**Architecture:** Keep the fixes surgical. Add regression coverage first, then patch the smallest code paths that own each bug: checkpoint persistence, registry consistency, recall summarization, brief input/parsing, workspace validation, and `.memories/` directory creation. Preserve legacy read compatibility where possible, but stop creating dead legacy directories.

**Tech Stack:** Bun, TypeScript, Bun test runner, YAML frontmatter, Orama search.

---

### Task 1: Checkpoint persistence defects

**Files:**
- Modify: `src/checkpoints.ts`
- Modify: `tests/checkpoints.test.ts`
- Modify: `tests/recall.test.ts`

**What to build:** Add regression coverage for duplicate checkpoint ID collisions, synchronous registry visibility after save, and strict validation for legacy JSON checkpoints.

**Approach:** Keep filename collision handling under the existing lock. Ensure saved checkpoints cannot share an ID, make registry registration observable before `saveCheckpoint()` returns, and reject malformed legacy JSON checkpoints instead of surfacing garbage as live memories.

**Acceptance criteria:**
- [ ] Saving colliding checkpoints yields distinct IDs and search recall does not throw.
- [ ] A checkpoint saved to a workspace is visible to immediate cross-workspace recall.
- [ ] Legacy JSON checkpoints with missing IDs or invalid timestamps are rejected and skipped.

### Task 2: Recall summary correctness

**Files:**
- Modify: `src/recall.ts`
- Modify: `tests/recall.test.ts`

**What to build:** Make cross-workspace search summaries report only matching workspaces, with counts that reflect matched checkpoints rather than pre-search candidates.

**Approach:** Preserve the current search ranking flow, but build workspace summaries from ranked hits rather than from the full candidate set.

**Acceptance criteria:**
- [ ] Cross-workspace search omits workspaces with zero hits.
- [ ] `checkpointCount` reflects matched checkpoints for each workspace in search mode.

### Task 3: Brief input and parsing hardening

**Files:**
- Modify: `src/handlers/brief.ts`
- Modify: `tests/handlers.test.ts`

**What to build:** Coerce brief tag arrays from MCP string inputs so brief metadata is stored consistently.

**Approach:** Mirror the checkpoint handler's array coercion pattern for brief tags, including update flows that may receive serialized arrays.

**Acceptance criteria:**
- [ ] JSON-string `tags` inputs are stored as arrays.

### Task 4: Workspace write guards and legacy directory cleanup

**Files:**
- Modify: `src/handlers/checkpoint.ts`
- Modify: `src/handlers/brief.ts`
- Modify: `src/server.ts`
- Modify: `src/workspace.ts`
- Modify: `tests/handlers.test.ts`
- Modify: `tests/workspace.test.ts`

**What to build:** Reject `workspace: "all"` for write-oriented tools and stop creating the dead `.memories/plans/` directory during normal setup.

**Approach:** Enforce the guard in the handlers so direct calls and server-routed calls both fail safely. Keep legacy read helpers in place, but remove eager creation of the legacy directory from `ensureMemoriesDir()`.

**Acceptance criteria:**
- [ ] `brief` and `checkpoint` reject `workspace: "all"` with a clear error.
- [ ] `ensureMemoriesDir()` creates `.memories/` and `.memories/briefs/`, but not `.memories/plans/`.
- [ ] Legacy plan reads remain intact.

### Task 5: Verification

**Files:**
- Test: `tests/checkpoints.test.ts`
- Test: `tests/recall.test.ts`
- Test: `tests/briefs.test.ts`
- Test: `tests/handlers.test.ts`
- Test: `tests/workspace.test.ts`

**What to build:** Prove the regressions are covered and that the rest of the suite still passes.

**Approach:** Run the focused test files first, then the full test suite and typecheck.

**Acceptance criteria:**
- [ ] Focused regression tests fail before implementation and pass after.
- [ ] `bun test` passes.
- [ ] `bun run typecheck` passes.
