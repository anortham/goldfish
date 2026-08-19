# Checkpoint actor identity and worktree-accurate git — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use razorback:subagent-driven-development when subagent delegation is available. Fall back to razorback:executing-plans for single-task, tightly-sequential, or no-delegation runs.

**Goal:** Stamp server-observed actor identity on new checkpoints, and capture git from the same-repo worktree toplevel instead of the registered main root.

**Architecture:** Additive optional YAML only. `src/server.ts` is the only module that reads MCP ctx. Handlers and storage take plain `ObservedActor` data. Git probes `--git-common-dir` at caller cwd, then queries branch/commit/files/`git config` at that cwd's `--show-toplevel`. Memories still write under `resolveWorkspace()`. No new tools, no `src/actor.ts`, no actor tool args.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/server` `^2.0.0`, `@modelcontextprotocol/client` `^2.0.0`, existing markdown checkpoint storage.

**Architecture Quality:** Medium risk (path compare on Windows; nested worktrees; CI is Ubuntu-only). Approved shape is in `docs/plans/2026-08-19-checkpoint-actor-and-worktree-git-design.md`. If code reality contradicts that spec, report a plan mismatch rather than redesigning.

## Global Constraints

- Spec is `docs/plans/2026-08-19-checkpoint-actor-and-worktree-git-design.md`. Treat Key Decisions 1–13 as final.
- TDD is mandatory: failing test first, minimum code, restore green, then commit. Do not write G1 tests during Task 1.
- No new MCP tools. `CheckpointArgs` and the checkpoint inputSchema gain no actor fields.
- `src/server.ts` is the only module allowed to inspect MCP request context or protocol-era metadata.
- Capture is best-effort: actor or worktree detection failure never fails the save.
- Two try/catch blocks at save: resolve throw → workspace git, no `git.worktree`; assemble throw → omit `actor`, keep already-captured git.
- Probe common-dir at caller cwd. Query git at `--show-toplevel` of that cwd when common-dirs match. Never query branch/commit/files in `process.cwd()` itself.
- `git.worktree` is an absolute host path when query toplevel differs from the workspace. Omit when they are the same.
- Path compare: `realpath` when possible, else `normalizePathKeyForSafetyCheck` (`src/workspace.ts:165`). Do not invent a third helper.
- Compact recall strips `actor`. Compact+file copies `branch`/`commit`/`files` onto a **new** git object and must not mutate the day-cache `git`. `git.worktree` prints only in full recall.
- Do not index `actor` or `git.worktree` in `src/ranking.ts` `toSearchDocument`.
- Briefs unchanged. No version bump. Changelog `[Unreleased]` only (Task 1: Fixed; Task 2: Added).
- Tests contain no comments. Production comments only for non-obvious external constraints.
- Git worktree fixtures live in `tmpdir()`. `afterEach` must `git worktree remove` / `rm`.
- Checkpoint tool description is 1379 characters today. The auto-capture sentence tweak must stay ≤ 2000 (`tests/server.test.ts`).
- Stay under the documented checkpoint-save target of 50ms. No retries.

---

## File Structure

| File | After this plan |
|---|---|
| `src/types.ts` | `GitContext.worktree?` (Task 1); `Actor`, `ObservedActor`, `Checkpoint.actor?` (Task 2) |
| `src/git.ts` | `resolveGitCaptureCwd` (Task 1); `getGitIdentity` (Task 2); `runGit` stays private; `getGitContext(cwd?)` queries unchanged |
| `src/checkpoints.ts` | Capture/query cwd + format/parse `worktree` + attach-when-worktree (Task 1); `assembleActor`, `normalizeActor`, `formatActorLine`, extra `observed` arg, identity injection (Task 2) |
| `src/recall.ts` | Compact `presentCheckpoint` returns a new git object without `worktree` (Task 1); also strip `actor` (Task 2) |
| `src/handlers/recall.ts` | `worktree:` on Git line when present (Task 1); `formatActorLine` (Task 2) |
| `src/handlers/checkpoint.ts` | No Task 1 edit. Task 2: `observed?` arg, `Actor:` line, ignore stuffed keys |
| `src/server.ts` | Task 2: export `DEFAULT_SESSION_KEY`; `extractObservedActor`; pass into `handleCheckpoint` |
| `src/tools.ts` | Task 2 only: extend auto-capture sentence; **no schema properties** |
| `tests/preload.ts` | Task 2: delete `GOLDFISH_HARNESS` / `GOLDFISH_MODEL` / `GOLDFISH_SESSION` |
| `tests/test-isolation.test.ts` | Task 2: assert those env keys are unset |
| Docs | `CHANGELOG.md` Unreleased; `docs/IMPLEMENTATION.md` and `README.md` YAML examples |

Do not create `src/actor.ts`. Do not change skills unless `bun run sync:agent-skills` is required after the tools.ts sentence (today `src/tools.ts` is the only hit for "Automatically captures git").

---

## Verification Strategy

**Project source of truth:** `AGENTS.md` testing table, `package.json` scripts, `tests/preload.ts`, `tests/test-isolation.test.ts`.

**Worker red/green scope:** Named single-file commands below. Watch the new test fail, then pass.

**Worker ceiling:** Targeted files plus `bun run typecheck`. Workers do not run the full suite.

**Worker gate invariant:** New tests prove the named behavior. Existing tests in the same file stay green.

**Lead affected-change scope:** After each task: `bun test git checkpoints handlers recall server` plus `bun run typecheck`.

**Branch gate:** `bun test` and `bun run typecheck` before handoff.

**Replay/metric evidence:** Checkpoint save stays under 50ms. Report-only unless a new test exceeds it by a wide margin.

**Escalation triggers:** Protocol/envelope changes (`tests/protocol-compatibility.test.ts`, `tests/server.test.ts`). Path-compare changes (`tests/git.test.ts`, `tests/workspace.test.ts`).

**Assigned verification failure:** Workers stop and report when assigned verification fails, unless this plan says to update that gate.

**Verification ledger:** Record invariant, command, scope, commit SHA, result, timestamp.

---

## Parallel Execution Contract

| Task | Parallel batch | File ownership | Serialization required | Dependency reason |
|---|---|---|---|---|
| Task 1: G2 worktree-accurate git | None - serial | `src/git.ts`, `src/types.ts` (`GitContext.worktree` only), `src/checkpoints.ts` (capture/format/parse/attach worktree), `src/recall.ts` (compact git copy), `src/handlers/recall.ts` (Git line), `tests/git.test.ts`, `tests/checkpoints.test.ts` (G2 cases), `tests/recall.test.ts` (compact+file worktree), `CHANGELOG.md` Fixed, `docs/IMPLEMENTATION.md`, `README.md` (`git.worktree` example) | Yes | Not applicable as a batch — must land first; Task 2 uses the G2 query cwd for git identity. |
| Task 2: G1 actor block | None - serial | `src/types.ts` (`Actor`, `ObservedActor`, `Checkpoint.actor`), `src/git.ts` (`getGitIdentity` only), `src/checkpoints.ts` (assemble/format/parse actor, `formatActorLine`, extra arg, identity stubs), `src/handlers/checkpoint.ts`, `src/handlers/recall.ts` (Actor line), `src/recall.ts` (strip actor), `src/server.ts`, `src/tools.ts`, `tests/preload.ts`, `tests/test-isolation.test.ts`, `tests/checkpoints.test.ts` (actor cases), `tests/handlers.test.ts`, `tests/recall.test.ts` (compact actor), `tests/server.test.ts`, `tests/protocol-compatibility.test.ts`, existing `beforeEach` identity stubs, `CHANGELOG.md` Added, docs actor example | Yes | Depends on Task 1. Both edit `formatCheckpoint` / `parseCheckpointFile` / `saveCheckpoint`. `git_user` / `git_email` use the G2 query cwd. |

Completion: `serial-worker-commit` after assigned verification passes.

---

### Task 1: G2 worktree-accurate git

**Files:**
- Modify: `src/git.ts:16-76` (add `resolveGitCaptureCwd`; keep `runGit` private; do not change `getGitContext` file/branch/commit queries)
- Modify: `src/types.ts:138-142` (`GitContext.worktree?: string`)
- Modify: `src/checkpoints.ts:20-42` (`getCallerCwd?` on `CheckpointDependencies`)
- Modify: `src/checkpoints.ts:111-121` (emit `git.worktree`)
- Modify: `src/checkpoints.ts:226-235` (`normalizeGit` copies `worktree`)
- Modify: `src/checkpoints.ts:380-414` (resolve capture cwd at the current `getGitContext` site ~386; attach `checkpoint.git` at ~412-414 when `branch` **or** `commit` **or** `files` **or** `worktree`)
- Modify: `src/recall.ts:460-489` (`presentCheckpoint`: when `!full` and `options.file && git`, return a **new** `{ branch, commit, files }` object — never `delete git.worktree`)
- Modify: `src/handlers/recall.ts:112-120` (append `, worktree: ${path}` when `git.worktree` is set; full-mode only because compact stripped it)
- Test: `tests/git.test.ts`, `tests/checkpoints.test.ts`, `tests/recall.test.ts`
- Modify: `CHANGELOG.md` (`[Unreleased]` **Fixed**), `docs/IMPLEMENTATION.md`, `README.md` (absolute `git.worktree` example)

**Interfaces:**
- Consumes: existing `getGitContext(cwd?)`, `runGit`, `normalizePathKeyForSafetyCheck`, `saveCheckpoint(input)`
- Produces: `resolveGitCaptureCwd(workspacePath, callerCwd?) => Promise<{ cwd: string; worktree?: string }>`. `GitContext.worktree?`. `saveCheckpoint` still one argument.

**Contract inputs:** Spec Key Decisions 8–11, 13 (git parts). Worked cases table in the spec.

**File ownership:** copy from Parallel Execution Contract Task 1 row.

**Serialization required:** Yes

**Dependency reason:** Must land first. Task 2 uses the G2 query cwd.

**What to build:** When the caller cwd shares `--git-common-dir` with the workspace, query git at that cwd's `--show-toplevel`. Record absolute `git.worktree` if that toplevel differs from the workspace. Keep writing files under workspace `.memories/`. Subdirectory `src/` must keep root-relative `git.files` and omit `git.worktree`.

**Approach:**
1. Write the failing tests listed below. Confirm they fail for the right reason.
2. Implement `resolveGitCaptureCwd` per spec algorithm (relative common-dir joined onto command cwd; `realpath` then `normalizePathKeyForSafetyCheck`; any lookup failure → `{ cwd: workspacePath }`).
3. In `saveCheckpoint`, one try/catch around resolve only. On throw, `getGitContext(projectPath)` and no `worktree`. Then `getGitContext(capture.cwd)` and set `gitContext.worktree` when present.
4. Do **not** assign `checkpoint.git` at line 386. The object does not exist yet. Change only the attach condition at 412-414.
5. Log `git.capture cwd=… workspace=…` only when query cwd differs from workspace. Logging must not throw.
6. `presentCheckpoint` must copy git. Named test: compact+file then `full: true` in the same process still has `git.worktree`.
7. Existing test `passes workspace path to getGitContext` (`tests/checkpoints.test.ts:1085`) stays valid for temp workspaces that are a different git repo from `process.cwd()`.
8. File-level `beforeEach` stubs `getGitContext` (`tests/checkpoints.test.ts:57-59` and the same pattern in handlers/recall/server). Real-git G2 tests must restore the real `getGitContext` inside the test (not merge `getCallerCwd` on top of the stub).
9. Do not edit `src/handlers/checkpoint.ts`. The Branch line already prints `checkpoint.git`. Prove the worktree branch on `saveCheckpoint`'s return value.
10. Do not index `git.worktree`.

**First failing tests (names are the titles):**
1. `tests/git.test.ts`: `resolveGitCaptureCwd uses the worktree toplevel when caller cwd is a same-repo worktree`
2. `tests/git.test.ts`: `caller cwd main/src with workspace main keeps query cwd at toplevel and omits worktree`
3. `tests/git.test.ts`: `mixed-separator path keys compare equal`
4. `tests/git.test.ts`: `nested git worktree add inside the main tree records git.worktree and the worktree branch` (or cover nested in the first helper test plus a save test)
5. `tests/git.test.ts`: `different-repo caller cwd uses the workspace path and omits git.worktree`
6. `tests/git.test.ts`: `git-common-dir failure falls back to the workspace path`
7. `tests/checkpoints.test.ts`: `saveCheckpoint from a worktree writes under the main workspace .memories/ with the worktree branch`
8. `tests/checkpoints.test.ts`: `saveCheckpoint does not throw when resolveGitCaptureCwd throws`
9. `tests/checkpoints.test.ts`: `formatCheckpoint + parseCheckpointFile round-trips a git object that has only worktree`
10. `tests/checkpoints.test.ts`: old file without `git.worktree` still parses
11. `tests/recall.test.ts`: `compact file-filtered recall then full recall in the same process still has git.worktree`
12. `tests/recall.test.ts`: compact+file omits `git.worktree` from the presented checkpoint

**Acceptance criteria:**
- [ ] All named G2 behavior tests pass
- [ ] `passes workspace path to getGitContext` still passes
- [ ] Handler Branch line needs no edit and shows captured branch via `checkpoint.git`
- [ ] Compact+file does not mutate the day-cache git object
- [ ] Changelog `[Unreleased]` **Fixed**; YAML examples show an absolute `git.worktree`
- [ ] `bun test git checkpoints recall` and `bun run typecheck` pass
- [ ] Worker-scope verification passes and the change is committed (`serial-worker-commit`)

---

### Task 2: G1 actor block

**Files:**
- Modify: `src/types.ts` (`Actor`, `ObservedActor`, `Checkpoint.actor?`)
- Modify: `src/git.ts` (`getGitIdentity` via private `runGit(['config', 'user.name'|'user.email'], cwd)`)
- Modify: `src/checkpoints.ts` (`assembleActor`, `normalizeActor`, `formatActorLine`; format/parse/json-parse; `saveCheckpoint(input, observed?)`; `CheckpointDependencies.getOsUsername?` / `getGitIdentity?`; second try/catch)
- Modify: `src/handlers/checkpoint.ts:64` (`handleCheckpoint(args, observed?)`); Actor line after Branch/Time; do not read `args.actor` / `args.harness`
- Modify: `src/handlers/recall.ts:46-126` (print `formatActorLine` in full mode)
- Modify: `src/recall.ts:473-486` (strip `actor` in the compact destructure)
- Modify: `src/server.ts:27` (export `DEFAULT_SESSION_KEY`); `src/server.ts:198-215` (`extractObservedActor(ctx, server)` → `handleCheckpoint(args, observed)`)
- Modify: `src/tools.ts:30` (append `and observed actor identity` to the auto-capture sentence; no schema keys)
- Modify: `tests/preload.ts` (delete `GOLDFISH_HARNESS`, `GOLDFISH_MODEL`, `GOLDFISH_SESSION`)
- Modify: `tests/test-isolation.test.ts` (assert those keys are unset)
- Modify: existing `beforeEach` stubs in `tests/checkpoints.test.ts`, `tests/handlers.test.ts`, `tests/recall.test.ts`, `tests/server.test.ts` — default `getOsUsername: () => undefined` and `getGitIdentity: async () => ({})`
- Test: actor round-trip, empty omit, stuffed keys, env override, `'default'` session omit, both MCP eras
- Modify: `CHANGELOG.md` **Added**; docs actor YAML example

**Interfaces:**
- Consumes: Task 1 query cwd; `ctx.sessionId`; envelope / `getClientVersion()?.name` inside `src/server.ts` only
- Produces: `ObservedActor { harness?: string; session?: string }`; `Actor`; `formatActorLine(actor) => string | undefined`; `handleCheckpoint(args, observed?)`; `saveCheckpoint(input, observed?)`

**Contract inputs:** Spec Key Decisions 1–7, 11–13. Field priority table. Labeled Actor line. Both MCP eras are merge gates.

**File ownership:** copy from Parallel Execution Contract Task 2 row.

**Serialization required:** Yes

**Dependency reason:** Depends on Task 1 query cwd for `git_user` / `git_email`. Shared format/parse/save.

**What to build:** Nested server-observed `actor` block. Env beats MCP. No tool args. Compact recall omits actor. Save and full recall share `formatActorLine`.

**Approach:**
1. Land preload isolation **first** in this task (with the isolation assertion) before assembly reads env.
2. Default identity stubs so existing saves do not persist the host OS/git user.
3. `formatActorLine`: labeled `key=value` in order `harness` `model` `session` `user` `git_user` `git_email`. Omit missing keys. Treat `git_user` and `git_email` independently (print whichever exist). Shared by checkpoint handler and full recall.
4. `extractObservedActor` in `src/server.ts` only. Envelope-first on 2026-07-28 (`CLIENT_INFO_META_KEY` / nested `name` — pin with the modern test). Legacy: `server.getClientVersion()?.name`. Omit session if missing or `'default'`.
5. Field priority: `GOLDFISH_HARNESS` > observed.harness; `GOLDFISH_MODEL` only; `GOLDFISH_SESSION` > observed.session (still omit `'default'` after override); OS username; git config in **query** cwd.
6. Second try/catch around assemble only. Throw omits actor and **keeps** Task 1 git (including `worktree`). Named test must assert that.
7. Stuffed keys: `handleCheckpoint({ ..., actor: { harness: 'liar' } } as any)` does not persist `liar`.
8. Modern harness test: spawned `connectModernServer` already uses `Client({ name: 'goldfish-modern-test-client' })` and a whitelist `env` (`tests/protocol-compatibility.test.ts:34-58`). Add an `it` that checkpoints and expects `actor.harness === 'goldfish-modern-test-client'`. Do not pass `GOLDFISH_HARNESS`. The child has a real OS user — assert harness, not actor-equality.
9. Legacy harness test: existing InMemoryTransport `versionNegotiation: { mode: 'legacy' }` in `tests/server.test.ts`. Pin `getClientVersion()` path.
10. Merge is blocked until the modern test pins the envelope slot. Do not ship `getClientVersion()` as the sole path.
11. Do not add actor to `toSearchDocument`.
12. Optional tools.ts sentence only if the 2k test stays green (it will; 1379 + the clause fits).

**First failing tests:**
1. `tests/test-isolation.test.ts`: `GOLDFISH_HARNESS`, `GOLDFISH_MODEL`, and `GOLDFISH_SESSION` are unset by preload
2. `tests/checkpoints.test.ts`: `formatCheckpoint + parseCheckpointFile round-trips actor`
3. `tests/checkpoints.test.ts`: `saveCheckpoint omits actor when env, OS user, and git identity are empty`
4. `tests/checkpoints.test.ts`: `saveCheckpoint does not throw when actor assembly throws and still records worktree git`
5. `tests/checkpoints.test.ts`: old file without actor still parses; unknown actor keys dropped
6. `tests/handlers.test.ts`: `handleCheckpoint ignores stuffed actor keys on the tool call`
7. `tests/handlers.test.ts`: `Actor:` line present when actor is set; uses `formatActorLine`
8. `tests/recall.test.ts`: full includes actor; compact omits actor
9. `tests/server.test.ts`: `legacy InMemoryTransport Client({ name }) records harness via getClientVersion()`
10. `tests/server.test.ts`: env `GOLDFISH_HARNESS` overrides MCP-observed harness; `'default'` session omitted
11. `tests/protocol-compatibility.test.ts`: `modern spawned 2026-07-28 Client({ name }) records harness from the envelope`
12. `tests/server.test.ts`: tool description ≤ 2000; `CheckpointArgs` / schema have no actor properties

**Acceptance criteria:**
- [ ] All named G1 behavior tests pass
- [ ] Handlers do not import MCP ctx types
- [ ] Tool schema unchanged except the auto-capture sentence
- [ ] Compact recall omits actor; full recall prints `formatActorLine`
- [ ] Both MCP eras pin harness
- [ ] Changelog `[Unreleased]` **Added**; docs show `actor` example
- [ ] `bun test git checkpoints handlers recall server protocol-compatibility test-isolation` and `bun run typecheck` pass
- [ ] Worker-scope verification passes and the change is committed (`serial-worker-commit`)

---

## Lead after both tasks

- Branch gate: `bun test` and `bun run typecheck`
- Do not bump version surfaces
- Do not tag, push, or release without separate user approval
