---
name: handoff
description: Use when returning to a project after time away, switching harnesses, or handing work off to another agent, to produce a structured session-resumption summary from the active brief, recent checkpoints, and git delta.
allowed-tools: mcp__goldfish__recall, mcp__goldfish__brief, Bash
---

# Handoff

## When To Use

Three triggers:

- **Returning to a project after time away.** Yesterday's work, last week's branch, something you parked.
- **Switching harnesses.** You were on Claude Code and are now in Codex, or the reverse. Native harness memory does not survive the jump.
- **Handing off to a different agent.** A parallel agent picks up where another left off in the same repo.

### How `/handoff` differs from neighbors

- `/standup` aggregates **across projects** for a daily-update audience (you, looking at what you did everywhere).
- `/recall` returns **raw checkpoints** for an in-session agent that needs memory restored.
- `/handoff` synthesizes **within one project** into a single resumption document for a different agent or a returning you, picking up cold.

Pick by audience and scope.

## Workflow

Four steps. Run them in order, then compose the document.

### 1. Load the active brief

```ts
mcp__goldfish__recall({ limit: 0 })
```

This returns the active brief without pulling checkpoints. If no brief is active, note that in the output and keep going.

### 2. Load recent checkpoints

```ts
mcp__goldfish__recall({ days: 3, limit: 10, full: true })
```

Default window is 3 days. If the user passed a time argument (for example `--since 2d` or `--since 4h`), honour it:

```ts
mcp__goldfish__recall({ since: "2d", limit: 10, full: true })
```

`full: true` is required so you see `next`, `unknowns`, and git context.

### 3. Capture git state

```bash
git rev-parse --abbrev-ref HEAD
git status -s
git log -1 --oneline
```

Three short commands, three short outputs. No fancy flags.

### 4. Synthesize the document

Compose one markdown document using the sections in **Output Format** below. Do not dump tool output verbatim; distill it.

## Output Format

One markdown document, sections in this order:

### `## Direction`

3-5 lines summarizing the active brief: goal, key constraints, current status. If no brief is active, write "No active brief" and lean on the checkpoint trail for direction.

### `## State at handoff`

- Current branch (from `git rev-parse --abbrev-ref HEAD`)
- Last commit (from `git log -1 --oneline`)
- Uncommitted changes (from `git status -s`), or "clean working tree"

Keep this compact. Three bullets maximum.

### `## Recent activity`

Last 5-10 checkpoints, dense format. Group adjacent checkpoints into logical milestones when they tell a continuous story; otherwise list chronologically. For each checkpoint include:

- One-line summary (use the checkpoint's `summary` field)
- Associated commit or tag if the git context identifies one

When clustering, lead the cluster with a one-line milestone header, then nest the supporting checkpoints beneath it.

### `## Next steps`

Pull from the most recent checkpoint's `next` field. Add any success criteria from the active brief that do not yet have checkpoint evidence. Short bullets; concrete actions.

### `## Open questions`

Pull from recent checkpoints' `unknowns` fields and from any open items in the active brief. If there are no open questions, say so plainly.

### `## Source pointers`

File paths the receiving agent can read deeper from:

- The active brief file (`.memories/briefs/<id>.md`)
- The 2-3 most recent checkpoint files (`.memories/<date>/<time>_<hash>.md`)
- Any `docs/plans/` documents referenced by the brief or a recent checkpoint

## Time Scoping

The skill takes one optional argument: a time window (`--since 2d`, `--since 4h`).

Default behaviour:

1. If the current branch has commits, start from the last commit on this branch and expand backwards until you have at least 5 checkpoints or hit the 3-day cap.
2. Otherwise default to the last 3 days.

Users who want a fixed window should pass `--since`.

## Why This Skill Exists

Native harness memory does not survive harness switches. Goldfish's evidence ledger (briefs plus checkpoints) does, and `/handoff` turns that ledger into a portable resumption document. It is the explicit answer to "how does work resume on a different harness or a different agent?"

## Rules

- Synthesize, do not dump. The receiving agent reads one document, not a transcript.
- Lead each section with the signal, not the mechanics.
- If a section is empty (no brief, no unknowns, clean tree), say so in one line and move on.
- Keep the whole document short enough to read in one pass.
