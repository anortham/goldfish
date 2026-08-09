# MCP SDK v2 + Stateless Protocol Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use razorback:subagent-driven-development when subagent delegation is available. Fall back to razorback:executing-plans for single-task, tightly-sequential, or no-delegation runs.

**Goal:** Migrate Goldfish to the stable MCP TypeScript SDK v2 packages and serve both legacy 2025-era and modern 2026-07-28 clients over the existing stdio command without changing tools, storage, or workspace safety.

**Architecture:** Keep all protocol adaptation in `src/server.ts`. First move the existing server and in-memory legacy tests to the split v2 packages, then replace direct stdio transport wiring with `serveStdio` and prove modern behavior through a spawned Bun child. Legacy clients retain the full roots request/cache/retry path; modern requests skip push-style roots and use the existing explicit/env/cwd recovery and safe-refusal chain.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/server` `^2.0.0`, `@modelcontextprotocol/client` `^2.0.0`, Bun test runner, project-local markdown storage.

**Architecture Quality:** Medium risk. The approved shape keeps protocol-era knowledge at the server boundary, preserves plain-data handler/storage interfaces, and tests both protocol eras through their real supported transports.

**Status:** Implementation complete and locally verified; push, tag, publish, deploy, and release actions remain separately gated.

**Approved design:** [MCP SDK v2 + Stateless Protocol Migration](2026-08-08-mcp-sdk-v2-stateless-migration-design.md)

## Global Constraints

- TDD is mandatory: add or change a test first, observe the expected failure, implement the minimum behavior, and restore green before committing.
- Execution starts by using `razorback:using-git-worktrees`; do not implement on `main` or in the current planning checkout.
- Run `bun install --frozen-lockfile`, `bun run typecheck`, and `bun test` in the new worktree before the first task. A failing baseline is a blocker unless diagnosed as an environment-only issue.
- Runtime dependency is exactly `@modelcontextprotocol/server: ^2.0.0`; test-only dependency is exactly `@modelcontextprotocol/client: ^2.0.0`.
- Remove `@modelcontextprotocol/sdk` from executable source and `package.json`; retain the old name only in historical plans, changelog history, and migration evidence.
- Serve both protocol eras. `serveStdio` keeps its default legacy posture; never pass `legacy: 'reject'`.
- Do not add HTTP transport, modern `input_required` roots, request-state codecs, subscriptions, or new MCP features.
- Preserve the three public tools, all schemas/results, server instructions, markdown formats, UTC timestamps, atomic writes, locks, and workspace precedence.
- Preserve legacy roots cache, retry, timeout, late-roots, and list-changed invalidation behavior exactly.
- Modern requests must not issue push-style `roots/list`; they use explicit `workspace`, `GOLDFISH_WORKSPACE`, cwd recovery, or safe refusal.
- Every spawned protocol test sets an explicit temporary `cwd`, `HOME`, and `GOLDFISH_HOME`; it must not write to the repository's live `.memories` or the user's real `~/.goldfish`.
- Tests contain no comments. Production comments are limited to non-obvious external constraints or safety invariants.
- Prepare version `7.7.0` across all six required surfaces and `CHANGELOG.md`; do not tag, push, publish, deploy, or release without separate user approval.
- External SDK behavior must be checked against the current official v2 docs before implementation: [v2 upgrade](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md), [protocol versions](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md), [stdio serving](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md), and [2026-07-28 support](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md).

---

## File Structure

### Runtime and tests

| File | Responsibility after migration |
|---|---|
| `src/server.ts` | v2 low-level server registration, legacy roots compatibility, modern roots bypass, dual-era stdio entry |
| `src/tools.ts` | Tool definitions typed from the v2 server package |
| `tests/server.test.ts` | Existing handler and legacy-era in-memory protocol regression suite using the v2 client |
| `tests/protocol-compatibility.test.ts` | Spawned Bun stdio coverage pinned to modern `2026-07-28` |
| `tests/sdk-migration.test.ts` | Dependency split and maintained-documentation consistency gates |
| `package.json` | Runtime/test dependency split and release version |
| `bun.lock` | Resolved v2 dependency graph |

### Documentation and release metadata

| File | Planned change |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Mirrored SDK v2 tech-stack declaration |
| `README.md` | 7.7.0 banner, dual-era support, runtime dependency list |
| `CONTRIBUTING.md` | Stdio testing note for the dual-era v2 entry |
| `docs/IMPLEMENTATION.md` | Current architecture dependency and protocol statement |
| `.claude-plugin/plugin.json` | Version 7.7.0 |
| `.codex-plugin/plugin.json` | Version 7.7.0 |
| `.claude-plugin/marketplace.json` | Version 7.7.0 |
| `CHANGELOG.md` | 7.7.0 migration entry |

## Architecture Quality

- `src/server.ts` is the only module allowed to inspect MCP request context or protocol-era metadata.
- `hydrateWorkspaceArguments` remains a plain-data adapter. It receives a `canRequestRoots` boolean rather than importing SDK types or branching on protocol versions itself.
- Existing handlers continue receiving plain argument objects and returning their current content/result shapes.
- `createServer()` stays the construction seam used by legacy in-memory tests. `startServer()` stays the executable seam and delegates stdio ownership to `serveStdio`.
- Legacy roots behavior is not rewritten. Only the v2 `ctx.mcpReq.send` call shape changes, plus a modern guard that prevents the call entirely.
- The main architecture risk is accidental divergence between the heavily repaired legacy roots path and modern fallback behavior. The plan contains independent legacy regression and modern spawned-stdio gates.
- If published v2 types contradict the signatures recorded below, stop and report a plan mismatch with the exact declaration. Do not redesign around casts or import `@modelcontextprotocol/core-internal`.

## Verification Strategy

**Project source of truth:** `AGENTS.md` testing table, `package.json` scripts, `tests/preload.ts`, and `tests/test-isolation.test.ts`.

**Worker red/green scope:** Use the exact single-file or single-test commands named in each task. Task 1 owns `bun test tests/sdk-migration.test.ts`, `bun test tests/server.test.ts`, and `bun run typecheck`; Task 2 owns `bun test tests/protocol-compatibility.test.ts` and `bun test tests/server.test.ts`; Task 3 owns `bun test tests/sdk-migration.test.ts`, `bun test tests/agent-assets.test.ts`, `bun test tests/server.test.ts`, and `bun run typecheck`.

**Worker ceiling:** Targeted test files plus `bun run typecheck`. Workers do not run or accept the full-suite branch gate.

**Worker gate invariant:** Task 1 proves the v2 package split and legacy behavior; Task 2 proves real modern stdio negotiation, tool calls, roots bypass, and filesystem isolation; Task 3 proves maintained docs and all version surfaces agree.

**Lead affected-change scope:** After each reviewed task commit, run `bun test server agent-assets test-isolation` and `bun run typecheck` from that commit.

**Branch gate:** Run `bun run typecheck`, then `bun test`, then `bun run check:version-tag`. The tag check must report that HEAD has no release tag or that any tag matches 7.7.0; this plan does not create a tag.

**Security scope:** none declared. The repository defines no secrets-scan or dependency/CVE-audit command. Review must still verify that only official MCP packages were added and no credentials or real home paths entered tests or lockfile configuration.

**Replay/metric evidence:** Hard gates are `client.getProtocolEra() === 'modern'`, all three tool names listed, successful writes only inside temporary workspaces, modern unsafe-cwd refusal, all legacy roots regressions, typecheck, and full suite. No performance metric changes are expected; timing is report-only.

**Escalation triggers:** Run `bun run build` if Bun/ESM resolution or stdio subpath imports fail. Re-run the full suite immediately if `src/server.ts`, dependency versions, test preload behavior, or workspace resolution changes beyond the exact planned blocks. Any real filesystem write outside test temp directories is a hard blocker until removed and diagnosed.

**Assigned verification failure:** Workers stop and report when assigned verification fails, unless this plan explicitly says to update that gate.

**Verification ledger:** Record invariant, command, scope label, commit SHA, result, and UTC timestamp. Record modern/legacy era assertions and filesystem paths as hard-gate evidence. Reuse a passing ledger entry when the same HEAD already passed the same scope.

## Parallel Execution Contract

| Task | Parallel batch | File ownership | Serialization required | Dependency reason |
|---|---|---|---|---|
| Task 1: Split SDK packages and preserve legacy behavior | None - serial | Modify `package.json`, `bun.lock`, `src/server.ts`, `src/tools.ts`, `tests/server.test.ts`; create `tests/sdk-migration.test.ts` | Yes | Establishes the v2 types and green legacy baseline required by every later task. |
| Task 2: Enable and prove modern stdio | None - serial | Modify `src/server.ts`, `tests/server.test.ts`; create `tests/protocol-compatibility.test.ts` | Yes | Requires Task 1's v2 server/client packages and method-string handlers. |
| Task 3: Document compatibility and prepare 7.7.0 | None - serial | Modify `tests/sdk-migration.test.ts`, `src/server.ts`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `docs/IMPLEMENTATION.md`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md` | Yes | Must describe and version the verified behavior from Tasks 1 and 2. |

Commit mode for all tasks: `serial-worker-commit`.

---

### Task 1: Split SDK packages and preserve legacy behavior

**Files:**
- Create: `tests/sdk-migration.test.ts`
- Modify: `package.json:27-38`
- Modify: `bun.lock`
- Modify: `tests/server.test.ts:1-12,593-621,774-815,877-910,1400-1450`
- Modify: `src/server.ts:11-19,52-88,186-280`
- Modify: `src/tools.ts:7`

**Interfaces:**
- Consumes: Current `createServer()`, `startServer()`, `getCachedRoots()`, `hydrateWorkspaceArguments()`, existing `Client.callTool` tests, and all legacy roots regression cases.
- Produces: A v2 `Server` with method-string handlers, v2 handler context access, v2 legacy client tests, and no monolithic SDK dependency. `startServer()` intentionally remains direct legacy stdio until Task 2.

**Contract inputs:** Official v2 migration mappings: SDK imports split by role; spec handlers use method strings; `extra.sessionId` becomes `ctx.sessionId`; `extra.sendRequest` becomes `ctx.mcpReq.send`; spec requests drop the result-schema argument; linked in-memory transport halves come from one package.

**File ownership:** Modify `package.json`, `bun.lock`, `src/server.ts`, `src/tools.ts`, `tests/server.test.ts`; create `tests/sdk-migration.test.ts`

**Serialization required:** Yes

**Dependency reason:** Establishes the v2 types and green legacy baseline required by every later task.

**Step 1: Write the failing dependency-contract test**

Create `tests/sdk-migration.test.ts` with:

```ts
import { describe, it, expect } from 'bun:test';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

describe('MCP SDK dependencies', () => {
  it('uses the stable v2 server and client package split', async () => {
    const packageJson = JSON.parse(
      await readFile(join(repoRoot, 'package.json'), 'utf-8')
    ) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.dependencies['@modelcontextprotocol/server']).toBe('^2.0.0');
    expect(packageJson.devDependencies['@modelcontextprotocol/client']).toBe('^2.0.0');
    expect(packageJson.dependencies).not.toHaveProperty('@modelcontextprotocol/sdk');
  });
});
```

**Step 2: Run the dependency test to verify it fails**

Run:

```bash
bun test tests/sdk-migration.test.ts -t "uses the stable v2 server and client package split"
```

Expected: FAIL because `@modelcontextprotocol/server` and `@modelcontextprotocol/client` are absent and the monolithic dependency is present.

**Step 3: Install the split packages and remove v1**

Run these commands separately:

```bash
bun add '@modelcontextprotocol/server@^2.0.0'
```

```bash
bun add --dev '@modelcontextprotocol/client@^2.0.0'
```

Before removing v1 or editing source, run the Bun compatibility preflight:

```bash
bun -e "import { serveStdio } from '@modelcontextprotocol/server/stdio'; if (typeof serveStdio !== 'function') throw new Error('serveStdio unavailable')"
```

Expected: exit 0. This proves Bun can load the published stdio entry and its Node-stream dependencies. Stop before source edits if it fails; Task 2's spawned protocol test is the later wire-level proof.

Then run:

```bash
bun remove @modelcontextprotocol/sdk
```

Run:

```bash
bun test tests/sdk-migration.test.ts -t "uses the stable v2 server and client package split"
```

Expected: PASS.

Run:

```bash
bun run typecheck
```

Expected: FAIL with unresolved v1 SDK imports in `src/server.ts`, `src/tools.ts`, and `tests/server.test.ts`. If it fails for registry/network installation instead, stop as a dependency-access blocker.

**Step 4: Migrate source imports and the roots request signature**

Replace the MCP imports at the top of `src/server.ts` with:

```ts
import { Server, type Root } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
```

Replace `getCachedRoots` with:

```ts
async function getCachedRoots(
  cache: Map<string, Root[] | null | undefined>,
  sessionId: string,
  sendRequest: (request: { method: 'roots/list' }) => Promise<{ roots: Root[] }>
): Promise<Root[] | undefined> {
  if (cache.has(sessionId)) {
    return cache.get(sessionId) ?? undefined;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      sendRequest({ method: 'roots/list' }),
      new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), ROOTS_LIST_TIMEOUT_MS);
      })
    ]);
    if (!result) {
      return undefined;
    }
    if (result.roots.length > 0) {
      cache.set(sessionId, result.roots);
    }
    return result.roots;
  } catch {
    return undefined;
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
```

Replace the three registrations inside `createServer()` with method-string registrations. The full changed block is:

```ts
  server.setNotificationHandler('notifications/roots/list_changed', () => {
    rootsCache.clear();
  });

  server.setRequestHandler('tools/list', async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { name, arguments: args } = request.params;
    const log = getLogger();
    const start = performance.now();

    try {
      const { args: hydratedArgs, recovered } = await hydrateWorkspaceArguments(
        name,
        args,
        rootsCache,
        getSessionKey(ctx.sessionId),
        request => ctx.mcpReq.send(request)
      );
      let result;
      switch (name) {
        case 'checkpoint':
          result = await handleCheckpoint(hydratedArgs as unknown as CheckpointArgs);
          break;
        case 'recall':
          result = await handleRecall(hydratedArgs as RecallArgs);
          break;
        case 'brief':
          result = await handleBrief(hydratedArgs as unknown as BriefArgs);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      if (recovered && (name === 'checkpoint' || name === 'brief')) {
        appendRecoveryNotice(
          result as { content: Array<{ type: string; text?: string }> },
          recovered
        );
      }

      const ms = (performance.now() - start).toFixed(1);
      log.info(`tool.call name=${name} duration=${ms}ms`);
      return result;
    } catch (error: any) {
      const ms = (performance.now() - start).toFixed(1);
      log.error(`tool.call name=${name} duration=${ms}ms`, error);
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });
```

Replace the type import in `src/tools.ts` with:

```ts
import type { Tool } from '@modelcontextprotocol/server';
```

Keep the current `StdioServerTransport` startup in this task. Modern serving belongs to Task 2.

**Step 5: Migrate the legacy test client and linked transport**

Replace the MCP imports in `tests/server.test.ts` with:

```ts
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
```

Replace every client roots registration in this file with the v2 method-string form:

```ts
client.setRequestHandler('roots/list', async () => {
  rootsCalls += 1;
  return { roots: getRoots() };
});
```

The shared helper becomes:

```ts
  async function connectServerWithRoots(
    getRoots: () => Array<{ uri: string }>,
    rootsCapability = true
  ) {
    const { createServer } = await import('../src/server');

    const server = createServer();
    const client = new Client(
      { name: 'goldfish-test-client', version: '1.0.0' },
      {
        ...(rootsCapability ? { capabilities: { roots: { listChanged: true } } } : {}),
        versionNegotiation: { mode: 'legacy' }
      }
    );
    let rootsCalls = 0;

    client.setRequestHandler('roots/list', async () => {
      rootsCalls += 1;
      return { roots: getRoots() };
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport)
    ]);

    return {
      client,
      server,
      get rootsCalls() {
        return rootsCalls;
      }
    };
  }
```

Use this constructor for standalone tests that advertise roots:

```ts
const client = new Client(
  { name: 'goldfish-test-client', version: '1.0.0' },
  {
    capabilities: { roots: { listChanged: true } },
    versionNegotiation: { mode: 'legacy' }
  }
);
```

Use this constructor for standalone tests without roots capability:

```ts
const client = new Client(
  { name: 'goldfish-test-client', version: '1.0.0' },
  { versionNegotiation: { mode: 'legacy' } }
);
```

The failed-roots registration becomes:

```ts
client.setRequestHandler('roots/list', async () => {
  rootsCalls += 1;
  if (roots === 'throw') {
    throw new Error('roots/list temporarily unavailable');
  }
  return { roots };
});
```

The hung-roots registration becomes:

```ts
client.setRequestHandler('roots/list', async () => {
  rootsCalls += 1;
  return await new Promise<never>(() => {});
});
```

The late-roots registration becomes:

```ts
client.setRequestHandler('roots/list', async () => {
  rootsCalls += 1;
  return { roots };
});
```

Do not change the existing assertions, timeouts, setup, or cleanup in those tests.

**Step 6: Run legacy red/green verification**

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun test tests/server.test.ts
```

Expected: PASS, including every request-time hydration and workspace-recovery roots regression.

Run:

```bash
bun test tests/sdk-migration.test.ts
```

Expected: PASS.

Run:

```bash
bun run build
```

Expected: PASS, proving Bun resolves the v2 server and stdio subpaths.

**Step 7: Apply commit mode**

- `serial-worker-commit`: checkpoint the completed v2 legacy slice, commit the owned files together, and record the SHA in the verification ledger.
- Suggested commit: `Migrate MCP server and legacy tests to SDK v2`

**Acceptance criteria:**
- [x] `package.json` contains only the split v2 MCP dependencies with the exact requested ranges.
- [x] `bun.lock` resolves the v2 graph and no executable TypeScript import uses the monolithic SDK.
- [x] All SDK handler registrations use method strings and v2 context access.
- [x] The v2 client runs in explicit legacy mode with linked transport halves from one package.
- [x] Every existing legacy roots regression remains unchanged and passing.
- [x] Typecheck, build, server tests, and dependency contract test pass.
- [x] The slice is checkpointed and committed per `serial-worker-commit`.

---

### Task 2: Enable and prove modern stdio

**Files:**
- Create: `tests/protocol-compatibility.test.ts`
- Modify: `tests/server.test.ts:593-650`
- Modify: `src/server.ts:90-170,205-248,268-280`

**Interfaces:**
- Consumes: Task 1's v2 `createServer()`, v2 legacy handler registrations, workspace resolution chain, and direct legacy stdio startup.
- Produces: Dual-era `startServer()` via `serveStdio`, modern-era negotiation, and an exported plain-data `hydrateWorkspaceArguments()` test seam with a `canRequestRoots` guard that keeps push roots legacy-only.

**Contract inputs:** Modern clients pin with `versionNegotiation: { mode: { pin: '2026-07-28' } }`; `client.getProtocolEra()` returns `modern`; `StdioClientTransport` spawns `{ command, args, env, cwd, stderr }`; `serveStdio` serves legacy clients by default; modern request context carries `ctx.mcpReq.envelope`; in-memory transports cannot test the modern era.

**File ownership:** Modify `src/server.ts`, `tests/server.test.ts`; create `tests/protocol-compatibility.test.ts`

**Serialization required:** Yes

**Dependency reason:** Requires Task 1's v2 server/client packages and method-string handlers.

**Step 1: Write the failing roots-bypass unit test**

Add this test inside `describe('Request-time workspace hydration', ...)` in `tests/server.test.ts`, immediately after `connectServerWithRoots`:

```ts
  it('does not invoke roots when the protocol adapter disables it', async () => {
    const cwdFallback = await mkdtemp(join(tmpdir(), 'test-server-modern-cwd-'));
    process.chdir(cwdFallback);
    delete process.env.GOLDFISH_WORKSPACE;
    const { hydrateWorkspaceArguments } = await import('../src/server');
    let rootsCalls = 0;

    try {
      const hydrated = await hydrateWorkspaceArguments(
        'recall',
        { limit: 1 },
        new Map(),
        'modern',
        false,
        async () => {
          rootsCalls += 1;
          return { roots: [{ uri: pathToFileURL(TEST_DIR).href }] };
        }
      );

      expect(rootsCalls).toBe(0);
      expect(hydrated.args.workspace).toBe(cwdFallback);
    } finally {
      process.chdir(ORIGINAL_CWD);
      await rm(cwdFallback, { recursive: true, force: true });
    }
  });
```

Run:

```bash
bun test tests/server.test.ts -t "does not invoke roots when the protocol adapter disables it"
```

Expected: FAIL because `hydrateWorkspaceArguments` is not exported and does not accept the `canRequestRoots` argument yet.

**Step 2: Write the failing spawned-stdio tests**

Create `tests/protocol-compatibility.test.ts` with this complete content:

```ts
import { describe, it, expect } from 'bun:test';
import { mkdir, mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO_ROOT = join(import.meta.dir, '..');
const SERVER_PATH = join(REPO_ROOT, 'src', 'server.ts');

function getFirstTextContent(result: unknown): string {
  if (!result || typeof result !== 'object' || !('content' in result)) {
    return '';
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  const firstText = content.find(
    item => item && typeof item === 'object' && (item as { type?: unknown }).type === 'text'
  ) as { text?: unknown } | undefined;
  return typeof firstText?.text === 'string' ? firstText.text : '';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function connectModernServer(options: {
  cwd: string;
  home: string;
  goldfishHome: string;
  workspace?: string;
}): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['run', SERVER_PATH],
    cwd: options.cwd,
    env: {
      HOME: options.home,
      GOLDFISH_HOME: options.goldfishHome,
      ...(options.workspace ? { GOLDFISH_WORKSPACE: options.workspace } : {})
    },
    stderr: 'pipe'
  });
  let stderr = '';
  transport.stderr?.on('data', chunk => {
    stderr += String(chunk);
  });
  const client = new Client(
    { name: 'goldfish-modern-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );

  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await transport.close();
    throw new Error(`Modern stdio connection failed:\n${stderr}`, { cause: error });
  }
}

describe('MCP 2026-07-28 stdio compatibility', () => {
  it('lists tools and honors env and explicit workspace precedence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-modern-tools-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    const envWorkspace = join(root, 'env-workspace');
    const explicitWorkspace = join(root, 'explicit-workspace');
    await Promise.all([
      mkdir(home),
      mkdir(goldfishHome),
      mkdir(envWorkspace),
      mkdir(explicitWorkspace)
    ]);

    let client: Client | undefined;
    try {
      client = await connectModernServer({
        cwd: home,
        home,
        goldfishHome,
        workspace: envWorkspace
      });

      expect(client.getProtocolEra()).toBe('modern');
      const tools = await client.listTools();
      expect(tools.tools.map(tool => tool.name).sort()).toEqual([
        'brief',
        'checkpoint',
        'recall'
      ]);

      const fromEnv = await client.callTool({
        name: 'checkpoint',
        arguments: { description: 'modern checkpoint from env workspace' }
      });
      expect(fromEnv.isError).not.toBe(true);

      const fromExplicit = await client.callTool({
        name: 'checkpoint',
        arguments: {
          description: 'modern checkpoint from explicit workspace',
          workspace: explicitWorkspace
        }
      });
      expect(fromExplicit.isError).not.toBe(true);

      expect(await pathExists(join(envWorkspace, '.memories'))).toBe(true);
      expect(await pathExists(join(explicitWorkspace, '.memories'))).toBe(true);
      expect(await pathExists(join(home, '.memories'))).toBe(false);
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips push roots and safely refuses an untrusted cwd', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goldfish-modern-refusal-'));
    const home = join(root, 'home');
    const goldfishHome = join(root, 'goldfish-home');
    await Promise.all([mkdir(home), mkdir(goldfishHome)]);

    let client: Client | undefined;
    try {
      client = await connectModernServer({ cwd: home, home, goldfishHome });

      const result = await client.callTool({
        name: 'recall',
        arguments: { limit: 1 }
      });

      expect(result.isError).toBe(true);
      expect(getFirstTextContent(result).toLowerCase()).toContain('home directory');
      expect(await pathExists(join(home, '.memories'))).toBe(false);
    } finally {
      await client?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

**Step 3: Run the modern tests to verify the legacy-only entry fails**

Run:

```bash
bun test tests/protocol-compatibility.test.ts
```

Expected: FAIL during pinned era negotiation because Task 1 still connects a hand-built server directly to `StdioServerTransport`, which only serves the legacy era.

**Step 4: Switch startup to the dual-era stdio factory**

Replace the stdio import with:

```ts
import { serveStdio } from '@modelcontextprotocol/server/stdio';
```

Replace `startServer()` with:

```ts
export async function startServer() {
  void serveStdio(() => createServer());

  const log = getLogger();
  log.info(`server.start version=${SERVER_VERSION} workspace=${process.cwd()}`);
  log.cleanup();

  console.error('Goldfish MCP Server started');
  console.error('Tools: checkpoint, recall, brief');
}
```

Run:

```bash
bun test tests/protocol-compatibility.test.ts
```

Expected intermediate result: the spawned protocol tests PASS because the client connects and reaches Goldfish's existing fallback/refusal behavior. The focused roots-bypass unit test remains red, proving the user-visible refusal alone is not accepted as evidence that no roots request was attempted.

**Step 5: Add the modern roots-request guard**

Change the `hydrateWorkspaceArguments` signature to:

```ts
export async function hydrateWorkspaceArguments(
  name: string,
  rawArgs: unknown,
  cache: Map<string, Root[] | null | undefined>,
  sessionId: string,
  canRequestRoots: boolean,
  sendRequest: (request: { method: 'roots/list' }) => Promise<{ roots: Root[] }>
): Promise<{ args: Record<string, unknown>; recovered?: RecoveredWorkspace }> {
```

Replace its roots lookup with:

```ts
  const roots = process.env.GOLDFISH_WORKSPACE || !canRequestRoots
    ? undefined
    : await getCachedRoots(cache, sessionId, sendRequest);
```

Change the call inside the `tools/call` handler to:

```ts
      const { args: hydratedArgs, recovered } = await hydrateWorkspaceArguments(
        name,
        args,
        rootsCache,
        getSessionKey(ctx.sessionId),
        ctx.mcpReq.envelope === undefined,
        request => ctx.mcpReq.send(request)
      );
```

The envelope check stays at the protocol adapter boundary. Do not pass the SDK context into workspace recovery and do not add `inputRequired`.

First run the focused unit test:

```bash
bun test tests/server.test.ts -t "does not invoke roots when the protocol adapter disables it"
```

Expected: PASS with `rootsCalls === 0`.

**Step 6: Run modern and legacy verification**

Run:

```bash
bun test tests/protocol-compatibility.test.ts
```

Expected: PASS. Both child processes negotiate `modern`, write only to temp workspaces, close cleanly, and the unsafe cwd reaches Goldfish's existing refusal text.

Run:

```bash
bun test tests/server.test.ts
```

Expected: PASS. The explicit legacy client still exercises every roots request/cache/retry path.

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun run build
```

Expected: PASS.

**Step 7: Apply commit mode**

- `serial-worker-commit`: checkpoint the dual-era stdio slice, commit the owned files together, and record the SHA in the verification ledger.
- Suggested commit: `Serve legacy and modern MCP clients over stdio`

**Acceptance criteria:**
- [x] `startServer()` uses `serveStdio(() => createServer())` without rejecting legacy clients.
- [x] A spawned Bun child negotiates the modern era through the real stdio command.
- [x] The modern client lists exactly `brief`, `checkpoint`, and `recall`.
- [x] Modern env and explicit workspace precedence produce checkpoint files only in the expected temp directories.
- [x] A modern request without a trustworthy workspace skips push roots and returns the existing safe-refusal result.
- [x] The focused plain-data test proves the disabled path never invokes the roots callback.
- [x] Every spawned client closes in `finally`; no real home or repository memory path is used.
- [x] Modern tests, legacy server tests, typecheck, and build pass.
- [x] The slice is checkpointed and committed per `serial-worker-commit`.

---

### Task 3: Document compatibility and prepare 7.7.0

**Files:**
- Modify: `tests/sdk-migration.test.ts`
- Modify: `src/server.ts:32`
- Modify: `package.json:3`
- Modify: `AGENTS.md:374-381`
- Modify: `CLAUDE.md:374-381`
- Modify: `README.md:7,485-505`
- Modify: `CONTRIBUTING.md:310-325`
- Modify: `docs/IMPLEMENTATION.md:264-270`
- Modify: `.claude-plugin/plugin.json:4`
- Modify: `.codex-plugin/plugin.json:3`
- Modify: `.claude-plugin/marketplace.json:14`
- Modify: `CHANGELOG.md:7`

**Interfaces:**
- Consumes: Verified split dependencies, dual-era stdio behavior, modern roots decision, existing six-surface version tests, and AGENTS/CLAUDE mirror invariant.
- Produces: Maintained docs that name the v2 server package and dual-era behavior, plus consistent release preparation at 7.7.0.

**Contract inputs:** Version `7.7.0`; runtime package `@modelcontextprotocol/server`; test package `@modelcontextprotocol/client`; legacy roots retained; modern roots MRTR deferred; no tag/push/release.

**File ownership:** Modify `tests/sdk-migration.test.ts`, `src/server.ts`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, `docs/IMPLEMENTATION.md`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `CHANGELOG.md`

**Serialization required:** Yes

**Dependency reason:** Must describe and version the verified behavior from Tasks 1 and 2.

**Step 1: Write the failing maintained-documentation test**

Append this block to `tests/sdk-migration.test.ts`:

```ts
describe('MCP SDK documentation', () => {
  it('documents the MCP v2 server package in maintained technical docs', async () => {
    const maintainedDocs = [
      'AGENTS.md',
      'CLAUDE.md',
      'README.md',
      'CONTRIBUTING.md',
      join('docs', 'IMPLEMENTATION.md')
    ];

    for (const path of maintainedDocs) {
      const content = await readFile(join(repoRoot, path), 'utf-8');
      expect(content).toContain('@modelcontextprotocol/server');
      expect(content).not.toContain('@modelcontextprotocol/sdk');
    }
  });
});
```

**Step 2: Run the documentation test to verify it fails**

Run:

```bash
bun test tests/sdk-migration.test.ts -t "documents the MCP v2 server package"
```

Expected: FAIL because maintained docs still name the monolithic SDK or do not yet name the v2 server package.

**Step 3: Update maintained technical documentation**

Use this exact tech-stack line in both `AGENTS.md` and `CLAUDE.md`:

```markdown
- **MCP SDK:** `@modelcontextprotocol/server` (^2.0.0); `@modelcontextprotocol/client` (^2.0.0) for protocol tests
```

Use this README version banner:

```markdown
**Version 7.7.0** -- MCP SDK v2: Goldfish serves legacy 2025-era and modern 2026-07-28 clients over the same stdio command while preserving legacy roots compatibility. See CHANGELOG.md for details.
```

Use this README dependency list:

```markdown
- **Runtime dependencies:** `@modelcontextprotocol/server`, `@orama/orama`, `yaml`
- **Protocol-test dependency:** `@modelcontextprotocol/client`
```

Add this paragraph under `CONTRIBUTING.md`'s MCP Server Testing commands:

```markdown
Goldfish uses `@modelcontextprotocol/server` v2. Its `serveStdio` entry accepts both legacy 2025-era and modern 2026-07-28 clients. `tests/server.test.ts` owns legacy in-memory coverage; `tests/protocol-compatibility.test.ts` spawns the real Bun stdio command for modern coverage.
```

Replace the current architecture sentence in `docs/IMPLEMENTATION.md` with:

```markdown
**Current architecture:** markdown source of truth in `.memories/`, registry under `~/.goldfish/`, runtime dependencies `@modelcontextprotocol/server`, `@orama/orama`, and `yaml`. The stdio entry serves legacy 2025-era and modern 2026-07-28 clients; legacy roots discovery is preserved, while modern clients use explicit/env/cwd recovery and safe refusal.
```

Run:

```bash
bun test tests/sdk-migration.test.ts -t "documents the MCP v2 server package"
```

Expected: PASS for the maintained-documentation contract. The existing mirror test runs in Step 6.

**Step 4: Create the version-test red state**

Change only `src/server.ts` first:

```ts
export const SERVER_VERSION = '7.7.0';
```

Run:

```bash
bun test tests/server.test.ts
```

Expected: FAIL in version/plugin/README/changelog agreement because the canonical server version moved first.

**Step 5: Synchronize all release surfaces**

Set `7.7.0` in:

```text
package.json                                   version
.claude-plugin/plugin.json                     version
.codex-plugin/plugin.json                      version
.claude-plugin/marketplace.json                plugins[0].version
README.md                                      **Version 7.7.0** banner
```

Add this section at the top of `CHANGELOG.md` below the introduction:

```markdown
## [7.7.0] - 2026-08-08

### Added

- Modern MCP 2026-07-28 compatibility over the existing stdio command, verified by a pinned v2 client spawning the real Bun server with isolated filesystem state

### Changed

- Migrated from the monolithic `@modelcontextprotocol/sdk` 1.30.0 package to `@modelcontextprotocol/server` 2.0.0 at runtime and `@modelcontextprotocol/client` 2.0.0 for protocol tests
- Replaced schema-based low-level handler registration with v2 method strings and request context APIs
- Replaced direct `StdioServerTransport` startup with the dual-era `serveStdio` factory while retaining legacy client support

### Preserved

- Legacy roots discovery, cache invalidation, retry, timeout, and late-roots behavior remain unchanged; modern clients skip push roots and use explicit workspace, `GOLDFISH_WORKSPACE`, cwd recovery, or safe refusal
```

Do not rewrite the 7.6.2 changelog entry or historical plan documents that name the old package.

**Step 6: Run release-preparation verification**

Run:

```bash
bun test tests/server.test.ts
```

Expected: PASS for all six version surfaces and changelog coverage.

Run:

```bash
bun test tests/sdk-migration.test.ts
```

Expected: PASS for the dependency and maintained-doc contracts.

Run:

```bash
bun test tests/agent-assets.test.ts
```

Expected: PASS, including AGENTS/CLAUDE byte-for-byte mirroring.

Run:

```bash
bun run typecheck
```

Expected: PASS.

Run:

```bash
bun run check:version-tag
```

Expected: PASS because the implementation HEAD is untagged. Do not create a tag.

**Step 7: Apply commit mode**

- `serial-worker-commit`: checkpoint the documentation/release-prep slice, commit the owned files together, and record the SHA in the verification ledger.
- Suggested commit: `Document MCP v2 compatibility and prepare 7.7.0`

**Acceptance criteria:**
- [x] All maintained technical docs name `@modelcontextprotocol/server` and no longer describe the monolithic SDK as current.
- [x] `AGENTS.md` and `CLAUDE.md` remain byte-for-byte identical.
- [x] README and implementation docs describe dual-era stdio and the modern roots limitation accurately.
- [x] `SERVER_VERSION`, package, both plugin manifests, marketplace metadata, and README all say 7.7.0.
- [x] `CHANGELOG.md` documents the migration without changing historical entries.
- [x] Server tests, agent-assets tests, typecheck, and tag guard pass.
- [x] No tag, push, publish, deploy, or release occurs.
- [x] The slice is checkpointed and committed per `serial-worker-commit`.

---

## Lead Branch Gate and Handoff

After all three task commits have passed inline review:

1. Run `bun test server agent-assets test-isolation`.
2. Run `bun run typecheck`.
3. Run `bun test`.
4. Run `bun run check:version-tag`.
5. Audit executable imports and maintained dependency listings for the old SDK name; historical changelog and plan evidence are allowed.
6. Re-run `git status --short --branch` and `git worktree list` for every related worktree.
7. Confirm `.memories/` checkpoints are included with the task commits and no task changes are stranded elsewhere.
8. Stop before push, tag, publish, deploy, or release and request the separate approval required by project policy.

The migration is complete only when the original design acceptance criteria, all task checklists, and the branch verification ledger are green on the same clean HEAD.
