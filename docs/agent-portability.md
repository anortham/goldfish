# Agent Portability

How Goldfish reaches each harness, what was deliberately not done, and where the drift guards live. Goldfish ships a stateful MCP server plus repo-local skills — support tiers reflect what each harness can actually run, not aspiration.

## Support matrix

| Harness | Tier | Mechanism | Key files |
|---|---|---|---|
| Claude Code | Full (tools + skills + instructions) | Plugin manifest registering the MCP server and 6 skills | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `skills/` |
| Codex CLI / Desktop | Tools + skills | Project-local `.codex/config.toml` (user-created, see README) + `.agents/skills` auto-discovery | `README.md` Codex section, `.agents/skills/` |
| OpenCode | Tools + skills | `opencode.json` MCP entry + `.agents/skills` auto-discovery | `opencode.json` (committed, works in this repo as-is) |
| VS Code + Copilot | Tools + instructions file | `.vscode/mcp.json` + optional repo instructions | `.vscode/mcp.json` (committed), `docs/goldfish-checkpoint.instructions-vs-code.md` |
| Cursor | Tools + skills (with quirk) | Plugin, plus per-project `mcp.json` escape hatch for the roots gap | `README.md` Cursor section, `src/workspace-recovery.ts` |
| Instruction tier (Zed, Amp, Jules, Junie, Windsurf, Cline, Kiro, Cursor rules) | Guidance only | User copies the generated usage ruleset into their repo's instruction surface | `docs/agent-instructions/goldfish-usage.md` (generated from `src/instructions.ts`) |
| Any MCP client | Baseline tools | Standard stdio server: 3 tools + server instructions | `src/server.ts` |

**Instruction-tier honesty:** those harnesses get behavior rules but not working tools unless the user also registers the MCP server. Say so wherever the tier is advertised; guidance without tools that pretends otherwise is worse than no support.

## Deliberate non-support

Recorded so these decisions stop being re-litigated. Revisit any of them when real usage evidence appears.

- **No hooks tier for any harness.** Goldfish 7.0 removed hooks after the hook-spam disaster (see CLAUDE.md project history). Behavioral adoption now flows through server instructions, tool descriptions, and response nudges.
- **No Gemini CLI extension.** Would require validating Goldfish's Bun runtime assumption inside Gemini's extension model, and no usage evidence has asked for it.
- **No per-harness rule-file adapters committed in this repo** (`.cursor/rules/`, `.windsurf/rules/`, ...). Committed adapters here would only configure the goldfish repo itself; users copy `docs/agent-instructions/goldfish-usage.md` into their own repos instead.
- **No non-Bun fallback runtime.** The server assumes Bun (speed + built-in test runner); shipping a Node build doubles the support surface without evidence of demand.

## Client-difference handling in code

- **MCP roots negotiated at request time** with a timeout, cached per session (`src/server.ts`) — desktop clients populate roots late or never.
- **Workspace recovery** without roots: registry lookup plus `.memories/`/`.git/` ancestor walk (`src/workspace-recovery.ts`).
- **Parameter aliasing** for non-Claude clients: `id`/`briefId`/`brief_id`, arrays accepted as JSON strings or comma-separated strings (`src/handlers/*`, `src/types.ts`).
- **2k char caps** on instructions and tool descriptions enforced by tests (`tests/server.test.ts`) — Claude Code truncates silently beyond that.

## Drift guards

- `tests/agent-assets.test.ts` — `.agents/skills` mirror byte-equality, AGENTS.md contributor mirror, generated usage-doc freshness, and version-vs-git-tag agreement on release commits.
- `tests/server.test.ts` — five version surfaces agree with `SERVER_VERSION`; instruction/description caps.
- `scripts/version-tag-check.ts` — standalone release guard (`bun scripts/version-tag-check.ts`); catches the all-surfaces-stale-together failure that mutual-agreement tests cannot.
- `scripts/sync-agent-skills.ts` — regenerates every mirrored/generated asset; run after editing `skills/`, `CLAUDE.md`, or `src/instructions.ts`.

## State outside the repo (uninstall)

Goldfish writes one thing outside project repos: `~/.goldfish/registry.json`, the auto-populated cross-project registry. To fully remove Goldfish: remove the plugin/MCP registration from your client and delete `~/.goldfish/`. Project `.memories/` directories are project artifacts owned by their repos — they stay.
