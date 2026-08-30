# Fail-closed workspace identity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use razorback:subagent-driven-development when subagent delegation is available. Fall back to razorback:executing-plans for single-task, tightly-sequential, or no-delegation runs.

**Goal:** Prevent Goldfish from reading or writing any project unless each workspace-scoped call carries a verified project identity from an explicit absolute path, fixed environment configuration, supported legacy Roots, or recall-only `all`.

**Architecture:** Keep workspace policy behind the existing workspace module and MCP protocol adapter. Source selection becomes fail-closed, path validation applies to every source, parent walking produces suggestions rather than authorization, and handlers receive one verified absolute path. Remove automatic registry/cwd recovery and server-local activation state.

**Tech Stack:** Bun 1.4, TypeScript 5.9, MCP TypeScript SDK v2, Bun test runner, project-local markdown storage.

**Architecture Quality:** `src/workspace.ts` owns the deep workspace-binding policy; `src/server.ts` adapts MCP arguments and legacy Roots into that policy; handlers and storage entry points use the same verified interface. Risk is high because implicit cwd/recovery callers intentionally break, but the change removes silent cross-project data placement.

## Global constraints

- TDD is mandatory. Each worker writes the failing test first, records the red result, implements the minimum behavior, and reruns the focused scope.
- User-level MCP registrations must pass a host-native absolute workspace on every checkpoint, brief, and current-workspace recall call.
- Project-level calls may omit `workspace` only when absolute `GOLDFISH_WORKSPACE` is fixed for that server process.
- Supported legacy Roots remains a compatibility input. Modern `2026-07-28` calls never depend on Roots or protocol sessions.
- `recall({ workspace: "all" })` remains an explicit cross-project operation. Checkpoint and brief continue rejecting `all`.
- Process cwd, registry entries, `.git`, and `.memories` parent walking never authorize a workspace. They may only produce suggestions in an error.
- Accepted paths are host-native, fully qualified absolute paths to existing directories. Reject empty/current/relative paths, `~`, unexpanded variables, `file://` URIs, foreign-host path syntax, drive-relative Windows paths, unresolved `..` segments, filesystem roots, home directories, and Windows system directories.
- If the exact path is nested below an enclosing `.git` or `.memories` project, refuse and suggest that root. An existing absolute directory with no enclosing marker remains valid for first-use non-Git storage.
- Use this exact unbound retry sentence: `Workspace is not bound. User-level MCP registrations must pass the absolute project root on every workspace-scoped call. Retry with {"workspace":"<absolute-project-root>"}.`
- Known-project and parent-walk candidates are labeled `Suggestions only; choose one explicitly:`.
- Preserve the SessionStart-only static hook contract. Do not inject dynamic cwd or add hook events.
- Preserve atomic writes, UTC timestamps, actor identity, worktree-accurate git capture, and cross-workspace registry storage.
- Remove automatic recovery behavior rather than leaving a dormant authorization path.
- Workers are `luna_worker` agents. They are not alone in the worktree and must not revert edits outside their owned files.

---

## Verification strategy

**Project source of truth:** `AGENTS.md`, especially Mandatory TDD, Targeted Test Groups, final `bun test`, and `bun run typecheck`.

**Worker red/green scope:** Task 1 uses `bun test workspace`; Task 2 uses `bun test server workspace-recovery protocol-compatibility`; Task 3 uses `bun test handlers checkpoints briefs recall`; Task 4 uses `bun test server hooks agent-assets` after `bun run sync:agent-skills`.

**Worker ceiling:** Focused file groups only. Workers do not run the full suite or own branch acceptance.

**Worker gate invariant:** Each task proves its owned contract through the same exported function or MCP tool interface callers use. Red runs must fail for the intended missing behavior, not fixture or setup errors.

**Lead affected-change scope:** `bun test server workspace workspace-recovery protocol-compatibility handlers checkpoints briefs recall hooks agent-assets` plus `bun run typecheck` after the implementation batch.

**Branch gate:** `bun test` and `bun run typecheck` on the final reviewed HEAD.

**Security scope:** none declared. Path validation and broad-directory refusal are correctness and data-placement hard gates inside the focused and branch tests.

**Replay/metric evidence:** Hard gates are zero writes before binding, exact refusal text, platform path validation, nested-project refusal, legacy Roots success, explicit two-workspace cache isolation, and full-suite/typecheck success. Test counts and timings are report-only.

**Escalation triggers:** Any write outside the explicitly selected workspace, a direct handler/storage cwd fallback, platform-dependent path ambiguity, actor/worktree regression, cross-workspace recall regression, or failing full suite triggers lead-owned diagnosis and a bounded correction packet.

**Assigned verification failure:** Workers stop and report when assigned verification fails, unless this plan explicitly says to update that gate.

**Verification ledger:** Record invariant, command, scope label, commit SHA, result, and timestamp. If the same HEAD already has a passing ledger entry for the required scope, reuse that evidence instead of rerunning an unchanged gate.

## Parallel execution contract

| Task | Parallel batch | File ownership | Serialization required | Dependency reason |
|---|---|---|---|---|
| Task 1: Core binding policy | None - serial | `src/workspace.ts`, `tests/workspace.test.ts` | Yes | Establishes the verified workspace interface consumed by Tasks 2 and 3. |
| Task 2: MCP adapter and recovery removal | Batch B | `src/server.ts`, `src/workspace-recovery.ts`, `tests/server.test.ts`, `tests/workspace-recovery.test.ts`, `tests/protocol-compatibility.test.ts` | No | Depends only on Task 1; safe in parallel with Task 3 because ownership does not overlap. |
| Task 3: Handler and storage backstops | Batch B | `src/handlers/checkpoint.ts`, `src/handlers/brief.ts`, `src/handlers/recall.ts`, `src/checkpoints.ts`, `src/briefs.ts`, `src/recall.ts`, `tests/handlers.test.ts`, `tests/checkpoints.test.ts`, `tests/briefs.test.ts`, `tests/recall.test.ts` | No | Depends only on Task 1; safe in parallel with Task 2 because ownership does not overlap. |
| Task 4: Tool contract and guidance | None - serial | `src/tools.ts`, `src/instructions.ts`, `src/hook-context.ts`, `skills/**`, `.agents/skills/**`, `docs/agent-instructions/goldfish-usage.md`, `README.md`, `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `docs/goldfish-checkpoint.instructions-vs-code.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `tests/hooks.test.ts`, `tests/agent-assets.test.ts`, and Task 4 additions to `tests/server.test.ts` | Yes | Runs after Batch B so tool-description assertions build on the final adapter test file and exact runtime contract. |

### Task 1: Core binding policy

**Files:**
- Modify: `src/workspace.ts` at `resolveWorkspace`, `resolveWorkspaceWithSource`, unsafe-path helpers, and parent-walk helpers
- Test: `tests/workspace.test.ts`

**Interfaces:**
- Consumes: `WorkspaceRoot`, `ResolveWorkspaceOptions`, existing POSIX/Windows safety normalization, `GOLDFISH_WORKSPACE`, and the design contract.
- Produces: one exported async workspace-binding interface that selects explicit/env/legacy Roots, validates the host-native absolute existing directory, refuses unsafe or nested paths, and returns the verified absolute project root plus source. Unbound errors contain the exact global retry sentence and optional suggestion roots.

**Contract inputs:** Explicit path outranks environment; environment outranks legacy Roots. No cwd result exists. `current` is missing identity. `all` is handled by the protocol adapter and recall, not accepted as a filesystem path.

**File ownership:** `src/workspace.ts`, `tests/workspace.test.ts`

**Serialization required:** Yes

**Dependency reason:** Establishes the verified workspace interface consumed by Tasks 2 and 3.

**What to build:** Add the fail-closed source selection and path-validation behavior without wiring callers yet. Keep candidate parent walking separate from authorization. Preserve path-key helpers used by registry and git code.

**Approach:** Test host-native absolute paths, existing-directory requirement, unsafe broad directories, symlinked home equality, current/relative/token/URI/dot-segment cases, nested project suggestions, non-Git first use, environment and Roots precedence, and absence of cwd fallback. Use host-specific conditional tests for Windows and POSIX cases rather than pretending foreign syntax is portable.

**Commit mode:** `serial-worker-commit` after lead inline review and focused verification.

**Acceptance criteria:**
- [ ] Missing/current input with no env or Roots fails with the exact retry sentence.
- [ ] Explicit, environment, and Roots sources all pass one validation policy.
- [ ] Host-native absolute, unsafe-directory, token/URI, dot-segment, and platform edge cases are covered.
- [ ] Nested projects refuse with a suggestion; markerless existing directories remain valid.
- [ ] Cwd is never returned as a workspace source.
- [ ] `bun test workspace` passes and the reviewed task is committed.

### Task 2: MCP adapter and recovery removal

**Files:**
- Modify: `src/server.ts` at `hydrateWorkspaceArguments`, `createServer`, and workspace error handling
- Modify or delete: `src/workspace-recovery.ts`
- Test: `tests/server.test.ts`
- Modify or delete: `tests/workspace-recovery.test.ts`
- Test: `tests/protocol-compatibility.test.ts`

**Interfaces:**
- Consumes: Task 1 verified workspace interface, legacy `roots/list`, registry project listing for suggestions, MCP tool result error shape, and recall-only `all`.
- Produces: a protocol adapter that hydrates every workspace-aware call from explicit/env/legacy Roots or returns `isError`; it never accepts process cwd or automatic registry recovery. Legacy spawned stdio Roots remains covered.

**Contract inputs:** Preserve the 500 ms legacy Roots timeout and root cache only for initialization-era calls. `workspace: "all"` bypasses filesystem binding only for recall. Known registry paths are suggestions only.

**File ownership:** `src/server.ts`, `src/workspace-recovery.ts`, `tests/server.test.ts`, `tests/workspace-recovery.test.ts`, `tests/protocol-compatibility.test.ts`

**Serialization required:** No

**Dependency reason:** Depends only on Task 1; safe in parallel with Task 3 because ownership does not overlap.

**What to build:** Replace cwd/recovery hydration with the verified binder, remove recovery notices and automatic selection, retain only compact suggestion formatting where needed, and prove no handler runs before binding. A plugin-cache cwd containing `.memories` must fail identically to any other unbound user-level call.

**Approach:** Rewrite existing fallback/recovery tests into refusal and explicit retry tests. Add real spawned stdio coverage for modern unbound refusal and legacy Roots hydration. Assert zero `.memories` writes under the launch directory. Keep actor extraction and MCP v2 compatibility unchanged.

**Commit mode:** `parallel-lead-commit`; do not stage or commit from the worker lane.

**Acceptance criteria:**
- [ ] Modern omitted/current calls return `isError` before checkpoint, recall, or brief handlers execute.
- [ ] Plugin-cache cwd with `.memories` cannot become the workspace implicitly.
- [ ] Explicit path and fixed environment work; legacy spawned stdio Roots still works.
- [ ] Registry and parent-walk candidates appear only under the exact suggestions label.
- [ ] Recovery selection and recovery notices are removed with their obsolete tests.
- [ ] `bun test server workspace-recovery protocol-compatibility` passes and the worker hands off an uncommitted reviewed diff.

### Task 3: Handler and storage backstops

**Files:**
- Modify: `src/handlers/checkpoint.ts`
- Modify: `src/handlers/brief.ts`
- Modify: `src/handlers/recall.ts`
- Modify: `src/checkpoints.ts`
- Modify: `src/briefs.ts`
- Modify: `src/recall.ts`
- Test: `tests/handlers.test.ts`
- Test: `tests/checkpoints.test.ts`
- Test: `tests/briefs.test.ts`
- Test: `tests/recall.test.ts`

**Interfaces:**
- Consumes: Task 1 verified workspace interface and the already-explicit workspace argument supplied by the server adapter.
- Produces: direct handler and public storage entry points that fail closed without explicit/env identity, preserve recall `all`, and never reconstruct workspace identity from process cwd.

**Contract inputs:** Low-level path-format helpers may remain pure helpers, but every exported operation that reads or writes checkpoint or brief state must bind before filesystem access. Explicit calls for two different projects in one process remain isolated in day, search, brief, and checkpoint caches.

**File ownership:** `src/handlers/checkpoint.ts`, `src/handlers/brief.ts`, `src/handlers/recall.ts`, `src/checkpoints.ts`, `src/briefs.ts`, `src/recall.ts`, `tests/handlers.test.ts`, `tests/checkpoints.test.ts`, `tests/briefs.test.ts`, `tests/recall.test.ts`

**Serialization required:** No

**Dependency reason:** Depends only on Task 1; safe in parallel with Task 2 because ownership does not overlap.

**What to build:** Route direct handlers and storage operations through Task 1 binding instead of the legacy sync cwd resolver. Preserve explicit worktree storage and git capture behavior. Add regression tests for direct unbound calls and cross-workspace cache isolation.

**Approach:** Update asynchronous entry points rather than adding new implicit state. Keep `workspace: "all"` inside recall's deliberate aggregation branch. Test that unbound direct calls leave launch cwd unchanged and that alternating two explicit workspaces returns only each project's data.

**Commit mode:** `parallel-lead-commit`; do not stage or commit from the worker lane.

**Acceptance criteria:**
- [ ] Direct checkpoint, brief, and current-workspace recall calls refuse before filesystem access when unbound.
- [ ] Explicit and fixed-environment direct calls retain existing behavior.
- [ ] Worktree-aware checkpoint storage and git capture remain green.
- [ ] Two explicit workspaces in one process do not cross-contaminate storage or caches.
- [ ] Cross-project recall remains explicit and green.
- [ ] `bun test handlers checkpoints briefs recall` passes and the worker hands off an uncommitted reviewed diff.

### Task 4: Tool contract and guidance

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/instructions.ts`
- Modify: `src/hook-context.ts`
- Modify: `skills/brief/SKILL.md`, `skills/brief-status/SKILL.md`, `skills/checkpoint/SKILL.md`, `skills/handoff/SKILL.md`, `skills/recall/SKILL.md`, `skills/standup/SKILL.md`
- Regenerate: `.agents/skills/**`, `docs/agent-instructions/goldfish-usage.md`
- Modify: `README.md`, `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `docs/goldfish-checkpoint.instructions-vs-code.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`
- Test: `tests/server.test.ts`, `tests/hooks.test.ts`, `tests/agent-assets.test.ts`

**Interfaces:**
- Consumes: final runtime refusal contract from Tasks 1 through 3 and the existing 2,000-character tool/server limits plus 10,000-character hook limit.
- Produces: consistent tool schemas, descriptions, static hook guidance, skills, and setup docs that tell user-level agents to pass the conversation's absolute project root on every workspace-scoped call.

**Contract inputs:** Preserve positive checkpoint frequency guidance and all existing character caps. Keep SessionStart content static. Project-level `GOLDFISH_WORKSPACE` and legacy Roots remain documented compatibility paths. Historical design plans remain unchanged.

**File ownership:** `src/tools.ts`, `src/instructions.ts`, `src/hook-context.ts`, `skills/**`, `.agents/skills/**`, `docs/agent-instructions/goldfish-usage.md`, `README.md`, `docs/agent-portability.md`, `docs/IMPLEMENTATION.md`, `docs/goldfish-checkpoint.instructions-vs-code.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `tests/hooks.test.ts`, `tests/agent-assets.test.ts`, and Task 4 additions to `tests/server.test.ts`

**Serialization required:** Yes

**Dependency reason:** Runs after Batch B so tool-description assertions build on the final adapter test file and exact runtime contract.

**What to build:** Replace “current/default” wording with the verified binding rule, add compact absolute-workspace guidance to every relevant skill, sync generated mirrors, and update client setup and troubleshooting docs. Record the breaking change under Unreleased without bumping or releasing a version.

**Approach:** Keep the tool `workspace` property optional in JSON Schema because fixed environment and legacy Roots can satisfy it at runtime. Make descriptions explicit that user-level registrations must supply it. Run the sync script instead of hand-editing generated mirrors, then repair any character-cap failures by removing duplicated wording.

**Commit mode:** `serial-worker-commit` after lead inline review and focused verification.

**Acceptance criteria:**
- [ ] All three tools use one workspace parameter description and no longer advertise cwd/current as a safe default.
- [ ] Static instructions, hook context, and all six skills explain the user-level absolute-path rule without adding dynamic hooks.
- [ ] README and portability docs distinguish user-level per-call identity from project-level environment configuration and legacy Roots.
- [ ] Generated mirrors are byte-for-byte current; AGENTS and CLAUDE remain matched.
- [ ] Tool, server, and hook character caps remain green.
- [ ] `bun run sync:agent-skills` and `bun test server hooks agent-assets` pass and the reviewed task is committed.

## Final integration verification

After all tasks are reviewed and committed, the lead will:

1. Run Miller `impact(git=true)` and inspect the final modified symbols.
2. Run `bun test server workspace workspace-recovery protocol-compatibility handlers checkpoints briefs recall hooks agent-assets`.
3. Run `bun run typecheck`.
4. Run `bun test` once as the branch gate.
5. Reconcile every worktree and branch, then use `razorback:finishing-a-development-branch` without pushing or releasing unless the user separately approves it.
