# AI coding toolkit: coordinated implementation plan

**Status:** Proposed implementation handoff. The user requested these plans on 2026-11-03 and intends to switch models or execute each repository in a separate session. Writing and locally saving the plans is authorized; do not begin implementation until the user gives the implementation go-ahead.

**Goal:** Make Goldfish, Razorback, and code-kb work reliably together without adding another orchestration service or increasing routine agent ceremony.

**Architecture:** Goldfish remains the source-controlled memory store; code-kb remains the code-evidence engine; Razorback owns workflow policy and the combined acceptance harness. Integrate through existing tools and small explicit handoff records, not shared runtime state.

**Spec:** This document's Review findings and Shared design contract are the design proposal. Each repository plan repeats its binding local contracts so it can run without another checkout.

**Architecture Quality:** Preserve the three existing responsibility boundaries. The main risk is turning integration into a new framework or coupling ordinary tests to all three local installations. Keep diagnostics read-only and combined checks opt-in.

## Plan locations and reviewed baselines

| Repository | Reviewed source | Implementation plan | Scope |
|---|---|---|---|
| Goldfish | `e1e95c44a57e819a95535f231476e5fd3f02515e` / 8.0.9 | [Goldfish hardening](2026-11-03-toolkit-hardening-plan.md) | File-import containment, accurate docs, worktree recall tradeoff |
| Razorback | `e53a9ee4848df6519e91de7ff0a1b7fdc25ede8e` / 0.48.8 | `razorback/docs/plans/2026-11-03-toolkit-reliability-plan.md` | Policy consistency, searchable handoff, diagnostics, integration and agent scenarios |
| code-kb | `8640bcd8cf952c842ab9a7352a568987f4caab5b` / 2.12.0 | `code-kb/docs/plans/2026-11-03-toolkit-efficiency-plan.md` | Trace-led optimization, paired evaluation, coverage guidance |

On the reviewed workstation the repository roots are `/home/murphy/source/goldfish`, `/home/murphy/source/razorback`, and `/home/murphy/source/code-kb`. These are navigation hints, not runtime defaults. Substitute the actual absolute checkout or worktree root on another machine.

At planning time the retained Goldfish `codex/fail-closed-workspace-identity` and `mcp-sdk-v2-stateless-migration` worktrees and Razorback `codex/linear-hardening` worktree were clean, and each branch had no commits ahead of its repository's `main`. They are prior-task worktrees, not this implementation's selected worktrees. Leave them in place and recheck before choosing an implementation location.

## Review scorecard

These 1–10 review judgments establish the starting assessment, not executable gates. Nine means excellent, seven useful with material gaps, and five substantial improvement needed. Re-score from implementation evidence, not from completed checkboxes alone.

| Category | Goldfish | Razorback | code-kb | Combined |
|---|---:|---:|---:|---:|
| Core usefulness | 8 | 8 | 9 | 9 |
| Correctness and reliability | 8 | 7 | 8 | 7 |
| Agent usability | 8 | 7 | 8 | 7 |
| Token and workflow efficiency | 8 | 6 | 6 | 6 |
| Safety and recovery | 7 | 7 | 7 | 7 |
| Installation and portability | 8 | 7 | 8 | 6 |
| Testing and behavioral evidence | 8 | 6 | 8 | 6 |
| Maintainability | 8 | 7 | 6 | 7 |

Overall toolkit assessment: 7/10. No single weighted average is a release criterion.

## Review findings

| ID | Evidence and consequence | Owner and disposition |
|---|---|---|
| F1 | Razorback `skills/finishing-a-development-branch/SKILL.md` writes `.memories/autonomous-run-*.md` and permits a publication-approval stop without a checkpoint. Goldfish `src/checkpoints.ts:getAllCheckpointsInternal` scans date folders only. A temporary-project search could find a dated checkpoint but not the root report. | Razorback: save a checkpoint pointer before an unfinished-work stop; do not broaden Goldfish into an arbitrary-document index. |
| F2 | Razorback worktree setup declares a failed baseline a blocker immediately; its blocker taxonomy requires safe recovery first. Quick-fix manual verification and the TDD skill also prescribe different exceptions. | Razorback: unify the rules, test decision cases, preserve stricter project instructions. |
| F3 | Goldfish `readDescriptionFile` accepts external absolute paths and escaping relative paths. A temporary-project probe copied an outside file into a checkpoint. The original 2026-08-18 design explicitly accepted absolute paths as-is. | Goldfish: proposed deliberate contract tightening, not a claim of privilege escalation. Require resolved containment; document migration to an in-workspace draft. |
| F4 | The session exposed 32 Razorback and 7 Goldfish skills twice through local and plugin installations. The duplicate skill bodies matched during review. | Razorback diagnostic: report duplicate locations and differing versions/content, then prepare exact registration/symlink cleanup for user approval. Actual global installation cleanup remains a separately authorized action. |
| F5 | code-kb's paired study accepted 12/12 patches versus 10/12 native, but used 8,506,310 versus 3,883,381 total input tokens and averaged 66.67 seconds longer across 11 timed pairs. Both native failures came from one C# case. | code-kb: optimize from traces and measure whole tasks; do not infer general accuracy gains from this small sample. |
| F6 | The later one-call study reduced calls from 247 to 134 and retained 12/12 accepted patches, but total input rose to 8,566,530. Uncached input and elapsed time improved. It ran no fresh native arm; the 0.7% total-token miss is smaller than repeat variation. | code-kb: preserve both benefits and limitations, then run a fresh comparison using untouched confirmation tasks. |
| F7 | Individual guard suites do not establish correct three-tool behavior across a context loss, worktree change, missing tool, or approval pause. Razorback's workflow evaluator explicitly distinguishes deterministic fixtures from actual agent decisions. | Razorback: separate real-tool smoke checks from fresh-agent behavior evaluation. |
| F8 | Goldfish can return the same committed checkpoint from two registered worktrees, using up the global result limit. `docs/IMPLEMENTATION.md` deliberately leaves deduplication to the agent. | Goldfish: document measured impact and mitigation; do not silently change identity/ranking policy. |
| F9 | Goldfish portability docs have stale six-skill references; one implementation-spec line contradicts the documented in-memory caches. code-kb already documents language/framework coverage limits and advisory Stop hooks. | Goldfish: correct docs. code-kb: verify and keep limitations visible; do not treat deliberate behavior as a newly discovered runtime bug. |

Evidence: code-kb `evals/edit-2026-10-27/results/report.md`, `evals/edit-2026-10-31-one-call/report.md`; Razorback `docs/workflow-evaluation.md`; each repository plan contains its source pointers.

## Shared design contract

1. **Explicit root per tool call:** Goldfish uses `workspace`; code-kb uses `project_root`. Both receive the current absolute worktree path. Do not add aliases or rely on process cwd to bridge them.
2. **Handoff shape:** Before stopping with unfinished work, use the existing Goldfish checkpoint with structured WHAT/WHY/HOW/IMPACT, `next`, and evidence pointers. Include the report's workspace-relative path, task/plan identity, actual branch/worktree, tested source commit, and granted/missing publication authority. Use existing checkpoint fields; no new schema is needed. Metadata commits may follow the tested source commit: preserve that distinction.
3. **Recovery:** Recall yields the pointer; read the report and verify live git/authority state before acting. Never infer push permission from a checkpoint or implementation approval. If memory is unavailable, the report and git state remain the fallback and memory failure must not erase recovery information.
4. **Memory remains selective:** A pause awaiting approval is unfinished work. Routine edits and unchanged-state resumes still need no new checkpoint. Do not add recurring hooks or a background memory service.
5. **File imports:** Proposed Goldfish default is canonical workspace containment for `description_file`, including symlinks. Absolute paths inside that root remain supported. Deliberate outside material must first be copied to an in-workspace draft by the agent/user; no new external-import flag is included in this plan.
6. **Testing policy:** Recover safe, relevant baseline failures before classifying a blocker. TDD remains the default. A no-test-surface exception must explain why automation is unsuitable, capture an observable before/after check, and yield to stricter repository rules; it cannot mean simply that no test exists yet.
7. **Evidence versus enforcement:** Preserve code-kb coverage warnings, uncertain references, seven tools, explicit roots, and fail-open one-shot Stop behavior. `check_edit` is advisory evidence, not a substitute for tests or proof that a change is safe.
8. **Diagnostic scope:** Read-only, bounded inspection of explicitly selected projects/installations. Report capability/version/registration uncertainty honestly. Never print credentials, dump client configs, auto-download tools, or silently uninstall a duplicate.
9. **Efficiency:** Historical studies are immutable. Correct accepted edits and truthful coverage take priority over speed. Measure an optimization against current code-kb separately from a claim of savings against native tools; use fresh matched controls as specified in the code-kb plan. Do not call smaller responses or fewer calls a demonstrated reduction in whole-task cost.
10. **Optional dependencies:** Ordinary product tests remain independently runnable. The explicit combined acceptance command names all three inputs and fails clearly when a required input is absent; ordinary test suites can mark that external integration scope skipped, not passed.

Approval of implementation accepts these proposed choices. Until then they are design recommendations, not changes to current product contracts.

## Execution order and ownership

| Batch | Work | Coordination |
|---|---|---|
| A | Goldfish import hardening and docs; Razorback policy/handoff fixes; code-kb trace analysis and protocol | Safe across separate repositories. Each lead owns only its repository's files. |
| B | Razorback read-only diagnostic and isolated integration runner; code-kb selected optimization and local regressions | The diagnostic may be built before code-kb optimization. Integration fixtures consume the shared handoff contract. |
| C | code-kb paired confirmation; Razorback fresh-agent workflow scenarios | Avoid running model comparisons concurrently on a saturated host; record runtime/model versions and resource conditions. |
| D | Combined acceptance against final selected commits, final source-state reconciliation | Run after Goldfish and Razorback local gates and after code-kb selects either its verified candidate or the unchanged baseline with a documented negative result. |

Use one lead per repository and separate workers only for independent file ownership. Within a repository use `parallel-lead-commit` for simultaneous writers; the lead reviews and stages exact paths. Serial workers may commit their verified owned scope. Do not have two workers regenerate the same mirrors or edit the same policy file concurrently.

## Verification strategy

**Project source of truth:** Each repository's AGENTS/CLAUDE instructions and its implementation plan. These plans do not replace platform-specific checks.

**Worker scope:** Focused regression cases and nearby affected tests; TDD before production changes. Pure prose corrections use source/link checks and relevant existing asset guards rather than tests that merely freeze wording.

**Affected-change scope:** Each repository lead reviews spec compliance and quality, then runs the relevant test group after integration. Use code-kb `check_edit` after code edits and inspect uncertainty against native source.

**Branch gates:** Goldfish `bun run typecheck` and `bun test`; Razorback `npm test`; code-kb its documented Rust, formatting, Clippy, launcher, and affected Python checks. Full runs belong at the final local gate, not each small edit.

**Security scope:** No extra scanner commands declared by this coordination plan. Goldfish containment tests and Razorback diagnostic/redaction checks are required behavior tests. Preserve any stronger repository security gates.

**Combined gate:** Run Razorback's new opt-in integration command using exact selected Goldfish/Razorback/code-kb revisions, isolated temporary homes/projects, and no access to real memories. Then record fresh-agent decisions separately from deterministic subprocess checks.

**Ledger:** Record command, scope, revision or exact working-tree identity, UTC timestamp, exit status, skip reason, and artifact path. Older review results are evidence of the baseline only. Fix a failing assigned scope while a safe path remains; rerun only the failing scope during repair, then the final wider gate once.

**Review baseline evidence:** Goldfish 695 passing tests, one skipped, plus successful typechecking; Razorback 467 passing tests; code-kb 20 passing launcher tests. The code-kb Rust workspace run was interrupted and was not a full pass. These counts describe the 2026-11-03 review; do not copy them into permanent product claims.

## Definition of done

- [ ] A pre-publication approval pause can be recovered from Goldfish recall and its linked report in a fresh session, with no invented authority or lost next action.
- [ ] The same recoverable baseline or no-test-surface case gets consistent Razorback guidance across entry paths.
- [ ] Goldfish rejects outside-root file imports while preserving supported in-root forms and existing checkpoint behavior.
- [ ] A read-only diagnostic identifies the observed duplicate-install condition and distinguishes unknown runtime state from a confirmed working setup.
- [ ] Duplicate-install cleanup has an explicit disposition: selected registrations removed and a fresh-host inventory verified after authorization, or exact proposed changes recorded as awaiting that authority. A successful diagnostic alone is not described as a cleaned installation.
- [ ] Isolated real-tool checks cover workspace switching, handoff recovery, unavailable tools, duplicate installations, and unsupported structural coverage; fresh-agent scenarios test the decisions that subprocess tests cannot prove.
- [ ] code-kb has a measured outcome: either a correctness-preserving improvement that meets its predeclared criteria, or a recorded negative result with no unsupported savings claim and no ineffective change shipped.
- [ ] Current documentation describes cache behavior, skill inventory, recall layout, and coverage accurately; the worktree duplicate-result tradeoff has an explicit disposition.
- [ ] Every repository's verification evidence and final branch/worktree/dirty state are recorded. Required memories are committed with the work they describe.

## Handoff and authority

For a single coordinating session, read this document, then dispatch repository owners using the three plans. For independent sessions, open the target repository and read its local plan; it contains the local design contract and names dependencies on other repositories.

Before implementation, inspect current roots, branches, dirty state, worktree inventory, and drift from the reviewed commits. Reuse an appropriate existing task worktree or create an intentional one according to that repository's rules. Carry these plan commits into it; do not abandon uncommitted planning artifacts. Do not switch to an existing unrelated branch merely because it is available.

- Planning and local plan/handoff commits: authorized by the user's documentation request and project artifact rules.
- Implementation: deferred until the user switches model/session and gives the go-ahead.
- Local implementation commits: authorized once implementation scope is approved, subject to project instructions.
- Push, publish, release, destructive installation cleanup: not authorized by this request.
- External pre-merge reviewer: `none` unless the user selects one. Native subagents remain available for owned implementation tasks and inline review.
- Necessary code-kb evaluation spending follows its repository's existing authority after implementation begins; do not add a redundant spending-approval gate.

Implementation should leave evidence of a negative result when appropriate, not invent an optimization to make every task look like a feature delivery.
