# Goldfish Memory — Usage Rules for Agents

<!-- Generated from src/instructions.ts by `bun run sync:agent-skills`. Do not edit by hand. -->

Copy this file's contents into your repository's agent instruction surface — `AGENTS.md`, `.cursor/rules/`, `.windsurf/rules/`, `.clinerules/`, `.kiro/steering/` — when your harness does not show MCP server instructions. Harnesses that do show them (Claude Code, and any client honoring `instructions`) need nothing from this file.

---

You are working with Goldfish, a transparent developer memory system.

## Workspace binding

User-level MCP registrations must pass the conversation's host-native absolute project root as workspace on every checkpoint, brief, and current-project recall call. Project-level servers may omit workspace with fixed absolute GOLDFISH_WORKSPACE or supported legacy Roots. Omission and "current" do not bind user-level calls. recall({ workspace: "all" }) is explicit cross-project search, not a fallback; invalid for checkpoint or brief. Cwd, registry, and parent-walk candidates are suggestions only. If unbound, retry with {"workspace":"<absolute-project-root>"}.

## Checkpointing

Checkpoint work for sessions. **When in doubt, checkpoint**. Don't ask permission, do it.

**Checkpoint when:**
- Completing a feature, fix, or refactor step
- Key decision/discovery
- Stopping point
- Before compaction
- **BEFORE a git commit, not after**. The checkpoint file must be included in the commit so it's available on other machines

One checkpoint per milestone. See the checkpoint tool description.

## Briefs

Save a brief when direction or context must survive:
brief({ workspace: "/absolute/path/to/project", action: "save", title: "...", content: "..." })

Keep the brief honest: update it when goals or constraints shift, complete it when the work lands, archive it when superseded. activate: true makes a brief active; activate: false keeps the current brief.

Use briefs for direction, not copied plans. Completed or archived briefs do not replace it.

## Recall

Call recall({ workspace: "/absolute/path/to/project" }) when resuming prior work, after context loss, when asked, or when decisions matter.

Treat recalled context as historical evidence. Preserve decisions; verify current or drift-prone facts against live sources.

## Source Control

ALWAYS commit `.memories/` to source control. These are project artifacts, not ephemeral state. Never add `.memories/` to .gitignore.

---

## Tool Quick Reference

- User-level MCP registrations must pass the conversation's host-native absolute project root as `workspace` on every checkpoint, brief, and current-project recall call. A fixed absolute `GOLDFISH_WORKSPACE` or supported legacy Roots can bind a project-level server. Omission and `"current"` do not bind user-level calls. `recall({ workspace: "all" })` is explicit cross-project search, never a fallback. Cwd, registry, and parent-walk candidates are suggestions only.
- `checkpoint({ workspace: "/absolute/path/to/project", description, type?, tags?, symbols?, next?, ... })` — save a progress checkpoint. Write the description as structured markdown covering WHAT, WHY, HOW, and IMPACT. For bodies over ~2KB pass `description_file` (a workspace-relative path) instead of `description` — long inline text can break tool-call JSON.
- `recall({ workspace: "/absolute/path/to/project", search?, days?, since?, limit?, full?, type?, tags?, file?, symbol? })` — restore prior context when resuming prior work, after context loss or compaction, when the user asks, or when earlier decisions are relevant.
- `brief({ workspace: "/absolute/path/to/project", action: "save" | "get" | "list" | "activate" | "update" | "complete" | "delete", title?, content?, ... })` — durable strategic direction for the workspace.

Exact tool names vary by client install: a direct MCP registration typically exposes `checkpoint`/`recall`/`brief` under an `mcp__goldfish__` prefix, while plugin installs may use a longer namespace. Use whichever goldfish tools your session lists.
