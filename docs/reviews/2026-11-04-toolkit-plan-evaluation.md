# Toolkit plan evaluation, 2026-11-04

The original implementation and evaluation plan is complete locally. The final combined gate passed at 19:52 UTC after code-kb selected its unchanged runtime. Deployment, duplicate-registration cleanup, and a demonstrated efficiency improvement remain open.

## Selected branches and verification

| Repository | Selected branch and tip | Outcome | Evidence |
|---|---|---|---|
| Goldfish | `feat/toolkit-hardening`, `431f40c` | G1–G3 complete. Canonical file-import containment, portable link tests, corrected storage and handoff docs. | [Plan and execution evidence](../plans/2026-11-03-toolkit-hardening-plan.md). Tested implementation `d93420d`: 702 Linux tests passed, one platform skip, typecheck passed; 14 Windows/NTFS import tests passed. |
| Razorback | `feat/toolkit-reliability`, `78c1a07` | R1–R3 and R4 implementation complete. This assessment closes R4's remaining selected-revision integration gate. | Source `f4d7433` passed 505 local tests, one explicit external skip. Its final metadata tip retains the same agent-facing source hash. See its `.memories/autonomous-run-2026-11-04-toolkit-reliability.md`. |
| code-kb | `toolkit-efficiency`, `571e7fa` | K1–K4 complete with a negative result. The candidate was rejected and the baseline restored; two documented skill clarifications remain. | `evals/edit-2026-11-03-toolkit-efficiency/results/report.md` and `verification.md` in that worktree. Recorded gate: 2,418 Rust tests, 305 Python tests, 20 plugin tests, formatting, Clippy, release build and guidance sync passed. |

Selected worktree paths on this host:

- Goldfish: `/home/murphy/source/goldfish/.worktrees/toolkit-hardening`.
- Razorback: `/home/murphy/.config/razorback/worktrees/razorback/toolkit-reliability`.
- code-kb: `/home/murphy/.codex/worktrees/dd7b/code-kb`.

All three were clean at selection. Main branches still contain only their planning commits beyond the previously released sources. None of the implementation branches has been merged into main, pushed, or released by this evaluation. The branch tips above identify the source selected for testing. Razorback now has metadata-only closure commit `1b3575f`; its accepted agent-facing source-set hash is unchanged. This assessment also adds Goldfish documentation/checkpoint metadata after its selected source.

Existing passing local verification was reused for unchanged source. This assessment ran a new combined test and checked runtime, source, packet, answer, and report identities; it did not rerun the long unit suites or dispatch more model trials.

## Original findings and acceptance

| Finding | Disposition |
|---|---|
| F1, report invisible to recall | Closed. A regular checkpoint points to the committed report; a fresh MCP process retrieves it and the runner verifies plan/task, tested source versus metadata commit, authority and next action. |
| F2, contradictory baseline and TDD rules | Closed within scope. Razorback has one recovery policy and a bounded automation exception that yields to stricter project rules. Focused tests and scoped fresh-agent decisions support the changes. |
| F3, outside-workspace file import | Closed. Canonical ancestry validation rejects external paths, traversal, prefix siblings and external links; valid local paths and links pass on Linux and NTFS. |
| F4, duplicate installations | Diagnostic delivered and actual Razorback duplicates identified. Cleanup has a recorded pending-authorization disposition; no registration was removed. |
| F5/F6, efficiency uncertainty | Measurement complete; improvement unresolved. The tested candidate failed and was discarded. No performance benefit is claimed. |
| F7, combined and actual-agent evidence | Closed for the declared scope. Fresh selected-revision integration passed. Five toolkit decision cases have two passing fresh observations each; a full 15-case model pass is not established. |
| F8, duplicate worktree recall | Documented intentional tradeoff and mitigation. No deduplication behavior was added. |
| F9, stale docs and coverage guidance | Closed for the planned corrections. Cache/skill/storage descriptions match source; code-kb keeps coverage and advisory-check limitations explicit. |

The coordinator's cleanup criterion allows an explicit pending-authority disposition. Checking it off does not mean this workstation's installation is deduplicated. A documented negative efficiency result also satisfies the plan without delivering a faster product.

## Final combined test

[Machine-readable result](2026-11-04-toolkit-integration.json).

Command: `npm run test:integration -- --config <explicit ignored absolute config>`, run from the selected Razorback worktree with task-local TMPDIR. Exit 0. Actual local stdio MCP servers ran with isolated homes, temporary project roots and no model calls.

Selected identities:

- Goldfish source: `431f40c0c4f237f9f687f626ef0c155912c0284d`.
- Razorback runner: `78c1a07f310263bc76e27dd3ea8e080dec562c0a`.
- code-kb source: `571e7fa7906c1b12129f38953477b041a584d61d`. Its runtime source is unchanged from `f290fdca44cec942ae6f50265e21da9f37fca836`.
- Retained code-kb 2.12.0 executable SHA-256: `d3f913db2025339a3496f85017eeaee98542f78afa2f654aacbdf2cc108221d2`.
- Julie 3.11.0 executable SHA-256: `008372ec7a61f0921ef687d20e24c67547255f603d7dbca08710f8e27bef28bc`.

The executable hashes match the frozen current-runtime manifest. Native Git comparisons confirm runtime sources, scripts and dependency manifests match the restored baseline. The rejected candidate executable was not selected.

The runner verified actual tool discovery and root schemas, fresh-session report recovery, independent Goldfish workspaces, code-kb switching between linked worktrees, unsupported Markdown reference coverage with native text fallback, and a read-only duplicate-registration fixture. It also checked source cleanliness/revisions before and after. The missing-tool agent decision is covered by the separate blind cases, not claimed as an end-to-end edit in this runner.

Razorback's original report correctly said the final gate was pending at 02:46 UTC. Metadata closure commit `1b3575f` now records the passing final result in its report, plan and retrieval checkpoint, with a copy of the integration JSON. Its earlier pending sections and old ignored smoke config are historical. Do not reuse the old config, which refers to a removed scratch checkout.

## Actual-agent evidence and limits

Razorback's committed behavior acceptance records ten passing decisions across five required toolkit scenarios. This assessment verified all ten answer and report hashes, the final local-test log hash, and a freshly prepared packet's source-set hash. The current `78c1a07` packet source-set hash is `cee06cf461b8b531ebb102bd9e5733256514d35485385ea67918e46700eb5556`, matching the accepted observations.

The original failed runs are preserved. Source-backed expectation repairs have separate commits and prospective runs. Two unchanged cases carry their earlier passing observations with equal expectation/source bytes; the three repaired cases have six new passing observations. No failed output was relabeled as a new successful agent run.

These checks support the five declared scenarios. Repeated full-bundle attempts did not establish a 15/15 model pass. They also do not establish general reliability improvement, token savings, or latency gains. The native subagent interface did not expose exact backend revision or timing/token data, and those values remain unavailable.

Goldfish's checkpoint behavior and output-quality eval checks passed, but two explicit Skill-loading checks failed because the model called MCP directly. The old-skill decision baseline reproduced the same failure. This remains a disclosed evaluation/discovery limitation; the graders were retained.

## Efficiency result

Six tasks, two repeats, three arms: 36 completed model trials. Every arm accepted 12/12 patches, with no protected-input violation or source-review rejection. All required token and timing fields were present. Independent source review and actual added-test replays support acceptance.

| Measure | Native | Current code-kb | Short-instruction candidate |
|---|---:|---:|---:|
| Accepted patches | 12/12 | 12/12 | 12/12 |
| Total input tokens | 3,758,042 | 6,518,315 | 7,461,801 |
| Uncached input tokens | 327,386 | 548,907 | 512,937 |
| Index-inclusive seconds | 1,434.958 | 1,737.845 | 1,917.640 |

The candidate increased total input 14.47% and time 10.35% versus current code-kb. Its 6.55% uncached-input reduction met only one threshold. It failed both frozen efficiency comparisons and was restored out of the final runtime.

Current code-kb itself used about 73.4% more total input and 21.1% more index-inclusive time than native tools in this study, with equal observed acceptance. These small-sample results concern these tasks and this model/runtime setup. Provider backend weights and sampling seed were unavailable; operating-system and provider caches were not flushed. They do not prove that code-kb is always slower or that shorter instructions caused the observed difference.

The remaining efficiency question needs a new measured design rather than repeated tuning on these now-exposed confirmation tasks. This plan's one-candidate/one-confirmation campaign is finished.

## Separate Julie 3.12 work

A separate clean branch, `julie-3.12-integration`, is at `0e365d7` in `/home/murphy/.codex/worktrees/e912/code-kb`. Its recorded tested source is `4953bf6`; the tip adds verification metadata. The report records 2,444 Linux Rust tests and targeted native Windows checks passing. The retained dogfood branch at `310d6a7` is also clean.

That branch was not part of the frozen efficiency campaign or this selected-baseline combined run. Do not attribute the benchmark to Julie 3.12 or treat this gate as acceptance of a later merged deployment. Its upstream T-SQL limitation remains explicit: an assignment to `@AreaCode` is extracted as a read; code-kb preserves that producer fact.

## Updated assessment

Scores are review judgments on the completed local work, not release gates or claims about an already updated installation.

| Combined category | Before | Now | Reason |
|---|---:|---:|---|
| Core usefulness | 9 | 9 | The product responsibilities remain complementary. |
| Correctness and reliability | 7 | 8 | Contradictions fixed, handoff recovered against real services, source-bound acceptance evidence. |
| Agent usability | 7 | 7 | Clearer recovery guidance; limited case evidence and known discovery limitations remain. |
| Token and workflow efficiency | 6 | 5 | Fresh comparison shows no task-cost win; the rejected change was correctly excluded. |
| Safety and recovery | 7 | 8 | Canonical import boundary and explicit authority/state recovery now verified. |
| Installation and portability | 6 | 7 | Diagnostic and Windows Goldfish tests delivered; real duplicate cleanup and rollout remain pending. |
| Testing and behavioral evidence | 6 | 8 | Frozen 36-trial study, preserved failures, ten scoped decisions, final real-service integration. |
| Maintainability | 7 | 7 | Existing product boundaries retained; new integration/evidence tooling also needs maintenance. |

Overall assessment remains about 7/10. Safety and verification improved; efficiency and the installed rollout still limit the toolkit. A negative experiment improved the evidence without improving runtime cost.

## Remaining actions and authority

1. Review and authorize how to integrate the clean local branches. Main checkouts and installed plugin caches still use the earlier implementation. No merge, push, release or plugin upgrade was performed here.
2. Decide whether the separate Julie 3.12 branch belongs in the intended rollout; run acceptance on the exact combined revision if selected.
3. Approve any duplicate-registration cleanup before acting. Razorback's report identifies `/home/murphy/.codex/skills/razorback` and `/home/murphy/.agents/skills/razorback` as redundant symlinks to the source skills; retain source and plugin cache trees. Verify a fresh host inventory after an authorized change.
4. Keep the current cost and discovery limitations visible. Future efficiency work needs untouched confirmation cases and a new design; no further campaign was silently started.
5. Refresh Razorback's active brief before its next unrelated task. It still names the older inner-loop-test project, so new toolkit checkpoints inherited that affinity. This assessment did not complete or archive an unrelated brief.

All task and related worktrees were inventoried. Source changes remain on their named branches, and no unrelated user changes were overwritten. The Windows VM is shut off. The assessment and its normal Goldfish checkpoint provide the next session's retrieval pointer.
