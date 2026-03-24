# Goldfish — Status

## Done (Revival Complete)

- [x] Phase 1: Strip dead code (embeddings, distillation, store tool)
- [x] Phase 2: New checkpoint format (YAML frontmatter, individual files, .memories/)
- [x] Phase 3: Cross-project registry (~/.goldfish/registry.json)
- [x] Phase 4: Claude Code plugin structure (skills, hooks, .mcp.json)
- [x] Phase 5: Documentation update

## v5.0.7 — Code Review Fixes (2026-02-16)

### Code Fixes (MAJOR)

- [x] Cross-workspace `limit: 0` fetches 99999 per project then discards — short-circuit early (`recall.ts:235-241`)
- [x] Negative `limit` accidentally returns everything — clamp to 0 or reject (`recall.ts:280-284`)
- [x] Stale `getDateRange` docstring says "default: 2" for days — no default anymore (`recall.ts:87`)

### Code Fixes (MINOR)

- [x] Redundant `as any` cast — type already includes `workspace` (`handlers/recall.ts:35-37`)
- [x] `full: true` doesn't render git metadata in markdown output (`handlers/recall.ts`)
- [x] Timestamp formatting regex won't match without milliseconds — use `(\.\d+)?` (`handlers/recall.ts:28`)
- [x] `normalizeWorkspace` docstring shows wrong output `my-project-` should be `my-project` (`workspace.ts:18`)

### Documentation Propagation

- [x] README line 149: `recall()` comment says "Last 2 days, 10 checkpoints" — should be "Last 5 checkpoints, no date window"
- [x] README line 420: troubleshooting says "Default recall looks back 2 days" — stale
- [x] README lines 275-286: standup example uses old format, doesn't match updated skill
- [x] README lines 346, 363: test count says 231, actual is 253
- [x] `skills/recall/SKILL.md:95`: says `Default limit: 10` — actual default is 5
- [x] CLAUDE.md: `RecallOptions` missing `limit` field in type definition
- [x] CLAUDE.md line 199: test count says 231
- [x] CONTRIBUTING.md: `RecallOptions` missing `limit`, `since` description is stale
- [x] `docs/IMPLEMENTATION.md:106-118`: registry format shows old key-value map, should be array
- [x] `docs/IMPLEMENTATION.md:261`: test count says 223
- [x] `docs/IMPLEMENTATION.md`: no mention of last-N recall mode

### Nits (Low Priority)

- [x] Plan frontmatter regex requires double newline, checkpoint parser only requires single (`plans.ts:42`)
- [x] `deletePlan` reads `.active-plan` outside the lock — TOCTOU race, theoretical (`plans.ts:265-282`)
- [x] `activePlan?: Plan` type but `getActivePlan` can return `null` (`types.ts:62`)
- [x] `normalizeTimestamp` returns garbage for `null`/`undefined` input (`checkpoints.ts:86-92`)
- [x] Lock timeout test is a no-op placeholder (`lock.test.ts:121-127`)
- [x] No BOM handling in frontmatter parser — Windows edge case (`checkpoints.ts:117`)

## v5.1.0 — Skills Refresh + Workspace Resolution (2026-02-16)

- [x] `GOLDFISH_WORKSPACE` env var for VS Code / GitHub Copilot workspace resolution
- [x] `resolveWorkspace()` centralized resolver replacing 7 `process.cwd()` fallbacks
- [x] New `/plan` skill — behavioral guide for plan tool lifecycle
- [x] Updated `/standup` skill — dual-source plan awareness (`.memories/plans/` + `docs/plans/`)
- [x] Updated `/plan-status` skill — dual-source plan awareness with source attribution
- [x] VS Code `.vscode/mcp.json` setup documented in README

## v5.10.0 — Active Plan Bug Fix (2026-03-22)

- [x] `getActivePlan()` returns `null` when referenced plan has `status: completed` or `status: archived`
- [x] `updatePlan()` auto-checks all `- [ ]` boxes when transitioning a plan to `status: completed`
- [x] Fix `SERVER_VERSION` drift (was `5.9.0` while package.json/plugin.json were `5.9.1`)

---

## v6.0.0 -- Memory Consolidation (2026-03-23)

- [x] MEMORY.md semantic layer (`.memories/MEMORY.md` + `.last-consolidated`)
- [x] `consolidate()` MCP tool with subagent prompt template
- [x] First-consolidation bootstrap (cap at 50 checkpoints)
- [x] Recall evolution: three-part response (memory + delta + consolidation flag)
- [x] `includeMemory` parameter with smart defaults (true for bootstrap, false for search)
- [x] MEMORY.md sections in semantic search index (chunked by `##` headers)
- [x] Cross-project recall returns `memorySummary` per project
- [x] PreCompact and SessionStart hooks converted to Bun scripts with state inspection
- [x] Source control instruction for `.memories/` in server-level plugin instructions
- [x] `/consolidate` skill

---

## What's Next

### Consolidation Tuning (Needs Real Usage Data)
- [ ] Tune consolidation subagent prompt based on real output quality
- [ ] Evaluate 500-line cap (too small? too large? depends on project?)
- [ ] Monitor semantic search quality with MEMORY.md sections in the index
- [ ] Evaluate consolidation frequency (too aggressive? too lazy?)

### From Real Usage
- [ ] Tune hook prompts based on actual agent behavior
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)

### Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (consolidation reduces urgency since MEMORY.md captures the essence)
- [ ] Plan templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting (MEMORY.md summaries in cross-project recall may solve this)
- [ ] Tiered temporal rollups: daily -> weekly -> monthly summaries (if single MEMORY.md proves insufficient for long-lived projects)

### Open Questions
- Is the PreCompact hook reliable enough? Does Claude actually checkpoint before compaction?
- Does the SessionStart hook fire consistently? Any startup delay issues?
- Is the ExitPlanMode -> plan save hook working as expected?
- Should skills be more or less prescriptive?

---

## v6.2.2 -- Audit Fixes (2026-03-24)

### Fixed
- [x] **Plan handler: `planId` vs `id` parameter mismatch** - LLMs (Copilot) send `planId`, handler expected `id`. Hard failure ("Plan ID is required"). Added alias support, active plan fallback for get/update/complete, and top-level update properties.
- [x] **PostToolUse hook missing `activate: true`** - ExitPlanMode hook didn't tell agents to activate plans. Plans could be saved but invisible to recall.
- [x] **Instructions: misleading consolidation parameters** - Referenced non-existent `currentMemory` and `unconsolidatedCheckpoints` parameters. Fixed to describe the actual `prompt` field workflow.
- [x] **Plan tool description: undocumented behaviors** - Updated action descriptions to document active plan fallback and top-level update properties.

### Deep Review Findings (2026-03-24)

Findings from 5-agent review team, fixed by 4-agent fix team. 467 tests, 0 failures (40 new tests added).

#### Bugs (all fixed)

- [x] **`lock.ts` - Infinite loop on undeletable stale locks.** `attempts` now increments unconditionally.
- [x] **`semantic.ts` - `Math.min(...spread)` RangeError.** Replaced with reduce loop.
- [x] **`plans.ts` - TOCTOU race in `savePlan`.** Wrapped in `withLock`.
- [x] **`plans.ts` - No plan ID sanitization (path traversal).** Added `validatePlanId()` rejecting `/`, `\`, `..`, `\0`.

#### Performance (all fixed)

- [x] **`recall.ts` - `recallFromWorkspace` loads ALL checkpoints unconditionally.** Deferred stale count to lazy heuristic.
- [x] **`recall.ts` - `limit: 0` single-workspace doesn't short-circuit.** Added early return.
- [x] **`semantic.ts` - Embeddings computed one-at-a-time.** Batched up to 8 items per embed call.
- [x] **`recall.ts` - Cross-workspace non-search path wastes work.** Uses lightweight checkpoint load.
- [x] **`consolidate` handler - Pretty-printed JSON wastes tokens.** Switched to compact JSON.

#### Quality / Correctness (all fixed)

- [x] **`handlers/plan.ts` - Em dash in `formatPlanList`.** Replaced with ` - `.
- [x] **`types.ts` - `PlanAction` dead type.** Deleted.
- [x] **`handlers/consolidate.ts` - 30-day age limit silently drops old checkpoints.** Added `skippedOldCount` to response.
- [x] **`tools.ts` - `all` parameter description misleading.** Updated to "Raise batch cap from 50 to 100."
- [x] **`memory.ts` - `readConsolidationState` swallows all errors.** Now catches only ENOENT and parse errors.
- [x] **`summary.ts` - Summaries preserve markdown `##` prefix.** Strips leading `#` chars.
- [x] **`checkpoints.ts` - Unsafe type assertion on `tags`.** Added `Array.isArray()` guard.
- [x] **`git.ts` - Git context from cwd, not workspace path.** Added optional `cwd` parameter.
- [x] **`recall.ts` - Synthetic memory section timestamp skews ranking.** Falls back to oldest checkpoint timestamp.

#### Platform (all fixed)

- [x] **`registry.ts` - `unregisterProject` missing `mkdir`.** Added.
- [x] **`registry.ts` - Mixed path separators on Windows.** Uses template literal.

#### Plugin / Skills / Docs (all fixed)

- [x] **Recall skill consolidation instructions.** Replaced with pointer to `/consolidate` skill.
- [x] **Plan skill missing `planId` alias docs.** Added.
- [x] **Recall skill missing `includeMemory` docs.** Added.
- [x] **Stale `.mcp.json` reference in CLAUDE.md.** Removed.
- [x] **Duplicate stale-checkpoint counting logic in hooks.** Extracted to `hooks/count-stale.ts`.

#### Test Gaps (all filled)

- [x] **`handleConsolidate` tests.** 4 new tests.
- [x] **Stale lock infinite loop test.** chmod-based test.
- [x] **`save` with `planId` alias test.** Added.
- [x] **Math.min/max with 200k checkpoints test.** Added.
- [x] **`normalizeEmbedding` typed array tests.** 8 new tests.
- [x] **`parseSince("0m")`/`parseSince("0d")` tests.** Added.
- [x] **`activate` with no ID and no active plan test.** Added.
- [x] **Concurrent `savePlan` same ID test.** Added (proves TOCTOU fix works).

#### Remaining (low priority, no evidence of impact)

- [ ] **Checkpoint handler: optional metadata aliases** - `next` vs `next_steps`, `symbols` vs `affected_symbols`. Silent data loss, no user reports.
- [ ] **All handler functions typed as `args: any`.** Zero compile-time checking. Judgment call.
- [x] **`checkpoints.ts` - Corrupted checkpoint files silently skipped.** Now logs warning via logger with file path and error message.
- [ ] **No tests for hook scripts.** Hooks have non-trivial logic but are standalone scripts. Low priority.
