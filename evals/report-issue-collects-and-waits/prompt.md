---
tags: [report-issue]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill, Bash, Write]
---

File a bug against Goldfish. `recall({ workspace: "/work/app", search: "auth migration" })` returned `No checkpoints found`, but `/work/app/.memories/2026-09-30/141502_ab12.md` is a checkpoint about the auth migration. I expected that checkpoint in the results. I use the Claude Code plugin. Title: recall search misses auth migration checkpoint.
