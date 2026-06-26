# Registry + Parent-Walk Workspace Recovery

**Date:** 2026-06-26
**Status:** Proposed (revised after Codex second-opinion review, 2026-06-26)

## Context

Goldfish resolves the project workspace (the directory holding `.memories/`)
through a four-step chain, evaluated in `hydrateWorkspaceArguments`
(`src/server.ts`) and `resolveWorkspaceWithSource` (`src/workspace.ts`):

1. explicit `workspace` tool argument
2. `GOLDFISH_WORKSPACE` env var
3. MCP `roots/list` (queried lazily on the first workspace-aware tool call)
4. `process.cwd()`

Steps 1–3 work well on harnesses that supply them: Claude Code, VS Code with
GitHub Copilot, Codex Desktop, and Cursor when goldfish is registered as a
**user-level** MCP server. The breakdown is step 3 on **Cursor plugin
installs**.

### Evidence (gathered 2026-06-26)

In a single Cursor window with `/Users/murphy/source/goldfish` open:

- The **goldfish plugin** server launched with `process.cwd()=/Users/murphy`
  (home — Cursor spawns plugin servers from the Electron process cwd, not the
  open folder). `roots/list` returned nothing usable and goldfish refused:
  `Refusing to use home directory (/Users/murphy) as workspace from process
  cwd`. Repeated `roots/list` retries (shipped in 7.2.1) all fail in ~2ms —
  the `roots` capability is never advertised to the plugin, so the SDK rejects
  with "Method not found" without a roundtrip.
- The **Miller** server (user-level `~/.cursor/mcp.json`, same window) logged
  `Binding primary workspace to /Users/murphy/source/goldfish (source=Roots)`
  and indexed 3792 symbols. Cursor advertised `roots` to the user-config
  server but not to the plugin server.

The material difference is **plugin vs. user-config**: Cursor advertises MCP
`roots` to user-config MCP servers but not to plugin-launched ones. This is a
client behavior goldfish cannot change from inside the plugin. The 7.2.1 fix
(retry empty/failed roots) is necessary but insufficient for plugin installs —
when the capability is never advertised, there is no root to recover.

## Problem

On Cursor plugin installs (and any other harness that spawns the server with
an unsafe cwd and no roots), the resolution chain falls through to
`process.cwd()`, hits the unsafe-cwd guard (`getUnsafeCwdWorkspaceReason`), and
hard-refuses. The agent sees a refusal on every `checkpoint`/`recall`/`brief`
call with no recovery path short of the user reconfiguring their client or
setting `GOLDFISH_WORKSPACE`.

The refusal is correct — we must not write `.memories/` into home or `/`. But
"correct and unusable" is a poor outcome when goldfish already holds evidence
that could resolve the workspace: the cross-project registry
(`~/.goldfish/registry.json`) and on-disk markers (`.memories/`, `.git/`).

A second, latent problem: even when cwd is **safe**, a cwd that is a
*subdirectory* of a project (Cursor worktrees, nested packages, `cd` into
`src/`) is accepted as-is and goldfish writes `.memories/` into the subdir
rather than the project root. The unsafe-cwd guard does not catch this because
subdirs of home are not flagged unsafe.

## Goal

Resolve the correct project root on more harnesses **without** client
reconfiguration, while staying evidence-based and never fabricating a
workspace from nothing. Keep the existing successful resolution paths
unchanged; augment the cwd fallback so that (a) a cwd inside a known/marked
project resolves to that project's root, and (b) the refusal path gains
recovery attempts drawn from existing data.

## Non-Goals

- No new manual `register` step. Registration stays automatic on checkpoint
  save (`checkpoints.ts:registerProject`).
- No requirement that agents pass `workspace` on every call. (Considered and
  rejected: agents would pass wrong paths and scatter `.memories/` across
  `/tmp`, `~`, and arbitrary cwd-derived locations. The resolution chain
  exists precisely so agents don't have to get the path right each call.)
- No weakening of the unsafe-cwd guard for the empty-evidence case. First use
  on a machine with no registered projects, no on-disk markers, no roots, and
  an unsafe cwd still refuses with guidance.
- No replacement of `roots/list`. Roots stays higher in the chain and more
  authoritative than registry/walk inference.

## Design

### Resolution chain (revised)

Evaluated in order; first hit wins.

1. explicit `workspace` arg (non-`current`) — unchanged
2. `GOLDFISH_WORKSPACE` env — unchanged
3. MCP `roots/list` (lazy, retried on empty/failure per 7.2.1) — unchanged
4. **cwd fallback — recover before accepting.** When the chain reaches cwd
   (whether safe or unsafe), gather two recovery candidates *before* accepting cwd:
   - **4a. registry-ancestor:** if `cwd` or an ancestor directory is a
     registered project with a live `.memories/` → candidate that project's path.
   - **5. parent walk:** walk up from `cwd` (inclusive) looking for a
     directory containing `.memories/` or `.git/`, **skipping any candidate
     that `getUnsafeCwdWorkspaceReason` flags as unsafe**; first safe match is
     the parent-walk candidate.
   - if both 4a and 5 resolved → choose the deeper candidate; if they are the
     same on-disk path, keep the `registry` source for observability
   - if only one resolved → use it
   - else if cwd is safe → accept cwd (unchanged behavior)
   - else (cwd is unsafe, 4a/5 did not resolve):
     - **4b. single-registered recovery (read-only tools only):** if exactly
       one project is registered with a live `.memories/` **and** the calling
       tool is `recall` → use it. For mutating tools (`checkpoint`, `brief`),
       skip 4b and fall through to refusal-with-list.
     - if 4b resolved → use it
     - else → unsafe-cwd refusal with a sharpened message

The key change from the first draft: **4a and 5 run on every cwd fallback,
not only on unsafe cwd, and the nearest evidence wins.** This is what makes a
safe subdir of a project resolve to the project root instead of writing
`.memories/` into the subdir, while still letting a nested unregistered repo
with its own `.git` or `.memories/` beat an outer registered ancestor. 4b
remains gated to unsafe cwd, because it is the weakest-evidence path and the
only one that picks a directory the agent is not currently inside.

### Behavior change to call out

For a cwd that is a safe subdirectory of a project containing `.memories/` or
`.git/`, goldfish previously wrote `.memories/` into the subdir; it now
resolves to the enclosing project root. Nested repos resolve to the
*innermost* repo containing cwd (first match wins walking up), which is the
desired scoping. This is an intentional fix, not a regression — but it is a
behavior change and must be covered by tests and noted in the changelog.

### Where the logic lives (no module cycle)

`registry.ts` already imports from `workspace.ts` (`registry.ts:13`), so the
recovery orchestrator must **not** live in `workspace.ts` or it creates a
cycle. Split as follows:

- `src/workspace.ts`: a new **pure** helper `parentWalkWorkspace(cwd, {
  isUnsafeDir }): Promise<RecoveredWorkspace | undefined>` that performs only
  the parent walk (5) — fs `stat` plus the existing
  `getUnsafeCwdWorkspaceReason` for the skip check. **No registry import**, so
  no cycle. Pure + injectable `isUnsafeDir` for testability. Returns
  `{ path, source: 'walk' }` or `undefined`.
- `src/workspace-recovery.ts` (**new module**): the orchestrator
  `recoverWorkspace({ cwd, tool, registryReader })` that runs 4a (calls the
  injected registry reader), then `parentWalkWorkspace` (5), then 4b
  (single-registered, gated on `tool === 'recall'`). Imports from both
  `workspace.ts` and `registry.ts` without creating a cycle (neither imports
  it back). Returns `{ path, source: 'registry' | 'walk' }` or `undefined`.
- `src/workspace.ts`: extend `WorkspaceSource` to include `'registry'` and
  `'walk'`.
- `src/server.ts`: in `hydrateWorkspaceArguments`, when the chain reaches the
  cwd fallback, call `recoverWorkspace` (passing the tool name and
  `listRegisteredProjects` as the reader). If it returns a path, use it; if
  not, apply the existing safe-cwd-accept / unsafe-cwd-refuse logic.

The registry reader is **injected**, so tests can pass a stub and never touch
real `~/.goldfish/registry.json` state.

### Recovery rule 4a — "cwd or an ancestor is registered"

The registry stores paths via `normalizePath` (`registry.ts:22`), which does
**not** canonicalize symlinks (see Path Handling below). Comparison uses
`fs.realpath` on both sides before the prefix check:

```
const c = realpath(cwd);
const r = realpath(registered.path);
c === r  ||  c.startsWith(r + '/')
```

Walks up to the registered root, not past it. `listRegisteredProjects`
already filters entries whose `.memories/` is gone, so 4a never surfaces a
stale registration.

### Recovery rule 4b — "exactly one registered project, recall only"

When cwd is unsafe and not under any registered project and no parent walk
match was found, but the machine has exactly one live registered project,
default to it — **only for `recall`**. Rationale: a single registered project
is a usable prior for *where to read memories from*, but not for *where to
write new ones*. A wrong-path `checkpoint`/`brief` is a silent data-placement
bug (the exact class the unsafe-cwd guard exists to prevent); a wrong-path
`recall` merely returns suboptimal results and is recoverable on the next
call. For mutating tools, refuse-with-list so the agent passes an explicit
`workspace:`.

This is the one place the design chooses for the user. It is bounded: exactly
one candidate, only `recall`, only as a fallback below roots/env/explicit/4a/5.
If it ever misfires, the agent can override with an explicit `workspace` arg.

### Recovery rule 5 — parent walk

Walk upward from `cwd` (inclusive) to filesystem root. At each level, check for
`.memories/` (directory) or `.git/` (file or directory). **Skip any candidate
that `getUnsafeCwdWorkspaceReason` flags as unsafe** (home, `/`, Windows system
dirs) — do not match there, keep walking. First **safe** match wins and that
directory becomes the workspace. Bounded by the filesystem root.

`.git` is included because first-use in a git project that has not yet saved a
checkpoint (so no `.memories/`) should resolve to the repo root rather than
refuse. Prefer `.memories/` when both exist at the same level (check
`.memories/` before `.git/` at each level). `.git` alone is a first-use
fallback; it is real on-disk evidence, not fabrication.

Skipping unsafe dirs is mandatory: a user who `git init`s their home dir for
dotfile tracking has `$HOME/.git`, and the walk must **not** match home — that
would re-introduce the v1 silent-home-write bug. The skip check reuses the
existing `getUnsafeCwdWorkspaceReason` guard, so "unsafe" stays defined in one
place.

### Path Handling (symlinks + Windows)

The first draft wrongly claimed `path.resolve` canonicalizes symlinks. It does
not — only `fs.realpath` does. macOS exposes `/var/folders/...` (via
`TMPDIR`) while the real path is `/private/var/folders/...`; `path.resolve`
leaves both as-is, so they would not match. Rules:

- For equality and ancestor-prefix checks (4a), apply `fs.realpath` to both
  `cwd` and the registered path before comparing. Wrap in try/catch — if
  `realpath` fails (broken symlink, permission), fall back to the existing
  `pathsEqualForSafetyCheck` (`workspace.ts:152`), which handles Windows
  drive-case and trailing-slash parity.
- For the parent walk (5), walk using `path.dirname` on the raw cwd (do not
  `realpath` the whole chain up front — that resolves through symlinks at
  every level and can change which `.git` is found). Compare each candidate
  with `pathsEqualForSafetyCheck` against the unsafe list.
- Windows drive-case: rely on `pathsEqualForSafetyCheck`'s
  `normalizeWindowsPathKey` (lowercases the drive) rather than raw `===`.

### Refusal message (sharpened)

When recovery fails and the refusal fires, the message becomes:

> Refusing to use {reason} ({path}) as workspace from process cwd. Set
> `GOLDFISH_WORKSPACE` to your project path, pass `workspace:` to a tool call,
> or open a project folder in your client.
> {if registry non-empty} Known projects: /path/a, /path/b — pass one as
> `workspace:`.

The "Known projects" line appears whenever `listRegisteredProjects()` returns
a non-empty list — including the mutating-tool 4b-skip case, where it is the
primary actionable guidance.

### Observability

`server.start` currently logs only the process cwd (`server.ts:202`). Add a
log line for the **effective** workspace and its source whenever recovery
fires (sources `'registry'`, `'walk'`, and the `'recall-only'` 4b path), so
misresolution is diagnosable in `~/.goldfish/logs/`. For the 4b recall auto-pick,
also surface the chosen workspace in the `recall` response text so the agent
can see that memories were read from a project it wasn't cwd'd into.

## Why This Shape

- **Strict superset on the success path.** Roots/env/explicit are untouched.
  Safe cwd with no enclosing markers still accepts cwd as before.
- **Fixes the latent subdir misplacement.** Running 4a/5 on every cwd fallback
  means a cwd inside a project resolves to that project, instead of writing
  `.memories/` into a subdir.
- **Evidence-based (project principle).** Registry recovery fires only when
  prior usage exists; parent walk fires only on real on-disk markers. Nothing
  is invented; first-use with no markers still refuses.
- **Read/write asymmetry.** 4b's weak evidence (one historical project) is
  acceptable for reading memories, unacceptable for writing them. This keeps
  the evidence bar high exactly where data placement is irreversible.
- **Client-agnostic.** Does not depend on roots being advertised. Behaves the
  same in Cursor-plugin, Cursor-user-level, Codex, VS Code, and CLI.
- **Keeps first-use honest.** Empty registry + no markers + no roots + unsafe
  cwd → refusal with guidance. No silent home writes (the original v1 bug),
  and the walk's unsafe-dir skip closes the `$HOME/.git` regression window.
- **Reuses existing, tested primitives.** `listRegisteredProjects` (filters
  stale), `getUnsafeCwdWorkspaceReason` (classifies unsafe), and
  `pathsEqualForSafetyCheck` (cross-platform parity) already exist.
- **No module cycle.** Recovery orchestration lives in a new module that
  imports both `workspace.ts` and `registry.ts`; `workspace.ts` gains only a
  registry-free pure helper.

## Edge Cases

- **Multiple registered projects, cwd under none, unsafe cwd** → 4b does not
  apply (more than one); refuse with the list. For `recall`, this also refuses
  rather than guess among several — the "exactly one" rule stops at one.
- **Registered project whose `.memories/` was deleted** → `listRegisteredProjects`
  filters it, so 4a/4b never surface it. Parent walk 5 could still find its
  `.git`, which is acceptable (the repo is still there and is real evidence).
- **`$HOME/.git` or `$HOME/.memories` exists** → walk skips home (unsafe), does
  not match there, continues up to `/`, no match → refuses. Regression guard
  for the v1 silent-home-write bug.
- **4b single-registered auto-pick surprise** → bounded to `recall` only; for
  `checkpoint`/`brief` the agent gets a refuse-with-list and must pass
  `workspace:` explicitly. Accepted trade-off for the "just works on a
  one-project machine" read-side win.
- **Symlinks / macOS `/private` prefix** → `fs.realpath` on both sides for 4a;
  `pathsEqualForSafetyCheck` fallback if `realpath` throws. Walk uses raw
  `path.dirname` chain with `pathsEqualForSafetyCheck` against the unsafe list.
- **Walk performance** → bounded by directory depth from cwd to root
  (typically < 20), one `stat` per level for two targets. Negligible.
- **Concurrency** → recovery is read-only (registry read + stat). No locking
  needed beyond the existing atomic registry read.
- **`workspace: 'all'` (cross-project recall)** → unaffected. The recovery
  path only fires for per-tool workspace hydration, not the `'all'` fan-out
  which reads the registry directly. Test guards that `'all'` stays
  cross-project.
- **Roots arrive late, after a recovery already resolved** → recovery result
  is used for that call; the roots cache is still populated for subsequent
  calls. No correctness issue, but the first call may resolve via
  registry/walk while later ones resolve via roots. Acceptable (both point at
  the same project in the common case); observability log makes it visible.

## Testing (TDD — tests first)

New tests in `tests/workspace.test.ts`, `tests/workspace-recovery.test.ts`
(new), and `tests/server.test.ts`. Server/recovery tests must run with an
isolated `GOLDFISH_HOME` (temp dir) so real user registry state cannot affect
results.

1. **4a cwd under a registered project** → resolves to the registered root
   (cwd is a subdirectory). Covers deepest-registered-ancestor when multiple
   ancestors are registered.
2. **4a safe cwd subdir, not registered, parent has `.memories/`** → resolves
   to parent (the finding-1 fix; previously would write into subdir).
3. **4a/5 nested repos** → cwd in inner repo resolves to inner repo, not
   outer (first match wins walking up).
4. **4b exactly one registered, unsafe cwd, `recall`** → resolves to that
   project.
5. **4b exactly one registered, unsafe cwd, `checkpoint`** → refuses;
   message lists the project. Mutation guard.
6. **4b two registered, unsafe cwd, `recall`** → refuses; message lists both.
7. **5 parent walk finds `.memories/`** (cwd in a subdirectory of a project
   with `.memories/` but not registered) → resolves to project root.
8. **5 parent walk finds `.git/`** (first use, no `.memories/`, has `.git`)
   → resolves to repo root.
9. **5 parent walk from home, `$HOME/.git` present** → skips home, refuses
   (no match). Regression guard for silent-home-write.
10. **5 parent walk from home, no markers** → refuses (no match).
11. **First-use refusal** (empty registry, no markers, unsafe cwd) → refuses
    with guidance; message has no "Known projects" line. Regression guard.
12. **macOS `/private` symlink parity** → cwd via `/var/folders/...` matches a
    registered path via `/private/var/folders/...` (via `fs.realpath`).
13. **Windows drive-case parity** → `C:\Proj` vs `c:\proj` match (via
    `pathsEqualForSafetyCheck`).
14. **`workspace: 'all'` stays cross-project** → recovery does not narrow the
    `'all'` fan-out to a single project.
15. **Roots arrive after recovery** → first call resolves via recovery, roots
    cache populated; second call (roots now non-empty) resolves via roots to
    the same project.
16. **No regression**: all existing roots/env/explicit/cwd tests stay green;
    recovery must not fire when a higher step already resolved. Safe cwd with
    no enclosing markers still accepts cwd.
17. **Isolation**: server/recovery tests run with `GOLDFISH_HOME` pointed at a
    temp dir; verify no read of real `~/.goldfish/registry.json`.

Every feature has a test. No exceptions.

## Scope

- `src/workspace.ts`: ~40 lines (`parentWalkWorkspace` pure helper,
  `WorkspaceSource` extension).
- `src/workspace-recovery.ts` (new): ~70 lines (orchestrator: 4a, 5, 4b-gated,
  reader injection).
- `src/server.ts`: ~20 lines (call recovery in the cwd branch, sharpen
  message, observability log, effective-workspace log on start).
- `tests/`: ~200 lines (17 test cases above).
- Total: ~330 lines, single coherent unit, no subagents.

## Review Outcomes (Codex second opinion, 2026-06-26)

The first draft was reviewed by Codex (read-only second opinion). Five
findings, all verified against source; the revision incorporates them:

1. **4a/5 were unreachable for safe subdirs** — recovery was gated to unsafe
   cwd only, so `cwd=/repo/subdir` (safe) would still write `.memories/` into
   the subdir. **Fix:** 4a/5 now run on every cwd fallback before accepting
   cwd; 4b stays gated to unsafe cwd.
2. **4b could silently write to the wrong project** for `checkpoint`/`brief`.
   **Fix:** 4b is now `recall`-only; mutating tools refuse-with-list.
3. **Parent walk could accept home** if `$HOME/.git`/`$HOME/.memories` exists,
   re-introducing the v1 silent-home-write bug. **Fix:** walk skips any
   candidate flagged unsafe by `getUnsafeCwdWorkspaceReason`.
4. **Module cycle** — putting recovery in `workspace.ts` would cycle with
   `registry.ts`. **Fix:** orchestrator lives in a new `workspace-recovery.ts`
   that imports both; `workspace.ts` gains only a registry-free pure helper.
5. **Path-normalization claim was wrong** — `path.resolve` does not
   canonicalize symlinks. **Fix:** `fs.realpath` for 4a equality/prefix,
   `pathsEqualForSafetyCheck` fallback and for walk-level parity; Windows
   drive-case via `normalizeWindowsPathKey`.

Open questions resolved by the review: 4b → recall-only; `.git` alone →
first-use fallback after skipping unsafe dirs, prefer `.memories/`; 
observability → log effective recovered workspace + surface in `recall`
response.
