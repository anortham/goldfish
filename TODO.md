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

## What's Next

### From Real Usage
- [ ] Tune hook prompts based on actual agent behavior
- [ ] Tune skill language based on session observations
- [ ] Evaluate checkpoint frequency in practice (too many? too few?)

### Potential Future Features (Evidence Required)
- [ ] Checkpoint pruning/archival (if .memories/ grows too large)
- [ ] Plan templates (if pattern emerges from usage)
- [ ] Checkpoint export/reporting (if standups aren't enough)
- [ ] Migration tool for v4 → v5 checkpoint format

### Open Questions
- Is the PreCompact hook reliable enough? Does Claude actually checkpoint before compaction?
- Does the SessionStart hook fire consistently? Any startup delay issues?
- Is the ExitPlanMode → plan save hook working as expected?
- Should skills be more or less prescriptive?
- [x] ~~JSON output from the tools makes no sense. We are burning extra tokens. We need readable output.~~ (Fixed in v5.0.4)
