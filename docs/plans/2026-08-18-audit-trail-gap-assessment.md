# Audit-trail gap assessment

Date: 2026-08-18. Status: assessment (evaluation-first; schema work only where a gap is proven).

## Purpose

Goldfish records what agents did and why. Regulated organizations that adopt coding agents
(healthcare, finance, defense) need that record to work as an audit trail: a reviewer or
compliance officer must be able to answer "who changed this, what did they change, why, and
when" from durable evidence. This assessment measures the current checkpoint/brief format
against that bar and names the gaps worth fixing.

The bar, in plain terms:

- **Who** — which human, which agent harness, which model produced the work.
- **What** — the files, symbols, and resulting commit.
- **Why** — the decision, the alternatives, the evidence.
- **When** — a trustworthy timestamp.
- **Chain** — a verifiable link from the record to the exact commit that contains the work.
- **Integrity** — the record cannot be silently altered after the fact.

## What goldfish captures today (verified against a live checkpoint, 2026-08-19)

A checkpoint file carries: `id`, UTC `timestamp`, `tags`, `git.branch`, `git.commit`
(plus changed files when captured), `summary`, `briefId`, `next`, and a structured markdown
body (WHAT/WHY/HOW/IMPACT). Typed checkpoints add `decision`, `alternatives`, `evidence`,
`impact`, `unknowns`, `confidence`, `symbols`. Briefs carry durable direction with status
history. Files live in `.memories/` and are committed to the repo.

This already covers **what**, **why**, and **when** well. The chain and integrity story
rides on git: a checkpoint committed together with the work is sealed by the commit that
contains it, and git history preserves every version.

## Gaps, ranked

### G1 — No actor identity (schema gap, the big one)

Nothing records which agent produced the checkpoint: no harness name, no model id, no
session id. The human is only implied later by the git author of the commit. For AI
governance the first question is "which model/agent did this" — the record cannot answer
it today. Fix: an `actor` block in checkpoint frontmatter (harness, model, session id,
plus the OS/git user at save time), populated automatically, never trusted from free text.

### G2 — Git context can be wrong about where work happened (correctness gap, observed live)

A checkpoint saved from a git worktree on branch `worktree-ct-sidecar-migration` recorded
`git.branch: main` with the main checkout's commit — the workspace was "recovered via
registry" and the git capture followed the registered root, not the caller's working
directory. An audit record that names the wrong branch/commit is worse than none. Fix:
capture git context from the caller's actual working tree; record both the registered
workspace and the physical worktree path when they differ.

### G3 — Forward commit binding is convention, not verification (tooling gap, small)

The checkpoint records the commit that existed *before* the work landed; the binding to
the resulting commit exists only because guidance says "checkpoint before commit so the
file rides in the commit." Nothing verifies it. Fix candidates: a `goldfish verify`-style
check (every checkpoint file's own commit contains it → sealed; uncommitted checkpoints
listed as unsealed), and/or recording the sealing commit into an index at next save.
A convention documented plus a verifier is enough; no schema change required.

### G4 — Integrity beyond git (defer)

Memory files are editable and deletable by design (transparency is a feature). Git history
already preserves every committed version, which is the same integrity bar the source code
itself lives under. An auditor-facing export (date-ranged, with sealing-commit references)
can come later if a real audit asks for it. No action now.

### G5 — Review-evidence records (defer to the review-agent evidence contract)

An external review agent's outcomes (what was reviewed, which rules fired, verdict) may
deserve a dedicated checkpoint `type: review` with structured fields. That schema should
follow the shared evidence contract being defined for the review-agent workflow — not be
invented here first. Revisit when that contract exists.

### G6 — Sensitive-content hygiene (process rule, not schema)

`.memories/` is committed to the repo, so checkpoint text must never contain secrets or
regulated data (PHI-class content). That is a rule for the agents writing checkpoints
(harness/skill guidance), not a goldfish schema feature. Document it in the checkpoint
tool description.

## Verdict

Yes, a plan is warranted — but a small one, scoped to the proven gaps:

1. **G1 + G2** are real schema/correctness work: the `actor` block and worktree-accurate
   git capture. Roughly one agent session in this repo, including tests.
2. **G3** is a small verifier plus documentation.
3. **G4/G5/G6** are explicitly deferred, with triggers named above.

Everything else measured up: WHAT/WHY/WHEN coverage is already strong, and the
commit-the-memories convention gives a usable integrity story today.
