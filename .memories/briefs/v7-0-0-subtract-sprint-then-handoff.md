---
id: v7-0-0-subtract-sprint-then-handoff
title: v7.0.0 subtract sprint, then handoff
status: active
created: 2026-04-16T18:51:58.346Z
updated: 2026-04-16T18:51:58.346Z
tags:
  - v7.0.0
  - strategic
  - subtract-sprint
  - evidence-ledger
---

# v7.0.0 subtract sprint, then handoff

## Goal

Reposition goldfish from "memory" (a frame the 1M-context era kills) to **evidence ledger / git for intent**: source-controlled, harness-agnostic, durable record of why things changed. Three legs: checkpoints (evidence), briefs (current strategic thesis), cross-project recall (multi-project ergonomic).

## Why now

Originally built for 200K-context Claude Code with hook-driven UX as a differentiator. None of those framings are durable in 2026: context is cheap, harnesses have proliferated, several have native memory, and workflow plugin ecosystems (razorback, claude-code skills) own planning/debugging/review. Goldfish has to earn the slot between static CLAUDE.md and ephemeral harness plan modes.

## Constraints

- TDD only, no exceptions
- Keep `.memories/` markdown source of truth shape unchanged (no migration on user data)
- One coherent v7.0.0 release; no half-states
- Cross-client experience (Codex, OpenCode, VS Code, Claude Code) must stay aligned

## v7.0.0 scope (subtract sprint)

1. **Orama replaces fuse + semantic stack** (design: `docs/plans/2026-04-16-orama-search-replacement-design.md`)
2. **Delete SessionStart and PreCompact hooks** (Claude-Code-only, intrusive on cheap context)
3. **Delete consolidation routine** (token math is net-negative as wired today)
4. **Retire `plan` tool clean** (no compat alias); rename `plans.ts` → `briefs.ts`
5. **Doc sweep**: delete stale superpowers/julie/RAG planning docs and old revival plans
6. **Update agent docs**: CLAUDE.md and AGENTS.md reflect new module map and 8-skill (then post-cleanup) inventory

## v7.1.0 scope (build)

7. **Handoff layer**: `/handoff` skill or `recall({ handoff: true })` producing returning-engineer summary from active brief + recent checkpoints + git delta. Cross-client by design.

## Success criteria

- `bun test` and `bun run typecheck` both pass on a clean v7.0.0 release
- `package.json` no longer depends on `@huggingface/transformers`
- Server tools shrink from 5 to 3 (checkpoint, recall, brief)
- Skill inventory in CLAUDE.md/AGENTS.md matches reality post-cleanup
- The 12-query comparison harness used during brainstorming continues to find at least one relevant result for every query
- Handoff output (7.1) is usable by an engineer or agent picking up cold on a different harness

## References

- Design: `docs/plans/2026-04-16-orama-search-replacement-design.md`
- Checkpoint with full strategic rationale + Gemini/Codex second opinions: `.memories/2026-04-16/185114_f1dc.md`
