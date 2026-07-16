# Agent Portability

How Goldfish reaches each harness, what was deliberately not done, and where the drift guards live. Goldfish ships a stateful MCP server plus repo-local skills — support tiers reflect what each harness can actually run, not aspiration.

## Support matrix

| Harness | Tier | Mechanism | Key files |
|---|---|---|---|
| Claude Code | Full (tools + skills + instructions + hooks) | Plugin manifest registering the MCP server, 6 skills, and the SessionStart hook | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/`, `hooks/goldfish-hooks.json` |
| Codex CLI / Desktop | Full (tools + skills + hooks) | Plugin manifest bundling the MCP server, skills, and the same SessionStart hook; project-local `.codex/config.toml` remains the manual alternative | `.codex-plugin/plugin.json`, `.mcp.json`, `hooks/goldfish-hooks.json`, `README.md` Codex section |
| OpenCode | Tools + skills | `opencode.json` MCP entry + `.agents/skills` auto-discovery | `opencode.json` (committed, works in this repo as-is) |
| VS Code + Copilot | Tools + instructions file | `.vscode/mcp.json` + optional repo instructions | `.vscode/mcp.json` (committed), `docs/goldfish-checkpoint.instructions-vs-code.md` |
| Cursor | Tools + skills (with quirk) | Plugin, plus per-project `mcp.json` escape hatch for the roots gap | `README.md` Cursor section, `src/workspace-recovery.ts` |
| Instruction tier (Zed, Amp, Jules, Junie, Windsurf, Cline, Kiro, Cursor rules) | Guidance only | User copies the generated usage ruleset into their repo's instruction surface | `docs/agent-instructions/goldfish-usage.md` (generated from `src/instructions.ts`) |
| Any MCP client | Baseline tools | Standard stdio server: 3 tools + server instructions | `src/server.ts` |

**Instruction-tier honesty:** those harnesses get behavior rules but not working tools unless the user also registers the MCP server. Say so wherever the tier is advertised; guidance without tools that pretends otherwise is worse than no support.

## Deliberate non-support

Recorded so these decisions stop being re-litigated. Revisit any of them when real usage evidence appears.

- **~~No hooks tier for any harness~~ — reversed (2026-07-16) for SessionStart only.** Goldfish 7.0 removed hooks after the hook-spam disaster, and that lesson stands: the disaster was a **frequency** problem (per-prompt re-triggering), not context injection. Two harness changes then removed the surfaces the 7.0 decision assumed: Claude Code caps server instructions at 2k (no headroom for checkpoint quality guidance), and deferred tool loading hides tool descriptions — and the tools' existence — at session start. Observed result: sessions ignored the goldfish tools entirely. The hooks tier answers that evidence and is deliberately not the old pattern: **SessionStart only, static content, no `resume` matcher, one event, one command, no tool calls, no state writes, 5s timeout, always exit 0**. Any recurring hook (`UserPromptSubmit` and friends) remains out of scope; `SubagentStart` awaits evidence that subagents miss goldfish context.
- **No Gemini CLI extension.** Would require validating Goldfish's Bun runtime assumption inside Gemini's extension model, and no usage evidence has asked for it.
- **No per-harness rule-file adapters committed in this repo** (`.cursor/rules/`, `.windsurf/rules/`, ...). Committed adapters here would only configure the goldfish repo itself; users copy `docs/agent-instructions/goldfish-usage.md` into their own repos instead.
- **No non-Bun fallback runtime.** The server assumes Bun (speed + built-in test runner); shipping a Node build doubles the support surface without evidence of demand.

## Client-difference handling in code

- **MCP roots negotiated at request time** with a timeout, cached per session (`src/server.ts`) — desktop clients populate roots late or never.
- **Workspace recovery** without roots: registry lookup plus `.memories/`/`.git/` ancestor walk (`src/workspace-recovery.ts`).
- **Parameter aliasing** for non-Claude clients: `id`/`briefId`/`brief_id`, arrays accepted as JSON strings or comma-separated strings (`src/handlers/*`, `src/types.ts`).
- **2k char caps** on instructions and tool descriptions enforced by tests (`tests/server.test.ts`) — Claude Code truncates silently beyond that.
- **Deferred tool loading** hides tool descriptions at session start; the SessionStart hook advertises that the goldfish tools exist and may need loading (`src/hook-context.ts`).
- **One hooks map, two harnesses** (`hooks/goldfish-hooks.json`): Codex aliases `CLAUDE_PLUGIN_ROOT` to `PLUGIN_ROOT`, and both harnesses inject a hook's raw stdout as context — so the script needs no harness detection.

## Drift guards

- `tests/agent-assets.test.ts` — `.agents/skills` mirror byte-equality, AGENTS.md contributor mirror, generated usage-doc freshness, and version-vs-git-tag agreement on release commits.
- `tests/server.test.ts` — six version surfaces agree with `SERVER_VERSION`; instruction/description caps.
- `tests/hooks.test.ts` — hook content contains `getInstructions()` verbatim and stays within Goldfish's 10,000-character safety budget; the hook script's stdout matches `getHookContext()` exactly at exit 0 and setup failures are contained; the hooks map keeps one event/one command with no `resume`; both plugin manifests resolve to the same map, and the canonical Codex MCP map registers the server.
- `scripts/version-tag-check.ts` — standalone release guard (`bun scripts/version-tag-check.ts`); catches the all-surfaces-stale-together failure that mutual-agreement tests cannot.
- `scripts/sync-agent-skills.ts` — regenerates every mirrored/generated asset; run after editing `skills/`, `CLAUDE.md`, or `src/instructions.ts`.

## State outside the repo (uninstall)

Goldfish writes one thing outside project repos: `~/.goldfish/registry.json`, the auto-populated cross-project registry. To fully remove Goldfish: remove the plugin/MCP registration from your client and delete `~/.goldfish/`. Project `.memories/` directories are project artifacts owned by their repos — they stay.
