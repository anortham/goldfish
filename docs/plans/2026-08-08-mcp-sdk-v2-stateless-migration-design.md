# MCP SDK v2 + Stateless Protocol Migration

**Date:** 2026-08-08

**Status:** Approved for implementation planning (revised after external doubt pass, 2026-08-08); implementation deferred

**Risk:** Medium

## Context

Goldfish is a local stdio MCP server built on `@modelcontextprotocol/sdk`
1.30.0. The stable TypeScript SDK v2 is now split into
`@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and
`@modelcontextprotocol/core`. It also adds support for the stateless
2026-07-28 protocol revision.

Updating the package name alone is not enough. A server created with the v2
SDK but connected directly to `StdioServerTransport` still serves only the
2025-era protocol. A stdio server that supports both eras must run through
`serveStdio(() => createServer())`.

Goldfish must keep working in deployed clients that still use the legacy
initialize/session flow. This migration therefore adds modern protocol
support without removing legacy support.

### Evidence gathered

- The project declares `@modelcontextprotocol/sdk: ^1.30.0`; 1.30.0 is the
  installed and latest monolithic v1 release.
- Stable v2 packages are published at 2.0.0.
- The official codemod dry run found 15 mechanical changes across three files:
  imports, handler method strings, handler context names, and package entries.
- Goldfish imports the SDK only from `src/server.ts`, `src/tools.ts`, and
  `tests/server.test.ts`.
- The existing roots path has regression coverage for lazy discovery,
  invalidation, empty results, failures, timeouts, and recovery after a late
  client response. It is a high-risk compatibility surface.
- `InMemoryTransport` exercises only the legacy era. Modern stdio behavior
  requires a spawned `serveStdio` process.
- Goldfish stores no authoritative MCP session state. Its small roots cache is
  only a legacy workspace-discovery optimization; markdown files remain the
  source of truth.

## Goal

Move Goldfish to the stable TypeScript SDK v2 and serve both legacy 2025-era
and stateless 2026-07-28 MCP clients over the existing stdio launch path,
without changing Goldfish tool contracts, storage, or workspace safety.

## Non-Goals

- No HTTP transport or remotely hosted server.
- No removal of legacy client support.
- No change to tool names, input schemas, result shapes, or error text unless
  v2 typing requires a semantically equivalent representation.
- No change to checkpoint, recall, brief, registry, or markdown storage logic.
- No modern multi-round-trip roots flow in this migration.
- No release, tag, push, or publication as part of implementation. Release
  preparation is included; external release actions remain separately gated.
- No rewriting historical plan documents solely to replace old dependency
  names.

## Design

### 1. Split the SDK dependencies

Replace the monolithic runtime dependency with the packages Goldfish imports:

- `dependencies`: `@modelcontextprotocol/server` `^2.0.0`
- `devDependencies`: `@modelcontextprotocol/client` `^2.0.0`

Do not add a direct `@modelcontextprotocol/core` dependency unless the final
source still imports raw `*Schema` constants. The method-string handler API
should remove those imports. Do not add a direct `zod` dependency unless final
Goldfish source imports it. Let `bun install` produce the lockfile change.

The implementation starts from the codemod's dry-run output, but applies the
changes deliberately. The codemod cannot decide roots behavior, test topology,
Bun compatibility, documentation, or release metadata.

### 2. Keep protocol adaptation at the server boundary

`src/server.ts` remains the only protocol adapter. `createServer()` continues
to construct and register the low-level MCP server; handlers continue to call
the existing plain-data Goldfish functions.

Mechanical v2 changes:

- Import `Server` from `@modelcontextprotocol/server`.
- Import stdio serving from `@modelcontextprotocol/server/stdio`.
- Register spec handlers with method strings:
  `tools/list`, `tools/call`, and `notifications/roots/list_changed`.
- Replace the v1 `extra` parameter with `ctx`.
- Replace `extra.sessionId` with `ctx.sessionId`.
- Replace `extra.sendRequest(...)` with `ctx.mcpReq.send(...)` and omit the
  result-schema argument for `roots/list`.
- Import the public `Tool` type through the server package in `src/tools.ts`.

Do not move protocol objects into handlers, storage modules, or workspace
recovery. The caller-facing `createServer()` contract and the three public MCP
tools stay stable.

### 3. Serve both protocol eras over stdio

Replace direct `server.connect(new StdioServerTransport())` startup with the v2
factory entry:

```ts
await serveStdio(() => createServer());
```

The default accepts both protocol eras; do not pass `legacy: 'reject'`.
`serveStdio` pins one server instance to each stdio connection and selects the
wire era from the opening exchange.

The executable command, plugin manifests, and `bun run src/server.ts` launch
shape do not change. `startServer()` remains the tested startup seam; if the v2
return type forces a small signature adjustment, keep that adjustment local
and update its direct tests.

### 4. Preserve legacy roots; do not add modern MRTR roots yet

Legacy clients keep the current roots behavior exactly:

1. explicit tool `workspace`
2. `GOLDFISH_WORKSPACE`
3. lazy `roots/list`, with the existing cache, timeout, retry, and
   `notifications/roots/list_changed` invalidation behavior
4. cwd, registry, and parent-walk recovery
5. safe refusal when no trustworthy workspace exists

Modern 2026-07-28 clients have no server-to-client request channel. The v2
replacement for roots is an `input_required` multi-round-trip response, but it
would turn a currently single-round checkpoint into a retryable state machine
and duplicate the project's most heavily repaired control flow.

For this migration, a modern request is identified through the documented
per-request `ctx.mcpReq.envelope`. It skips the legacy `roots/list` request and
continues through the existing explicit/env/cwd/recovery/refusal chain. This is
safe because current Goldfish clients already need that fallback when they do
not advertise roots.

Modern MRTR roots should be a separate feature only when a real client cannot
resolve its workspace through the existing chain. That later change needs its
own evidence, state-machine design, duplicate-write analysis, and tests.

### 5. Test the shipped stdio path

The migration uses two complementary test layers.

#### Legacy in-process tests

Move `tests/server.test.ts` to the v2 `Client` and a linked
`InMemoryTransport` pair imported from one v2 package. Use the default or
explicit legacy client mode. Preserve every existing roots regression test and
all tool handler assertions.

Never mix v1 client objects with a v2 server. Never create linked transport
halves from different v2 packages because each package bundles separate private
transport state.

#### Modern spawned-stdio tests

Add a focused protocol compatibility test that launches the real Goldfish
stdio command through v2 `StdioClientTransport` and pins
`versionNegotiation.mode` to `2026-07-28`.

The test proves:

- the v2 server starts under Bun through `serveStdio`;
- the client reports the modern era;
- `tools/list` returns all three existing tools;
- representative `tools/call` requests succeed with an explicit workspace;
- a modern call without roots follows existing recovery or safe-refusal
  behavior and never attempts a server-to-client `roots/list` request;
- checkpoint writes, if exercised, land only in the test workspace.

Every spawned process must receive an explicit temporary `cwd` and an isolated
`GOLDFISH_HOME`. Do not inherit the repository cwd as the workspace. Ensure the
client and child close in `finally` blocks so failures do not leave processes
running.

Do not add an in-process HTTP test. Goldfish does not ship HTTP, and that test
would validate an unowned transport while leaving the actual modern stdio path
under-tested.

### 6. Documentation and release preparation

Update current dependency and architecture references in:

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `CONTRIBUTING.md`
- `docs/IMPLEMENTATION.md`

Document that the stdio server supports both legacy and 2026-07-28 clients,
and that modern clients use explicit/env/cwd recovery rather than roots MRTR in
this release.

Prepare release version 7.7.0 across the six required version surfaces and add
a 7.7.0 changelog entry. Version preparation belongs in the migration commit;
tagging, pushing, and publishing do not.

## Architecture Quality

### Affected modules

| Area | Change | Boundary |
|---|---|---|
| `src/server.ts` | v2 imports, method strings, context API, dual-era stdio | Protocol adapter only |
| `src/tools.ts` | v2 `Tool` type import | Type-only |
| `tests/server.test.ts` | v2 legacy client and transport | Existing behavioral coverage |
| modern stdio test | spawned, pinned 2026-07-28 client | Shipped transport coverage |
| package and docs | split dependencies, compatibility, 7.7.0 prep | Build and user guidance |

### Caller-facing interface

- MCP tool names and wire schemas do not change.
- Handler inputs and outputs do not change.
- Plugin launch commands do not change.
- `createServer()` remains the construction seam.
- `startServer()` remains the executable startup seam.

### Locality and dependency direction

Protocol-era branching stays in `src/server.ts`. Workspace resolution remains
one direction: protocol adapter calls workspace recovery; workspace recovery
does not import or understand MCP protocol objects. Storage and handler modules
remain reusable without an MCP connection.

### Rejected shortcuts

- **Package-only upgrade:** compiles on v2 but still serves only the legacy
  protocol over direct stdio transport.
- **Modern-only server:** needlessly breaks deployed 2025-era clients.
- **Modern MRTR roots now:** duplicates fragile timeout/cache/retry behavior and
  introduces retry-state and duplicate-write risk without a current client need.
- **HTTP-only modern test:** validates a transport Goldfish does not ship.
- **v1 client against v2 server tests:** crosses incompatible object/type
  boundaries and can hide migration defects.

## Implementation Sequence

Implementation remains test-driven. Each production change begins with a
failing focused test.

1. **Bun compatibility preflight:** install the v2 client and server alongside
   v1, then run a disposable temp-directory `serveStdio` child under Bun. Stop
   before source edits if the published package cannot run in Goldfish's runtime.
2. **Modern failing test:** add the isolated spawned-stdio Goldfish test and
   confirm it fails against the current v1 entry for the expected modern-era
   reason.
3. **Legacy harness and server API migration:** rewrite the existing test imports
   and linked transport pair to v2 first, observe the expected failures, then
   migrate server imports, method registrations, and handler context access.
   Remove v1 after no executable source imports remain and make the focused
   legacy suite green.
4. **Dual-era startup:** replace direct transport connection with
   `serveStdio(() => createServer())`; make the modern spawned-stdio tests pass.
5. **Modern workspace behavior:** add failing tests for explicit workspace,
   no-roots fallback, and safe refusal; implement only the small era-aware roots
   bypass in `src/server.ts`.
6. **Docs and release prep:** update current docs, six version surfaces, and
   changelog; run version consistency checks.
7. **Verification:** run typecheck, targeted server/handler/agent-assets tests,
   then the full suite and a final SDK-reference audit.

## Acceptance Criteria

- Goldfish directly depends on stable v2 server/client packages and has no
  executable source, manifest, or maintained dependency listing that still
  uses `@modelcontextprotocol/sdk`; historical plans and this migration record
  may retain the old name as evidence.
- `bun run src/server.ts` starts through `serveStdio` under Bun.
- A v2 client in legacy mode passes the existing tool and roots regression
  suite, including retry, invalidation, timeout, and late recovery.
- A v2 client pinned to `2026-07-28` connects through spawned stdio and reports
  the modern era.
- The modern client lists and calls the existing Goldfish tools without an
  initialize/session dependency.
- Modern calls never issue push-style `roots/list`; explicit workspace, env,
  cwd/recovery, and safe refusal retain their current precedence and behavior.
- Spawned tests use only temporary cwd, memory home, registry, and checkpoint
  paths; no test writes to the repository's live `.memories` or real
  `~/.goldfish`.
- Tool contracts, markdown formats, timestamps, atomic writes, and file locking
  remain unchanged.
- `bun run typecheck`, focused tests, `bun test`, and version consistency checks
  pass.
- Version 7.7.0 is consistent across all six required surfaces with a matching
  changelog section; no tag, push, or release is performed.

## Doubt Pass

An external Claude review challenged the first design. No external-model policy
was declared in the repository, so the design context was sent to Anthropic.

| Objection | Resolution |
|---|---|
| No named client currently requires modern MCP | Retain the migration because the requested goal is forward compatibility with the new stable specification; do not claim stateless scaling benefits for a local stdio server. |
| Roots contains six repaired edge cases | Preserve that code only for legacy requests and do not clone it into a modern state machine. |
| MRTR roots can add retry, latency, and duplicate-write risks | Remove modern MRTR roots from this migration. Use existing fallback/refusal behavior. |
| In-process HTTP tests do not prove shipped behavior | Replace the proposed HTTP layer with a spawned modern stdio test. |
| Bun compatibility is unproven | Make `serveStdio` under Bun the first implementation gate. |
| Spawned tests can leak writes into the real repo/home | Require explicit temporary cwd and `GOLDFISH_HOME`, plus cleanup in `finally`. |
| Codemod scope misses tests, roots, docs, and release surfaces | Treat the codemod as a mechanical starting point and include all named manual work above. |

The material criterion revision is intentional: the migration delivers modern
stateless protocol support, but modern roots discovery is deferred until client
evidence justifies its extra state machine.

## Implementation Plan

- [Full TDD implementation plan](2026-08-08-mcp-sdk-v2-stateless-migration-plan.md)

## Sources

- [TypeScript SDK v2 migration guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md)
- [Supporting MCP 2026-07-28](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md)
- [MCP 2026-07-28 release announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
