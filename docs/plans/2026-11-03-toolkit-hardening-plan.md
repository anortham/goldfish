# Goldfish toolkit hardening implementation plan

> **For agentic workers:** Use `razorback:subagent-driven-development` for independent owned tasks when delegation is available; otherwise use `razorback:executing-plans`.

**Status:** Goldfish implementation complete and locally verified. User approval: 2026-11-04 UTC, "we can start on goldfish here". Worktree `.worktrees/toolkit-hardening`, branch `feat/toolkit-hardening`, base `9504fa8`; tested implementation commit `d93420d`. Cross-repository acceptance remains owned by Razorback.

**Goal:** Prevent accidental outside-workspace checkpoint imports and make Goldfish's storage and integration contracts accurate without expanding the memory engine.

**Architecture:** Retain three MCP tools, markdown storage, existing checkpoint fields, and explicit workspace binding. Add containment validation at the existing file-description boundary. Razorback, not Goldfish, owns converting its reports into retrievable handoffs.

**Tech Stack:** Bun, TypeScript, Node-compatible filesystem/path APIs, existing MCP SDK and Bun test runner.

**Spec:** [Design contract](#evidence-and-design-contract) below; coordinated context is [AI toolkit plan](2026-11-03-ai-toolkit-coordination-plan.md).

**Architecture Quality:** Small boundary tightening, no new service, index, parameter, or storage format. Risks are Windows/path semantics and rejecting a previously accepted external-file input; acceptance of this plan explicitly approves that contract change.

**Reviewed baseline:** `/home/murphy/source/goldfish`, `main`, `e1e95c44a57e819a95535f231476e5fd3f02515e`, version 8.0.9. Verify live state before implementation; this path is not a runtime default.

## Evidence and design contract

- `src/handlers/checkpoint.ts:readDescriptionFile` resolves absolute paths as-is and joins relative paths without checking containment. An isolated probe copied an outside file into the chosen project's checkpoint.
- [The original design](2026-08-18-checkpoint-description-file-design.md) deliberately accepted absolute paths as-is. This plan proposes narrower behavior, not a claim that the old implementation broke its original design or created new OS privileges.
- **New proposed contract:** resolve the workspace and target to canonical filesystem paths, then require the target to be inside that workspace. Preserve relative inputs, absolute in-root inputs, in-root symlinks, symlinked workspace roots, spaces, and existing backslash normalization for relative inputs. Reject external absolute paths, escaping traversal, prefix-collision siblings, and symlinks whose resolved targets lie outside.
- Keep the existing `description` versus `description_file` exclusivity, trimming, empty/missing-file errors, and source-file retention. Reject before checkpoint persistence. Do not claim this creates a sandbox against a hostile process concurrently replacing filesystem objects.
- No `allow_external` flag is added. For an intended external writeup, the agent/user explicitly copies the desired material into a draft under the workspace, then calls the existing tool. Do not automatically copy it on rejection.
- Goldfish recall searches its supported checkpoint layout and active briefs, not every markdown file in `.memories/`. Root-level Razorback reports remain ordinary files. A normal checkpoint containing the report pointer and `next` makes the handoff retrievable.
- Cross-worktree duplication is an acknowledged current tradeoff. This plan documents its consequences and mitigation; it does not change result identity, ranking, limits, or registry semantics.

## Global constraints

- TDD is mandatory for production changes: observe each meaningful regression fail before implementing the fix.
- Use atomic storage and UTC; preserve locks, explicit workspace binding, the in-memory cache model, and project-local source-of-truth files.
- All tests use temporary workspaces and isolated `GOLDFISH_HOME`; never touch real memory/registry or use a real sensitive file in a test.
- Keep server instructions and individual tool descriptions within 2,000 characters; hook payload within 10,000 characters.
- Edit canonical `skills/` and regenerate `.agents/skills/`, usage docs, and eval schemas with `bun run sync:agent-skills`. Never hand-edit generated counterparts.
- No new hooks, generalized report ingestion, database, semantic search, deduplication engine, or automatic installation changes.
- Do not remove repo-local skill mirrors to fix this workstation's duplicate installation; they are required for other clients. Razorback's diagnostic handles detection, and actual uninstall needs separate authority.
- No version bump or release is part of this implementation plan. Record the behavior change in an unreleased changelog entry following the current file convention; release uses the existing seven-surface process later.
- Implementation and local commits are authorized by the user's go-ahead. Pushes and releases are not authorized. Default external reviewer is `none`.

## Verification strategy

**Project source of truth:** `AGENTS.md`/`CLAUDE.md`, `package.json`, `.github/workflows/ci.yml`, `bunfig.toml`, `tests/preload.ts`.

**Worker red/green scope:** `bun test tests/handlers.test.ts -t description_file` for G1; existing asset guards for G2. Add descriptive names containing `description_file` so the filter covers new boundary cases.

**Worker ceiling:** Owned test files and asset guards; do not run the full suite per edit.

**Worker gate invariant:** G1 must prove containment and continued success of legitimate file imports, not just an error string. G2 must prove generated mirrors remain consistent and docs match current behavior.

**Lead affected-change scope:** `bun test handlers server agent-assets hooks` after the coherent G1/G2 batch. Verify that new rejection paths have no saved checkpoint and retain the source draft.

**Branch gate:** `bun run typecheck` and `bun test` once after final code integration. Compare final `getTools()`/hook caps using existing tests. Run `check_edit` for the diff and investigate callers/coverage warnings.

**Security scope:** `none declared` for additional scanners. The path-containment regression cases are required security-behavior checks; preserve any newly discovered project scanner requirements.

**Replay/metric evidence:** Outside-root rejection and inside-root success are hard gates. Worktree duplicate-result counts are a documented observation, not a new failing gate or a justification to weaken ranking tests.

**Escalation triggers:** A changed workspace resolver, stored checkpoint shape, tool schema parameter, or search identity exceeds this slice; document the mismatch before expanding it. Use native Windows verification for filesystem behavior when available; disclose if Windows-specific symlink checks cannot run, without claiming parity.

**Assigned verification failure:** Diagnose and repair within owned scope while safe; report a blocker only when no plan-consistent recovery remains. Keep failing scope narrow during repair.

**Verification ledger:** Record command, scope, UTC time, source revision/diff identity, result, platform, skips, and artifact path in the execution handoff. The earlier 695-pass review and typecheck are baseline evidence only.

## Parallel execution contract

Commit mode: `parallel-lead-commit` for G1 and G2; lead stages exact owned files after review. The lead alone updates this plan's progress and any Goldfish checkpoint.

| Task | Parallel batch | File ownership | Serialization required | Dependency reason |
|---|---|---|---|---|
| G1: Bound description imports | A | `src/handlers/checkpoint.ts`, `src/tools.ts`, `tests/handlers.test.ts`, `skills/checkpoint/SKILL.md`, generated `.agents/skills/checkpoint/SKILL.md`, `evals/mocks/goldfish/_tools.json`, `docs/agent-instructions/goldfish-usage.md`, `CHANGELOG.md` | No | None - safe parallel batch; G1 alone runs the generator. |
| G2: Correct storage/integration docs | A | `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `README.md` | No | None - safe parallel batch; consumes the fixed proposed contract above. |
| G3: Final local gate and cross-repo handoff | None - serial | This plan's progress/evidence and one warranted `.memories/<UTC-date>/<generated-checkpoint>.md` | Yes | Requires G1/G2 reviewed diffs; Razorback owns the combined harness. |

### G1: Bound description imports to the selected workspace

**Files:** Modify `src/handlers/checkpoint.ts`, `src/tools.ts`, `skills/checkpoint/SKILL.md`, `CHANGELOG.md`; test `tests/handlers.test.ts`; regenerate `.agents/skills/checkpoint/SKILL.md`, `evals/mocks/goldfish/_tools.json`, and `docs/agent-instructions/goldfish-usage.md` if their canonical inputs changed.

**Interfaces:** Consumes `CheckpointArgs.description_file`, `handleCheckpoint`, and the resolved workspace supplied to `readDescriptionFile`. Produces the same checkpoint API and response shape with rejected outside-root imports.

**Contract inputs:** Design contract above; existing file-import tests in `tests/handlers.test.ts`; original description-file design is historical context, superseded only on the external-path rule if this plan is approved.

**File ownership:** `src/handlers/checkpoint.ts`, `src/tools.ts`, `tests/handlers.test.ts`, `skills/checkpoint/SKILL.md`, generated `.agents/skills/checkpoint/SKILL.md`, `evals/mocks/goldfish/_tools.json`, `docs/agent-instructions/goldfish-usage.md`, `CHANGELOG.md`.

**Serialization required:** No.

**Dependency reason:** None - safe parallel batch; G1 alone runs the generator.

**What to build:** Validate the resolved source before reading/storing the description, and explain the boundary in the tool and checkpoint skill. Preserve useful absolute paths and current draft workflow rather than banning all absolute inputs.

**Approach:** Read current path helpers and filesystem conventions first with code-kb context and native source. Keep a small local implementation unless a genuinely reusable containment helper already exists. Use path-aware ancestry checks rather than a string-prefix test. Follow repository error style; diagnostics should identify the boundary without quoting file contents. Re-read generated output and stage only intentional changes.

**Acceptance criteria:**
- [x] Failing tests first demonstrate that external absolute paths and `..` traversal cannot create a checkpoint.
- [x] A sibling root sharing the workspace's name prefix cannot pass the containment check.
- [x] External symlink targets are rejected; a symlink to an in-root file and a symlinked workspace root remain usable where supported.
- [x] Relative, absolute in-root, spaced, and normalized relative backslash paths retain their expected behavior.
- [x] Missing/unreadable/empty sources and mutually exclusive description arguments retain meaningful errors; successful saves leave the source file unchanged.
- [x] Rejection creates no checkpoint and does not disclose outside content in errors. Tests use fake marker content only.
- [x] Tool/skill wording states the boundary and the deliberate copy-to-workspace migration; schemas, generated mirrors, and description caps remain valid.
- [x] Focused verification passes and the verified diff is handed to the lead under `parallel-lead-commit`.

### G2: Make storage and integration documentation accurate

**Files:** Modify `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `README.md`.

**Interfaces:** Consumes existing storage/discovery behavior and the handoff contract. Produces accurate human/agent instructions, no runtime API change.

**Contract inputs:** Seven canonical skill directories; `scripts/sync-agent-skills.ts`; `getAllCheckpointsInternal`; `docs/IMPLEMENTATION.md`'s existing intentional no-deduplication decision.

**File ownership:** `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `README.md`.

**Serialization required:** No.

**Dependency reason:** None - safe parallel batch; consumes the fixed proposed contract above.

**What to build:** Correct stale skill inventory and cache descriptions. Explain how another tool links a report to a normal checkpoint, and explain why cross-project recall may repeat shared worktree history.

**Approach:** Prefer describing the canonical inventory over repeating an easily stale count. Distinguish no derived disk state from fingerprint-validated in-memory caches. Put a short report-pointer example in the relevant integration/storage section using real existing checkpoint fields and explicit workspace. Explain workspace-specific recall as the mitigation when duplicates crowd cross-project results.

**Acceptance criteria:**
- [x] Active portability descriptions match the canonical skill inventory; remove stale six-skill assertions, including drift-guard descriptions.
- [x] The storage spec consistently permits validated in-memory caches and prohibits derived disk persistence.
- [x] Docs explicitly distinguish dated searchable checkpoints from ordinary root-level `.memories/` reports and show the checkpoint-pointer handoff.
- [x] Docs disclose copied worktree checkpoint duplication and its limit cost, while preserving existing search identity/ranking and the recorded no-deduplication choice.
- [x] Record a narrowly scoped future reconsideration trigger: repeated real standups losing unique project history to duplicate slots. No deduplication implementation is included.
- [x] Source/link review and `bun test agent-assets` pass; any optional recheck of duplicate behavior uses isolated temporary projects/homes. Hand the reviewed docs to the lead under `parallel-lead-commit`.

### G3: Verify and hand the supported contract to Razorback

**Files:** Update this plan's progress/evidence and save one warranted handoff checkpoint using Goldfish; no additional production files are owned by this task.

**Interfaces:** Produces the verified Goldfish commit/root and normal checkpoint/recall behavior for Razorback's opt-in combined harness.

**Contract inputs:** G1/G2 outputs; coordinator's explicit-root and report-pointer contracts. Razorback and code-kb need not be installed for Goldfish's local branch gate.

**File ownership:** This plan's progress/evidence and one warranted `.memories/<UTC-date>/<generated-checkpoint>.md`.

**Serialization required:** Yes.

**Dependency reason:** Requires G1/G2 reviewed diffs; Razorback owns the combined harness.

**What to build:** A truthful handoff with fresh verification, exact source state, and remaining combined-test responsibility. Do not claim toolkit completion from Goldfish-only tests.

**Approach:** Review the complete diff, run the declared gate, record any platform-specific limits, and checkpoint before the implementation commit so the context travels with it. Follow the current repository's worktree inventory and commit rules.

**Acceptance criteria:**
- [x] Full local branch gate and `check_edit` are accounted for, including skipped platform checks.
- [x] No runtime code in Razorback/code-kb and no global client registrations were changed by this repository's workers.
- [x] The handoff names the Goldfish revision, tool schema source, report-pointer contract, and Razorback-owned combined acceptance dependency.
- [x] Current path, branch, HEAD, dirty state, and related worktrees are reconciled; local implementation and required memory artifacts are committed together. No push or release occurs without separate authorization.

## Starting a separate implementation session

Read this plan and current project instructions, verify source drift and all existing worktrees, and obtain the user's implementation go-ahead. Use the chosen task worktree's absolute path for both tool families. G1 and G2 can run in parallel; execute G3 afterward. Leave Razorback's report generation, installation diagnostics, and combined harness to its own plan.

## Execution evidence

- User approved implementation: "we can start on goldfish here"; active branch `feat/toolkit-hardening`, worktree `.worktrees/toolkit-hardening`, base `9504fa8`.
- G1 lead review: canonical path ancestry check stays in `readDescriptionFile`; no schema/signature/storage change. Before implementation, four new escape cases failed; afterward all 14 file-import cases passed. Directory-link fixtures use NTFS junctions on Windows.
- G2 lead review: cache/storage/skill inventory docs and report-pointer examples match existing APIs. Kept one verified central README skill count to satisfy the existing dynamic inventory guard; no guard was weakened.
- Adjacent eval setup repair: current Claude plugin evaluator rejected grouping/alternation in recall mock workspace guards before model exposure. Current-project mocks now require an absolute path; cross-project mocks require exact `all`. This narrows each fixture to its scenario rather than accepting arbitrary strings. Six mock files changed; all graders retained.
- Linux gate: `bun run typecheck` passed; final `bun test` passed 702 tests with one expected platform skip and 2,012 expectations. An earlier full run found the README count omission; its single failing test passed after correction, then the full suite passed.
- Checkpoint eval: Haiku, one run per case, mocks enabled, no publishing. All checkpoint calls/quality/skip behavior passed; decision and unfinished-work cases each scored 0.75 because the agent used MCP directly without a Skill call. Routine-commit case scored 1.0. The old skill at `9504fa8` with only the same mock-parser repair reproduced decision score 0.75 for the same reason. No adoption policy or grader was changed to conceal that limitation.
- Native Windows/NTFS at exact source `d93420d3e93d414be051550eacb151ba4bdec38e`: `win-test sync /home/murphy/source/goldfish/.worktrees/toolkit-hardening` succeeded after one boot-time SSH reset; the guest lacked Bun, so used isolated `npm exec --yes --package=bun@1.4.0 -- bun` to match Linux. Frozen dependency install succeeded. `bun test tests/handlers.test.ts -t description_file` passed all 14 tests, no skips, including outside and inside directory junctions and aliased workspace root. Native log: `/home/murphy/.local/share/win-test/logs/20261104T010916Z-toolkit-hardening-2424606.log`. Guest shut off after completion; `win-test status` confirmed shutdown.
- Raw worker/gate/eval logs are in the ignored `.razorback/sdd/2026-11-03-toolkit-hardening-plan-31cacc3bed0c/` workspace on this host. Verification above identifies the tested source so another session need not rely on those local logs alone.
- Razorback integration input: repository/worktree `/home/murphy/source/goldfish/.worktrees/toolkit-hardening`, branch `feat/toolkit-hardening`, tested source `d93420d`; launch from its `.claude-plugin/plugin.json`/`.mcp.json` and discover the current schema (`src/tools.ts`). Pass the integration fixture root as `workspace` and isolate `GOLDFISH_HOME`. The final handoff commit changes only this plan and dated checkpoint metadata.
- All G1/G2 files were reviewed and committed in `d93420d`; final G3 plan/checkpoint metadata commits preserve that source. No Goldfish runtime files in other repos or global client registrations were changed. No push, merge, release, or publication occurred. Retain this worktree for cross-repository integration; prior clean worktrees and main remain separate.
