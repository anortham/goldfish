# Fail-closed workspace identity for user-level MCP registrations

**Date:** 2026-08-30

**Status:** Approved direction, implementation pending

## Problem

Goldfish stores checkpoints and briefs inside a project's `.memories/` directory. Every workspace-scoped tool must therefore know which project the caller means.

The current resolver accepts explicit tool arguments, `GOLDFISH_WORKSPACE`, legacy MCP Roots, process cwd, registry recovery, and parent-walk recovery. That fallback chain has repeatedly selected launcher directories instead of the open project. A live Codex plugin call resolved the installed plugin cache as the Goldfish workspace because the server started there and the packaged cache contained `.memories/`.

This failure is silent. Recall returns plausible but wrong history. Checkpoint and brief can write durable project data into a disposable plugin cache.

MCP `2026-07-28` removes protocol sessions and deprecates Roots. User-level registrations cannot set a different `GOLDFISH_WORKSPACE` for each open project. Server-local `activate_workspace` state would therefore depend on transport behavior that the protocol no longer guarantees.

## Decision

Goldfish will require a verified workspace identity for every workspace-scoped tool call.

Accepted identity sources, in precedence order:

1. An explicit host-native absolute `workspace` path in the tool arguments.
2. A fixed host-native absolute `GOLDFISH_WORKSPACE` configured for that server process.
3. A valid legacy MCP Roots response while Goldfish supports pre-`2026-07-28` clients.
4. The special value `workspace: "all"` for recall only.

No other source authorizes a workspace.

Process cwd, the cross-project registry, `.git`, and `.memories` parent walking may provide candidate paths in an error message. They must not select a workspace or permit a read or write.

`workspace: "current"`, an omitted workspace, and relative paths are unbound unless a fixed environment value or legacy Roots supplies the absolute path. The path must use the server host's path syntax. A Windows path sent to a POSIX server, or a POSIX path sent to a Windows server, is not absolute for that host and is rejected.

Every accepted source passes the existing broad-directory safety policy. Filesystem roots, home directories, Windows system directories, unexpanded variables, home shortcuts, drive-relative paths, and paths containing unresolved `..` segments are rejected even when explicit.

## Rejected approaches

### Server-local activation

An `activate_workspace` tool that changes in-memory server state makes the caller depend on one stdio process and does not carry across the transport-independent MCP contract. MCP `2026-07-28` removes protocol sessions. An explicit state handle would remain valid only if every later call carried it, which adds lookup and lifecycle complexity without improving on an absolute workspace argument. Even on long-lived stdio, activation cannot make a wrong path more correct.

### More cwd and registry recovery

Launcher cwd is not project identity. Plugin caches, home directories, editor installation folders, and arbitrary shells can all look project-like. The registry records known projects, not the project targeted by the current conversation.

### Roots as the primary solution

Roots has limited client support, Codex plugin MCP clients do not currently advertise it, and MCP `2026-07-28` deprecates it. Goldfish will retain the working legacy path only for compatibility.

### Waiting for host-specific fixes

Codex or Cursor may eventually inject a trustworthy per-request project path. Goldfish can accept such a signal after it exists and has a tested contract. User data safety cannot depend on that future work.

## Architecture quality

**Affected modules:** `src/server.ts`, `src/workspace.ts`, `src/workspace-recovery.ts`, `src/tools.ts`, the workspace-aware handlers and storage entry points, workspace-related tests, generated agent guidance, and user setup documentation.

**Caller-facing interface:** `checkpoint`, `recall`, and `brief` accept an absolute `workspace` path. Project-scoped installations may omit it when `GOLDFISH_WORKSPACE` is fixed. Recall alone accepts `workspace: "all"`.

**Depth and locality:** Workspace source selection stays in the protocol adapter. Host-native path validation and fail-closed resolution live in the core workspace module so direct handler and storage calls cannot recover cwd behind the adapter. Handlers continue receiving one resolved absolute path and do not learn client-specific rules.

**Test surface:** Tests call the exported tool interface and the spawned stdio server. They prove explicit, environment, legacy Roots, missing, current, relative, plugin-cache, and cross-project behavior.

**Seams and adapters:** `hydrateWorkspaceArguments` remains the single client-to-handler workspace seam. No new activation or session-state module is introduced.

**Rejected shortcuts:** Adding one more cache-path blacklist, retaining registry recovery for recall, making only writes fail closed, or documenting explicit paths without enforcing them.

**Architecture risk:** High. This deliberately breaks callers that relied on implicit cwd or recovery, but it removes a data-placement failure mode.

## Runtime behavior

### Explicit workspace

A host-native absolute path is validated and passed to the handler. Relative paths, empty strings, `current`, `~`, unexpanded variables such as `${workspaceFolder}`, `file://` URIs, drive-relative Windows paths such as `C:repo`, foreign-host path syntax, and unresolved `..` segments do not establish identity.

The exact path is the caller's authority. Goldfish does not silently replace it with a registry or parent-walk result. If the path is inside an enclosing `.git` or `.memories` project, Goldfish refuses and suggests the enclosing project root instead of creating a split nested memory store. If no enclosing marker exists, an existing absolute directory remains a valid first-use non-Git project.

### Project-level configuration

When `GOLDFISH_WORKSPACE` contains a host-native absolute path, calls may omit `workspace`. The environment value is validated through the same path and unsafe-directory rules as an explicit argument. A configured environment value intentionally outranks legacy Roots because it is explicit server configuration.

### Legacy Roots

For clients using the legacy initialization protocol and advertising Roots, the first valid absolute `file://` root may supply the workspace. Modern stateless calls do not request Roots.

### Missing identity

The server rejects the call before a handler reads or writes files. Direct handler and storage entry points reject the same unbound call rather than falling back to cwd. The tool result uses the existing `isError` shape and contains an exact retry example with an absolute workspace path. Known registry and parent-walk projects may appear as suggestions, clearly labeled as unselected candidates.

### Cross-project recall

`recall({ workspace: "all" })` keeps its existing explicit cross-project behavior. Its tool description states that `all` is a deliberate cross-project search, not a fallback for a missing current workspace. `all` remains invalid for checkpoint and brief.

## Removal scope

Delete automatic recovery as an authorization path. Retain only the bounded candidate discovery needed to reject nested project paths and produce useful error suggestions. Remove selection, precedence, and recovery-notice code and the tests that assert automatic binding. Place suggestion formatting beside refusal behavior rather than preserving a module whose name promises recovery.

Update tool parameter descriptions, server instructions, SessionStart guidance, canonical skills and mirrors, README setup guidance, technical documentation, and the Unreleased changelog so agents know to pass the absolute project path from their conversation context.

This is a breaking behavior change and should ship in a major release unless release review establishes a documented exception.

## Acceptance criteria

- [ ] A modern stateless call with no explicit workspace and no environment binding fails before handler execution.
- [ ] A server launched from a plugin cache containing `.memories` cannot read or write that cache without an explicit absolute workspace path naming it.
- [ ] Explicit host-native absolute POSIX and Windows workspace paths work for checkpoint, recall, and brief on their respective hosts.
- [ ] Relative paths and `workspace: "current"` fail when no trusted binding exists.
- [ ] `~`, unexpanded variables, `file://` URIs, foreign-host absolute syntax, UNC and drive-relative edge cases, and unresolved `..` segments have explicit platform-correct outcomes.
- [ ] Explicit, environment, and legacy Roots values all pass broad-directory safety checks; filesystem roots, home directories, and Windows system directories remain forbidden.
- [ ] Direct handler and storage calls without a verified workspace fail instead of using process cwd.
- [ ] A path inside an enclosing `.git` or `.memories` project is refused with the detected project root as a suggestion, preventing nested memory stores.
- [ ] An existing absolute directory with no enclosing project marker remains usable for first-use non-Git storage.
- [ ] A fixed absolute `GOLDFISH_WORKSPACE` preserves project-level configuration behavior.
- [ ] Supported legacy Roots still hydrate an omitted workspace.
- [ ] A spawned stdio compatibility test covers legacy Roots rather than relying only on `InMemoryTransport`.
- [ ] `recall({ workspace: "all" })` remains supported, while checkpoint and brief reject `all`.
- [ ] Registry and parent-walk results appear only as optional error suggestions and never authorize access.
- [ ] Automatic workspace selection and recovery-notice code and tests are removed; candidate-only discovery remains local to validation and errors.
- [ ] Two explicit workspaces used by one server process do not cross-contaminate checkpoint, day, brief, or search caches.
- [ ] Tool descriptions and agent guidance tell user-level callers to pass an absolute workspace on every workspace-scoped call.
- [ ] README and portability documentation stop claiming that workspace configuration is universally optional without explaining the user-level per-call requirement.
- [ ] Refusal tests assert the exact actionable retry text returned through the tool `isError` result.
- [ ] Focused server, workspace, handler, hook, and agent-asset tests pass.
- [ ] The full test suite and TypeScript typecheck pass.

## Sources

- [MCP 2026-07-28 specification overview](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [SEP-2567: Sessionless MCP via explicit state handles](https://modelcontextprotocol.io/seps/2567-sessionless-mcp)
- [SEP-2577: Deprecate Roots, Sampling, and Logging](https://modelcontextprotocol.io/seps/2577-deprecate-roots-sampling-and-logging)
- [Codex issue #37903: plugin MCP servers receive no workspace signal](https://github.com/openai/codex/issues/37903)
