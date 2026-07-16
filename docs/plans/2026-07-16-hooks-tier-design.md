# Goldfish Hooks Tier — SessionStart Instruction Delivery (Design)

**Date:** 2026-07-16
**Status:** Approved design, pre-implementation (revised after external Codex review; findings verified against official Codex docs)
**Approach:** Multi-harness from day one (Claude Code + Codex CLI), per user decision

## Problem

Two harness changes gutted Goldfish's ambient behavioral surface:

1. **Server instructions cap:** Claude Code truncates MCP server instructions at 2,000 chars. Goldfish's instructions (1,763 chars) fit, but there is no headroom for the guidance that matters most (checkpoint quality format, tool parameter reference).
2. **Deferred tool loading (now default):** MCP tool descriptions are invisible until the model searches for them. The checkpoint tool's quality guidance (WHAT/WHY/HOW/IMPACT), recall's usage patterns, and even the tools' existence are hidden at session start. Observed result: sessions ignore the goldfish tools entirely.

Goldfish 7.0 removed all hooks after the "hook spam disaster" — a **frequency** problem (per-prompt re-triggering), not a SessionStart-injection problem. SessionStart hooks allow up to 10,000 chars of injected context, fire once per session start, and are the mechanism ponytail uses successfully across four harnesses.

## Locked Decisions (user-confirmed)

- **Static content only.** No dynamic recall/memory injection. The user starts many sessions that should not recall anything but must still know to checkpoint.
- **SessionStart only.** No SubagentStart in v1 (subagent token-spam risk, no evidence of need).
- **Claude Code + Codex CLI both first-class.** The user works in both daily. Copilot/Qoder excluded — Goldfish ships no plugin delivery channel for them.
- **MCP server instructions unchanged.** They remain the ≤2k baseline for every non-hook client (direct MCP registrations, VS Code, OpenCode, Cursor). Accepted cost: plugin sessions see ~1.7k chars duplicated between instructions and hook content.

## Verified Harness Facts (Codex docs at learn.chatgpt.com, 2026-07-16)

These four facts shape the design; each was verified against the official docs, not assumed:

1. Codex SessionStart hooks accept **plain stdout as developer context** — same as Claude Code. JSON output is optional, and SessionStart JSON has **no `systemMessage` field**.
2. Codex plugin manifests support **`mcpServers`** pointing at an `.mcp.json` server-map file — the Codex tier can bundle tool registration, not just hooks + skills.
3. Codex sets **`CLAUDE_PLUGIN_ROOT` as a compatibility alias** for `PLUGIN_ROOT` in hook commands — one shared hooks map works verbatim in both harnesses (this is why ponytail's shared map works).
4. Plugin-bundled hooks are **skipped until the user reviews and trusts them** (`Installing or enabling a plugin doesn't automatically trust its hooks`) — install docs must include the trust step.

## Architecture

```
hooks/
  goldfish-hooks.json      # shared hooks map, referenced by BOTH plugin manifests
  session-start.ts         # hook entrypoint, run via bun — branchless, no harness detection
src/
  hook-context.ts          # getHookContext() — composes hook payload at runtime
.claude-plugin/plugin.json # + "hooks": "./hooks/goldfish-hooks.json"
.codex-plugin/plugin.json  # NEW manifest: metadata, skills, hooks, mcpServers
.codex-plugin/mcp.json     # NEW Codex MCP server map (bun run src/server.ts)
```

Delivery pattern (shared hooks map consumed by two manifests) is copied from ponytail. Ponytail's per-harness output adapter is **deliberately not copied**: verified fact 1 makes it unnecessary — both harnesses accept the same raw stdout, so one branchless script replaces it.

### hooks/goldfish-hooks.json

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/session-start.ts\"",
            "commandWindows": "if (Get-Command bun -ErrorAction SilentlyContinue) { bun \"$env:CLAUDE_PLUGIN_ROOT\\hooks\\session-start.ts\" }",
            "timeout": 5,
            "statusMessage": "Loading goldfish memory guidance..."
          }
        ]
      }
    ]
  }
}
```

- `bun`, not `node`: the plugin already requires Bun (the MCP server runs `bun run src/server.ts`), so Bun is guaranteed present and the repo stays single-runtime. The Windows variant no-ops gracefully when bun is missing from PATH.
- **`resume` is excluded from the matcher** (Codex review finding, accepted): a resumed session's transcript already contains the previous injection verbatim, so re-firing would accumulate duplicate static payloads across repeated resumes. `clear` wipes context and `compact` summarizes it away — those two plus `startup` are exactly the moments the guidance is missing.
- The map contains exactly one event with exactly one command — test-enforced, so growth of the hook surface is a deliberate act, not drift.

### hooks/session-start.ts

Branchless — no harness detection, no output adapter:

1. Install a stdout `error` handler first: suppress `EPIPE` (async stdout errors escape try/catch), write anything else to stderr. Broken installs must be visible on stderr, not silently hidden — but the hook always exits 0 so session start is never blocked.
2. `import { getHookContext } from '../src/hook-context'` — Bun executes TypeScript natively, and the plugin ships `src/` already (the MCP server runs from it).
3. Write `getHookContext()` to stdout. Raw text is injected as context by both Claude Code and Codex (verified fact 1).

### src/hook-context.ts

`getHookContext(): string`, composed **at runtime** — no generated payload file, so payload-vs-source drift is impossible by construction. Composition:

1. **`getInstructions()` verbatim** (single source of truth for behavioral rules: checkpoint triggers incl. checkpoint-BEFORE-commit, brief lifecycle, recall-at-session-start, `.memories/` source control). Codex review suggested a curated recomposition instead; rejected — curation reintroduces the drift surface that verbatim composition eliminates, and the recall-at-session-start guidance is unchanged advice goldfish has always shipped (the static-only decision was about the hook's *mechanism*, not this advice).
2. **Tool-existence advertisement** (the deferred-loading counterweight): the session has goldfish MCP tools — `checkpoint`, `recall`, `brief`; they may be deferred/hidden at session start; load/search them rather than assuming they are absent; exact names vary by install (`mcp__goldfish__*` for direct MCP, longer namespace for plugin installs).
3. **Tool quick reference** — the same parameter-shape block `scripts/build-usage-doc.ts` embeds today. Extract it to a shared exported constant in `src/hook-context.ts` and import it from `build-usage-doc.ts`, so the two surfaces cannot drift.
4. **Checkpoint quality format** — descriptions are structured markdown covering WHAT/WHY/HOW/IMPACT (today this lives only in the checkpoint tool description, which deferred loading hides).

Size target ~4–5k chars (guidance, not a test); hard cap **10,000** enforced by test (harness truncation limit).

### .codex-plugin/plugin.json + .codex-plugin/mcp.json

New manifest making the Codex tier genuinely first-class — one plugin install delivers tools + skills + hooks (verified fact 2). This replaces the earlier hooks-and-skills-only draft, which would have let the hook advertise tools a skills-only install didn't have (Codex review finding, accepted — it violated `docs/agent-portability.md`'s instruction-tier honesty rule).

```json
{
  "name": "goldfish",
  "version": "7.5.0",
  "description": "Cross-client MCP memory with checkpoints, recall, briefs, and standups for AI-assisted development",
  "skills": "./skills/",
  "hooks": "./hooks/goldfish-hooks.json",
  "mcpServers": "./.codex-plugin/mcp.json"
}
```

```json
{
  "goldfish": {
    "command": "bun",
    "args": ["run", "${PLUGIN_ROOT}/src/server.ts"]
  }
}
```

- Manifest-relative paths resolve from the plugin root (repo root), matching ponytail's `.codex-plugin` conventions.
- The MCP map deliberately does **not** live at repo root as `.mcp.json`: Claude Code reads root-level `.mcp.json` as project-scoped MCP config, and a `${PLUGIN_ROOT}` path would break for anyone opening the goldfish repo itself in Claude Code.
- The existing `.codex/config.toml` path in README remains documented for non-plugin Codex users; the plugin becomes the recommended route. README gains the **hook trust step** (verified fact 4).
- The manifest `version` becomes the **sixth synced version surface**; `tests/server.test.ts` and the CLAUDE.md/CONTRIBUTING version-bump documentation are updated from five to six.

## Why This Is Not the Old Hook Spam

The 7.0 removal was driven by per-prompt re-triggering (frequency). This design: fires once per session start, static content, no tool calls, no state writes, no re-trigger surface, no `resume` duplication, 5s timeout, EPIPE-safe failure. `docs/agent-portability.md`'s "No hooks tier for any harness" negative-space entry is rewritten to record the reversal and the evidence that justified it (instructions cap + deferred tool loading).

## Testing (TDD, bun test)

New `tests/hooks.test.ts`:

**Content invariants (via `getHookContext()` import):**
- **Contains `getInstructions()` verbatim** (stronger than a length floor — proves composition, catches accidental emptiness)
- Includes checkpoint-before-commit guidance, all three tool names, the deferred-loading warning, brief lifecycle guidance, and WHAT/WHY/HOW/IMPACT
- Length ≤ 10,000

**Subprocess test (the exact interface both harnesses consume):**
- `bun hooks/session-start.ts` → stdout equals `getHookContext()` exactly (raw text, not JSON), exit code 0

**Manifest/wiring tests:**
- `.claude-plugin/plugin.json` `hooks` path and `.codex-plugin/plugin.json` `hooks` path both resolve to the same existing file
- `goldfish-hooks.json` is valid JSON; exactly one event (SessionStart) with exactly one command; matcher is `startup|clear|compact` (no `resume`); `command` references `session-start.ts`; `commandWindows` variant and timeout present
- `.codex-plugin/mcp.json` is valid JSON; its `command`/`args` reference bun and `src/server.ts`; the manifest's `mcpServers` path resolves to it

**Version surface:** extend the existing sync test to include `.codex-plugin/plugin.json` (six surfaces).

## Manual Verification (release checklist, not CI)

Subprocess tests prove output shape, not plugin discovery or trust flow (Codex review finding, accepted):

- **Claude Code:** install the plugin locally, start a session, confirm the hook's context is present and the statusMessage shows once.
- **Codex CLI:** install the plugin, complete the hook **trust review**, start a session, confirm goldfish tools are registered (bundled `.mcp.json`) and hook context is present.
- **Windows:** run the `commandWindows` line in PowerShell on a Windows machine when available; until then it mirrors ponytail's shipped, working pattern.

## Documentation Updates

- `docs/agent-portability.md` — Claude Code and Codex rows gain the hooks tier; Codex row upgrades to plugin-delivered tools + skills + hooks; rewrite the "No hooks tier" negative-space entry; add the new drift guards.
- `CLAUDE.md` + `CONTRIBUTING.md` — version bumping: five surfaces → six.
- `README.md` — Codex section: plugin install as the recommended route (with trust step), `.codex/config.toml` kept as the manual alternative.

## Out of Scope (recorded negative space)

- **SubagentStart** — revisit with evidence of subagents missing goldfish context.
- **Copilot CLI / Qoder hook adapters** — no delivery channel shipped; the branchless script means adding one later is a new hooks-map file plus (only if that harness requires it) an output branch.
- **Dynamic content** (active-brief hints, recall injection) — explicitly rejected by user.
- **Shrinking MCP instructions** — they stay as the universal fallback.
- **UserPromptSubmit or any recurring hook** — the 7.0 spam lesson stands.

## Second Opinions

- **Codex (adversarial, read-only):** verdict "keep the tier, fix two material gaps." Accepted and folded in: bundle `mcpServers` in the Codex manifest (finding 1), drop the output adapter (finding 2), exclude `resume` (finding 4), explicit EPIPE handling + stderr reporting (finding 5), manual smoke checklist (finding 6), containment assertion instead of length floor (finding 7). Rejected: curated instruction recomposition (finding 3 — reintroduces drift; verbatim keeps one source of truth).
- **Gemini:** unavailable — gemini-cli 0.46.0 auth is dead for the individual tier; user directed Codex-only going forward.

## Acceptance Criteria

- [x] `bun hooks/session-start.ts` emits the full static guidance as raw stdout, exit 0 (same shape consumed by both harnesses)
- [x] Hook content contains `getInstructions()` verbatim plus: checkpoint-before-commit, all three tool names, deferred-tools warning, WHAT/WHY/HOW/IMPACT, brief lifecycle
- [x] Hook content ≤ 10,000 chars (test-enforced), composed at runtime — no generated payload file
- [x] Hooks map: exactly one event, one command, matcher `startup|clear|compact` (test-enforced)
- [x] Both plugin manifests reference the same hooks map; all referenced paths exist (test-enforced)
- [x] `.codex-plugin/mcp.json` registers the goldfish server via bun (test-enforced)
- [x] Six version surfaces in sync (test-enforced); docs updated to say six
- [x] `scripts/build-usage-doc.ts` imports the shared tool quick reference (no duplicated block)
- [x] Hook script: stdout EPIPE suppressed, other errors to stderr, always exit 0
- [x] `docs/agent-portability.md`, `README.md`, `CLAUDE.md`, `CONTRIBUTING.md` updated
- [x] Full suite green: `bun test` and `tsc --noEmit`

## Implementation Route

Lightweight path (moderate, same-session): worktree via razorback:using-git-worktrees, this design doc committed as the branch's first commit, TDD implementation with `bun test hooks` as the worker scope, full suite as final check. Release/version bump is a separate, later approval.
