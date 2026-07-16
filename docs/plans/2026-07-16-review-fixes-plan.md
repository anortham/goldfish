# 2026-07-16 Review Fixes Plan

Source: full project review (behavioral language, brief staleness, harness support vs ponytail, perf/token waste). Findings verified against source; perf numbers measured on synthetic corpora driving real code (100/1,000 checkpoints; 20 workspaces).

## Track 1 — Correctness + doc fixes

1. **Cross-workspace recall limit bug.** `recall({workspace:'all'})` without date params silently caps every workspace at 5 checkpoints and under-reports `checkpointCount`. `delete unlimitedOptions.limit` (`src/recall.ts:628`) makes `loadWorkspaceCheckpoints` (`src/recall.ts:411-413`) fall back to the default of 5. Every existing cross-workspace test passes `days: 1`, dodging the branch. Fix with a failing no-date-params test (>5 checkpoints) first.
2. **Skill tool-namespace bug.** All 6 skills declare `allowed-tools: mcp__goldfish__*` and use that prefix in examples, but plugin installs namespace tools `mcp__plugin_goldfish_goldfish__*`. Drop hardcoded namespaces; refer to tools by short name. Resync `.agents/skills`.
3. **Checkpoint skill contradicts checkpoint-before-commit.** `skills/checkpoint/SKILL.md` lists "Committed or pushed work" as a checkpoint moment; server instructions mandate before-commit. Align the skill.
4. **Stale PreCompact hook claim.** Hooks were removed in v7.0; the checkpoint skill still cites one.
5. **Threshold doc sync.** Code: stale suppression at >7d inactivity (`STALE_BRIEF_DAYS`), refresh nudge at ≥14d without update (`BRIEF_REFRESH_DAYS`). CLAUDE.md and the recall skill describe only "14+ days". Document both thresholds accurately.

## Track 2 — Brief behavioral adoption

Root cause of stale briefs: every nudge fires at recall (session start); nothing fires at the moments that matter (checkpoint save, work landing). Checkpoint affinity counts as brief activity, masking content staleness while work continues. Briefs historically get completed only when replaced.

1. **Checkpoint response: commit reminder.** Show the saved checkpoint file path with "include it in your commit" — reinforces checkpoint-before-commit at the moment of staging.
2. **Checkpoint response: brief-freshness nudge.** When the active brief's `updated` is 7+ days old, append a one-line nudge ("still the direction? update or complete it").
3. **Instructions: lifecycle triggers.** The Briefs section is save-only; add update/complete triggers (work landed, direction changed). Stay under the 2k cap by trimming the "checkpoint when" list duplicated verbatim in the checkpoint tool description.
4. **Informed stale notice.** The stale-brief notice withholds the brief body; include a short content snippet so complete-vs-update is decidable without another call.

## Track 3 — Performance + token waste

Measured baselines: save 43ms (git 40.5ms of it, 5 serial spawnSync — blocks event loop); search 247ms @1k checkpoints vs 50ms target (read+parse 122ms, Orama build 134ms, query 0.8ms); `recall({limit:0})` scans date dirs for brief activity (63x slower with a stale unreferenced brief); `recall({limit:20, full:true})` ≈ 13k tokens uncapped; compact search digest repeats ~27% of its 220-char budget.

1. **Async git context.** `Bun.spawn` + `Promise.all` in `getGitContext` (`src/git.ts:36-76`).
2. **Brief-activity fast path.** Kill the unbounded scan in `resolveActiveBrief`; staleness only needs a bounded window.
3. **In-memory search cache.** Corpus + Orama index cache keyed by a cheap directory fingerprint; markdown stays the source of truth (no derived files on disk). The 0.8ms-vs-247ms measurement is the evidence the "no cache" stance was waiting for.
4. **`full:true` output cap** with explicit truncation note.
5. **Digest dedup.** Prefix-aware `uniqueParts` in `buildCompactSearchDescription` (`src/digests.ts:119-130`).
6. **Parallel reads.** `Promise.all` file loops (`src/checkpoints.ts:501-525,561-566,685-688`), registry stats (`src/registry.ts:200-215`).
7. **Registry lock only when writing.** `registerProject` takes the global exclusive lock on every save; read first, lock only when the entry is missing.
8. **Trim default recall output.** Truncate unbounded `next` in default mode.

## Track 4 — Harness support tier-1

Strategy: port ponytail's discipline (generators, drift guards), not its 22-harness breadth — Goldfish ships a stateful MCP server, not prose.

1. **AGENTS.md split.** Stop mirroring CLAUDE.md (contributor guide) into AGENTS.md; generate AGENTS.md as a usage ruleset from `src/instructions.ts` + tool reference. Unlocks the zero-setup instruction tier (Zed, Amp, Jules, etc.).
2. **Tag-equality version check.** Mutual-agreement version tests pass when all surfaces are stale together; assert version == git tag at release (ponytail shipped this exact bug in its v4.8.0).
3. **Mirror freshness test.** `.agents/skills` sync is unguarded; add a test that re-runs the sync in-memory and fails on diff.
4. **Commit client config files** the README currently dictates as prose (`opencode.json`, `.vscode/mcp.json` example).
5. **`docs/agent-portability.md`.** Support matrix including deliberate non-support decisions.

## Definition of done

Each item: test first where behavior changes, targeted test group green, full `bun test` green per track, checkpoint before each commit, docs updated where behavior moved. No version bump (release is a separate, user-approved step).
