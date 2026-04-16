---
name: plan
description: Use when older workflows ask for /plan or refer to Goldfish plans during the brief migration, so the request can be translated into the new brief-first model without losing compatibility
allowed-tools: mcp__goldfish__brief, mcp__goldfish__plan
---

# Plan Compatibility Alias

`/plan` is a compatibility alias for `/brief`.

Use the same behavior as the brief skill:

- Goldfish stores a compact strategic brief.
- Harness plan mode owns session execution planning.
- `docs/plans/` owns implementation specs and task breakdowns.
- Checkpoints capture evidence after work happens.

## How To Handle `/plan`

- If the user wants to create or update Goldfish direction, use the brief tool and brief semantics.
- If the user says `plan` because of older docs or muscle memory, translate it to `brief` in your reasoning and output.
- If the user is asking about a legacy stored plan by name or ID, the compatibility alias can still read it, but present it as the current brief artifact unless the distinction matters.

## Do Not

- Mirror harness `ExitPlanMode` output into Goldfish.
- Treat Goldfish as the execution planner.
- Copy checklist-heavy implementation plans into the artifact.

When in doubt, follow `/brief`.
