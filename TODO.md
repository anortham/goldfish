# Goldfish -- Backlog

Tracker: [Goldfish on Linear](https://linear.app/breakingdevelopment/project/goldfish-63e9940af66a)

## From Real Usage

- [ ] Tune skill language from session observations — [BRE-19](https://linear.app/breakingdevelopment/issue/BRE-19/tune-skill-language-from-session-observations)
- [ ] Evaluate checkpoint frequency in practice — [BRE-20](https://linear.app/breakingdevelopment/issue/BRE-20/evaluate-checkpoint-frequency-in-practice)

## Selective memory follow-up (2026-09-23)

Local backlog from the tooling assessment; implementation has not started.
Expand BRE-19 and BRE-20 with the work below rather than creating duplicate issues.
The goal is to preserve current direction, consequential decisions, and useful
handoffs across agents and sessions.

- [ ] Replace routine checkpoint triggers with information-value triggers.
  Update `src/instructions.ts`, `src/tools.ts`, `src/hook-context.ts`, and
  `skills/checkpoint/SKILL.md`, then synchronize the distributed agent assets.
  Save a checkpoint for a consequential decision, a surprising failure with
  evidence, or unfinished work that needs a handoff. Remove "when in doubt" and
  checkpoint-before-every-commit as default frequency rules. When a checkpoint
  is warranted for a commit, still write it before that commit so changed-file
  metadata is captured and the memory travels with the change.
  Acceptance: an ordinary completed edit needs no memory artifact; an important
  rejected alternative and an unfinished session each produce a useful one.
- [x] Align brief, recall, and handoff guidance around selective retrieval.
  Review `skills/brief/SKILL.md`, `skills/recall/SKILL.md`, and
  `skills/handoff/SKILL.md`. Keep one current brief for direction; use checkpoints
  for historical evidence. Retrieve relevant history on resume or when a prior
  decision matters, and verify stale claims against current code. Avoid copying
  plans, Git logs, and command transcripts into memory.
  Acceptance: a fresh session can recover the goal, key constraints, and next
  action without reading the entire memory corpus.
  Done 2026-09-24: recall is conditional (skill description and tool
  trigger), recall recovers goal, constraints, and the `next` line and checks
  drift-prone facts, handoff no longer cites the hidden `summary` field and
  marks historical claims, and briefs exclude git logs and command output.
- [ ] Measure the value of memory using a small handoff comparison.
  Start with existing transcripts and a sample of recent checkpoints. Record
  which entries were retrieved and whether they changed a decision or avoided
  repeated investigation; missing read evidence means unknown, not unused.
  Compare brief-only, brief plus relevant recall, and native history/Git on
  matched resumed tasks, including an outdated decision that needs checking.
  Use the shared experiment tracked in Razorback's TODO; vary memory separately
  from workflow and retrieval. Report actual tokens, recovery time, forgotten
  constraints, and human corrections. Request a budget before any paid replay.
  Acceptance: evidence supports which checkpoint triggers to keep; no new
  telemetry service, embedding stack, automatic consolidation, or history deletion.

  First pass (2026-09-24, transcripts only, no paid replay): Claude sessions
  from 2026-08-25 and Codex sessions from 2026-08-12, all projects.
  - 1,151 checkpoint writes against 227 recall calls; 70% of written
    checkpoints never appeared in any recall result. Agents also grep or cat
    `.memories/` directly (not judged), so "never recalled" is not "never read".
  - Of 208 recalls with results: 46 changed what the agent did, 80 only
    oriented it, 80 went unused, 0 misled it.
  - What changed decisions: the `next` handoff line (24), decisions (11),
    status notes (11), failures (5). Handoff content is the strongest trigger.
  - Targeted searches did worst (40 of 74 unused): dotted versions tokenized
    into bare digits ("3.3.1" -> "3", "1"), and Orama's all-terms mode dropped
    documents where a term prefix-matched two words in one field. Both fixed
    in `src/ranking.ts`. Recalls right after compaction mostly restated
    context the agent still had.
  - Follow-up search gaps also fixed: parts of hyphenated and snake_case
    words now match, checkpoint IDs are searchable, and the any-term fallback
    ranks by the number of query words matched. Cost: an uncached index build
    is about 45% slower (1.0 s to 1.5 s at 1,950 checkpoints); cached queries
    are unchanged.
  - 950+ stored checkpoints had `summary: WHAT` (a `## WHAT` first line), so
    compact recall showed nothing; fixed in `src/summary.ts`, `src/digests.ts`,
    and the checkpoint parser.
  - About 35% of checkpoints come within ten tool calls before a `git commit`.

Verify guidance changes with `bun test hooks agent-assets server handlers`, and
run `bun run typecheck` if TypeScript changes. Inspect the rendered SessionStart
payload and tool descriptions for contradictory old triggers. Coordinate with
Razorback's checkpoint rules so it does not restore the removed frequency policy.

## Parked (evidence required)

- [ ] Checkpoint pruning or archival only if `.memories/` size hurts — [BRE-21](https://linear.app/breakingdevelopment/issue/BRE-21/checkpoint-pruning-or-archival-only-if-memories-size-hurts)
- [ ] Brief templates only if a usage pattern appears — [BRE-22](https://linear.app/breakingdevelopment/issue/BRE-22/brief-templates-only-if-a-usage-pattern-appears)
- [ ] Checkpoint export beyond standup only for a named workflow — [BRE-23](https://linear.app/breakingdevelopment/issue/BRE-23/checkpoint-export-beyond-standup-only-for-a-named-workflow)
- [ ] `goldfish verify` for unsealed checkpoints (audit G3) — [BRE-31](https://linear.app/breakingdevelopment/issue/BRE-31/goldfish-verify-for-unsealed-checkpoints-audit-g3)
- [ ] Auditor export only if a real audit asks (audit G4) — [BRE-32](https://linear.app/breakingdevelopment/issue/BRE-32/auditor-export-only-if-a-real-audit-asks-audit-g4)
- [ ] Review-evidence checkpoint type after the shared contract (audit G5) — [BRE-33](https://linear.app/breakingdevelopment/issue/BRE-33/review-evidence-checkpoint-type-after-the-shared-contract-audit-g5)
- [ ] No-secrets rule in checkpoint guidance (audit G6) — [BRE-34](https://linear.app/breakingdevelopment/issue/BRE-34/no-secrets-rule-in-checkpoint-guidance-audit-g6)

## Watch

- [ ] Where BM25 search falls short, if anywhere — [BRE-24](https://linear.app/breakingdevelopment/issue/BRE-24/watch-where-bm25-search-falls-short)
- [ ] Windows `description_file` adoption — [BRE-27](https://linear.app/breakingdevelopment/issue/BRE-27/watch-windows-description-file-adoption-before-more-transport-work)
- [ ] Whether `actor` and `git.worktree` help recall — [BRE-28](https://linear.app/breakingdevelopment/issue/BRE-28/watch-whether-actor-and-gitworktree-help-recall)
- [ ] Cursor write-binding friction — [BRE-29](https://linear.app/breakingdevelopment/issue/BRE-29/watch-cursor-write-binding-friction-on-missing-workspace)
- [ ] SubagentStart only if subagents miss Goldfish context — [BRE-35](https://linear.app/breakingdevelopment/issue/BRE-35/subagentstart-hook-only-if-subagents-miss-goldfish-context)
