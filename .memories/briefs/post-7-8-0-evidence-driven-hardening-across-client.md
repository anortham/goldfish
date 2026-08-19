---
id: post-7-8-0-evidence-driven-hardening-across-client
title: "Post-7.9.0: evidence-driven hardening across clients"
status: active
created: 2026-08-19T00:19:51.973Z
updated: 2026-08-19T19:33:11.180Z
tags:
  - direction
  - 7.9.0
  - actor-identity
  - worktree-git
  - evidence-based
---

## Where Goldfish stands

7.9.0 shipped 2026-08-19: audit-complete checkpoints. Checkpoint frontmatter now carries server-observed actor identity (per-source identity guards, value sanitization), and git capture is worktree-accurate (`resolveGitCaptureCwd`, `git.worktree`). 7.8.0 (2026-08-18) added checkpoint `description_file` and the first-class Cursor plugin. Goldfish targets four clients: Claude Code, Codex, Cursor (native plugin), and VS Code/Copilot (MCP + repo instructions).

## Direction

Stay in subtract-and-harden mode. Features come only from real usage reports (the TODO "From Real Usage" section is the intake queue). The Windows report → verify → `description_file` → release cycle is the template: verify the mechanism before building.

## Constraints that must survive

- Version bumps touch **seven** surfaces; `tests/server.test.ts` enforces sync.
- Push branch and tag separately; run `bun run check:version-tag` after tagging.
- No recurring hooks (7.0 lesson). SessionStart only, static content, on all three plugin hosts.
- Never let Goldfish delete a user file: `description_file` deliberately leaves the draft in place.
- Actor identity is server-observed, never client-supplied; keep the per-source guards and sanitization.

## Open watch items

- Does `description_file` get used on Windows? Watch for follow-up reports before more transport work.
- Do actor identity and `git.worktree` prove useful in recall output? Watch real sessions.
- Remaining From Real Usage items: skill language tuning, checkpoint frequency evaluation.
- Cursor workspace binding relies on the project `.cursor/mcp.json` fallback for writes; watch for real friction.
