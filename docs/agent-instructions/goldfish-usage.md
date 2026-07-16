# Goldfish Memory — Usage Rules for Agents

<!-- Generated from src/instructions.ts by `bun run sync:agent-skills`. Do not edit by hand. -->

Copy this file's contents into your repository's agent instruction surface — `AGENTS.md`, `.cursor/rules/`, `.windsurf/rules/`, `.clinerules/`, `.kiro/steering/` — when your harness does not show MCP server instructions. Harnesses that do show them (Claude Code, and any client honoring `instructions`) need nothing from this file.

---

You are working with Goldfish, a transparent developer memory system.

## Checkpointing

Checkpoint your work so future sessions have context. **When in doubt, checkpoint**, a few extra checkpoints are better than lost context. Don't ask permission, do it.

**Checkpoint when:**
- Completing a feature, bug fix, or refactor step
- Making a key decision or discovery
- Reaching a natural stopping point in a session
- Before context compaction
- **BEFORE a git commit, not after**. The checkpoint file must be included in the commit so it's available on other machines

One checkpoint per logical milestone. See the checkpoint tool description for formatting guidance.

## Briefs

Save a brief when the project's strategic direction changes or when durable context should survive future sessions:
brief({ action: "save", title: "...", content: "..." })

Keep the active brief honest: update it when goals or constraints shift, complete it when the work lands, archive it when superseded. A stale brief misleads future sessions — when recall or a checkpoint response flags one, act on it.

Use briefs for compact forward-looking context, not copied execution plans. Saved briefs with status: active become active by default. Use activate: false to keep the current active brief unchanged, or activate: true when you want to be explicit. Completed or archived briefs do not replace the current active brief.

## Recall

Recall restores context from previous sessions. Call recall() when resuming prior work, after context loss or compaction, when the user asks, or when earlier decisions are relevant.

Treat recalled context as historical evidence. Preserve its decisions and reasoning, but verify current or drift-prone facts against live sources before relying on them.

## Source Control

ALWAYS commit `.memories/` to source control. These are project artifacts, not ephemeral state. Never add `.memories/` to .gitignore.

---

## Tool Quick Reference

- `checkpoint({ description, type?, tags?, symbols?, next?, ... })` — save a progress checkpoint. Write the description as structured markdown covering WHAT, WHY, HOW, and IMPACT.
- `recall({ search?, days?, since?, limit?, full?, workspace?, type?, tags?, file?, symbol? })` — restore prior context when resuming prior work, after context loss or compaction, when the user asks, or when earlier decisions are relevant.
- `brief({ action: "save" | "get" | "list" | "activate" | "update" | "complete" | "delete", title?, content?, ... })` — durable strategic direction for the workspace.

Exact tool names vary by client install: a direct MCP registration typically exposes `checkpoint`/`recall`/`brief` under an `mcp__goldfish__` prefix, while plugin installs may use a longer namespace. Use whichever goldfish tools your session lists.
