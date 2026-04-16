# Cross-Client Portability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use razorback:executing-plans to implement this plan task-by-task.

**Goal:** Make Goldfish easier to use in Codex Desktop, OpenCode, and VS Code with GitHub Copilot while preserving the existing Claude Code plugin experience.

**Architecture:** Keep the MCP server and memory model unchanged at the core, add request-time workspace roots resolution in the server path, and layer client-specific discovery and docs on top. Claude-specific hooks stay intact; cross-client support comes from repo-local skill discovery, client config docs, and neutral product wording rather than a second memory system.

**Tech Stack:** Bun, TypeScript, MCP SDK, markdown skills, Claude plugin assets, Codex `.agents/skills` discovery, OpenCode skill and MCP config conventions, VS Code `mcp.json`.

---

TDD applies throughout. Runtime changes ship with failing tests first. Metadata and docs changes should also get regression coverage where the repo already has metadata inventory tests.

## File Structure

### Runtime workspace binding

- `src/workspace.ts`
  Responsibility: pure workspace-resolution helpers and path utilities.
- `src/server.ts`
  Responsibility: MCP session lifecycle, request-time roots lookup, and tool-call argument hydration.
- `tests/workspace.test.ts`
  Responsibility: unit coverage for resolution precedence and path helpers.
- `tests/server.test.ts`
  Responsibility: regression coverage for runtime metadata, roots-aware request behavior, and inventory checks.

### Cross-client skill discovery

- `skills/`
  Responsibility: canonical Claude-compatible skill source.
- `.agents/skills/`
  Responsibility: repo-local skill discovery surface for Codex and OpenCode.
- `scripts/sync-agent-skills.ts`
  Responsibility: mirror canonical `skills/` content into `.agents/skills/` so there is one source of truth.
- `package.json`
  Responsibility: developer scripts for maintaining skill mirrors and neutral package metadata.

### Client-facing docs and behavior

- `README.md`
  Responsibility: product positioning, install matrix, client-specific setup, and standup behavior explanation.
- `CONTRIBUTING.md`
  Responsibility: contributor mental model and project identity.
- `docs/goldfish-checkpoint.instructions-vs-code.md`
  Responsibility: VS Code Copilot instructions aligned with brief-first semantics and roots-aware setup.
- `skills/standup/SKILL.md`
  Responsibility: standup workflow and reporting rules grounded only in briefs plus checkpoints.
- `.claude-plugin/plugin.json`
  Responsibility: preserve Claude plugin metadata while keeping wording neutral.
- `.claude-plugin/marketplace.json`
  Responsibility: preserve marketplace metadata while keeping wording neutral.

## Task 1: Add Request-Time Roots-Aware Workspace Resolution

**Files:**
- Modify: `src/workspace.ts`
- Modify: `src/server.ts`
- Test: `tests/workspace.test.ts`
- Test: `tests/server.test.ts`

**What to build:** Add roots-aware workspace resolution so Goldfish can bind to the correct project root in clients that support MCP roots, without changing behavior for explicit `workspace` arguments, `GOLDFISH_WORKSPACE`, or existing Claude plugin use. The server should resolve the effective workspace at tool-call time and pass that resolved path into handlers.

**Approach:** Keep `src/workspace.ts` as the pure precedence and parsing layer, and keep MCP-specific session state in `src/server.ts`. Add helper coverage for `explicit > GOLDFISH_WORKSPACE > roots > cwd`, ignore empty roots, parse `file://` root URIs safely, and cache the chosen root for the session until `notifications/roots/list_changed` marks the cache dirty. Do not probe roots during initialization; only do it when a tool call needs the default workspace and the current default came from weak startup `cwd`.

**Acceptance criteria:**
- [ ] `resolveWorkspace`-level helpers cover explicit path, `"current"`, env override, roots fallback, and cwd fallback in `tests/workspace.test.ts`.
- [ ] `src/server.ts` hydrates missing or `"current"` workspace arguments with the resolved session workspace before dispatching handlers.
- [ ] Request-time roots lookup is lazy and does not run during server startup.
- [ ] Roots lookup failure falls back to the previous behavior instead of breaking tool calls.
- [ ] Existing handler tests still pass and new roots-specific server tests pass.
- [ ] Tests pass, committed.

## Task 2: Add Repo-Local Skill Discovery for Codex and OpenCode

**Files:**
- Create: `scripts/sync-agent-skills.ts`
- Create: `.agents/skills/brief/SKILL.md`
- Create: `.agents/skills/brief-status/SKILL.md`
- Create: `.agents/skills/checkpoint/SKILL.md`
- Create: `.agents/skills/consolidate/SKILL.md`
- Create: `.agents/skills/plan/SKILL.md`
- Create: `.agents/skills/plan-status/SKILL.md`
- Create: `.agents/skills/recall/SKILL.md`
- Create: `.agents/skills/standup/SKILL.md`
- Modify: `package.json`
- Test: `tests/server.test.ts`

**What to build:** Add a repo-local `.agents/skills/` surface so Codex and OpenCode can discover Goldfish skills directly from the repository, without changing the existing Claude plugin `skills/` layout. Keep `skills/` as the canonical source and treat `.agents/skills/` as a mirrored adapter surface.

**Approach:** Add a small sync script that copies canonical `skills/*/SKILL.md` files into `.agents/skills/*/SKILL.md` and wire it into `package.json` so the mirror can be refreshed deliberately. Check the mirrored files into git so repo users get discovery with no extra setup. Extend the metadata test area in `tests/server.test.ts` to assert that `skills/` and `.agents/skills/` contain the same skill directories and byte-identical `SKILL.md` contents. Do not invent a second skill dialect in this slice.

**Acceptance criteria:**
- [ ] Codex and OpenCode can discover repo-local Goldfish skills through `.agents/skills/`.
- [ ] `skills/` remains the canonical authored source; `.agents/skills/` is mirrored output only.
- [ ] `package.json` includes a maintainable skill-sync script.
- [ ] Regression coverage fails if skill inventory or file contents drift between `skills/` and `.agents/skills/`.
- [ ] Tests pass, committed.

## Task 3: Reposition Product Metadata and Client Setup Docs

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `package.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `docs/goldfish-checkpoint.instructions-vs-code.md`
- Test: `tests/server.test.ts`

**What to build:** Rewrite the user-facing setup story around Goldfish as a cross-client MCP memory system, with Claude Code plugin support as one adapter rather than the whole identity. Add clear setup guidance for Claude Code, Codex Desktop, OpenCode, and VS Code with GitHub Copilot, including the fact that VS Code roots support makes `GOLDFISH_WORKSPACE` optional as an override instead of mandatory configuration.

**Approach:** Keep the README install flow grounded in real client conventions:
- Claude Code: plugin plus hooks
- Codex Desktop: `.codex/config.toml` MCP setup plus repo-local `.agents/skills`
- OpenCode: `opencode.json` MCP setup plus repo-local `.agents/skills`
- VS Code Copilot: `.vscode/mcp.json`, roots support, and the existing instructions file

Update package and marketplace descriptions so they stop calling Goldfish only a Claude Code plugin. Reuse the existing metadata test area in `tests/server.test.ts` to add guardrails around client headings, neutral package wording, and any inventory statements that can drift.

**Acceptance criteria:**
- [ ] README leads with cross-client identity rather than Claude-only positioning.
- [ ] README includes concrete setup sections for Claude Code, Codex Desktop, OpenCode, and VS Code with GitHub Copilot.
- [ ] VS Code docs state that `GOLDFISH_WORKSPACE` is optional once roots support is available, and still valid as an override.
- [ ] `package.json` and plugin metadata no longer describe Goldfish only as a Claude Code plugin.
- [ ] Metadata tests catch future drift in the documented client matrix or skill inventory.
- [ ] Tests pass, committed.

## Task 4: Narrow Standup to Briefs Plus Checkpoints

**Files:**
- Modify: `skills/standup/SKILL.md`
- Modify: `README.md`
- Test: `tests/server.test.ts`

**What to build:** Update standup behavior and documentation so it reports only from Goldfish memory artifacts: briefs for direction and checkpoints for evidence. Remove language that tells the agent to read `docs/plans/` or other execution artifacts as part of standup generation.

**Approach:** Keep the standup skill narrow and opinionated. It should use cross-project recall, inspect the active brief for each workspace where available, summarize checkpoint clusters into meaningful accomplishments, and call out blockers or stale direction when checkpoint evidence no longer matches the brief. Update README examples and descriptions to match this memory-only scope. Add a metadata regression assertion that the standup skill and README no longer describe `docs/plans/` as a standup input.

**Acceptance criteria:**
- [ ] `skills/standup/SKILL.md` uses only briefs plus checkpoints as standup inputs.
- [ ] README standup copy matches the new memory-only scope.
- [ ] Regression coverage fails if standup docs drift back toward `docs/plans/` ingestion.
- [ ] Tests pass, committed.
