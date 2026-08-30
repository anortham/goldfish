---
id: post-7-8-0-evidence-driven-hardening-across-client
title: "Post-7.9.0: evidence-driven hardening across clients"
status: active
created: 2026-08-19T00:19:51.973Z
updated: 2026-08-30T22:42:53.361Z
tags:
  - direction
  - 7.9.0
  - actor-identity
  - worktree-git
  - evidence-based
---

## Where Goldfish stands

7.9.0 shipped 2026-08-19: audit-complete checkpoints. Checkpoint frontmatter now carries server-observed actor identity (per-source identity guards, value sanitization), and git capture is worktree-accurate (`resolveGitCaptureCwd`, `git.worktree`). 7.8.0 (2026-08-18) added checkpoint `description_file` and the first-class Cursor plugin. Goldfish targets four clients: Claude Code, Codex, Cursor (native plugin), and VS Code/Copilot (MCP + repo instructions).

Backlog lives in Linear: [Goldfish](https://linear.app/breakingdevelopment/project/goldfish-63e9940af66a). `TODO.md` is a pointer plus the live items with issue links. New work still needs a usage report first.

## Direction

Stay in subtract-and-harden mode. Features come only from real usage reports. The Windows report → verify → `description_file` → release cycle is the template: verify the mechanism before building.

## Constraints that must survive

- Version bumps touch **seven** surfaces; `tests/server.test.ts` enforces sync.
- Push branch and tag separately; run `bun run check:version-tag` after tagging.
- No recurring hooks (7.0 lesson). SessionStart only, static content, on all three plugin hosts.
- Never let Goldfish delete a user file: `description_file` deliberately leaves the draft in place.
- Actor identity is server-observed, never client-supplied; keep the per-source guards and sanitization.

## Open watch items

- Windows `description_file` adoption: [BRE-27](https://linear.app/breakingdevelopment/issue/BRE-27)
- Actor and `git.worktree` usefulness: [BRE-28](https://linear.app/breakingdevelopment/issue/BRE-28)
- Cursor write-binding friction: [BRE-29](https://linear.app/breakingdevelopment/issue/BRE-29)
- Skill language and checkpoint frequency: [BRE-19](https://linear.app/breakingdevelopment/issue/BRE-19), [BRE-20](https://linear.app/breakingdevelopment/issue/BRE-20)
- Audit leftovers G3–G6 and SubagentStart: [BRE-31](https://linear.app/breakingdevelopment/issue/BRE-31) through [BRE-35](https://linear.app/breakingdevelopment/issue/BRE-35)
