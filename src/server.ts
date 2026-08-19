#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides core tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - brief: Manage durable strategic context
 */

import { CLIENT_INFO_META_KEY, Server, type Root } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { getTools } from './tools.js';
import { getInstructions } from './instructions.js';
import { handleCheckpoint, handleRecall, handleBrief } from './handlers/index.js';
import type { CheckpointArgs, RecallArgs, BriefArgs, ObservedActor } from './types.js';
import { getLogger } from './logger.js';
import {
  resolveUnsafeCwdReason,
  resolveWorkspaceWithSource
} from './workspace.js';
import { recoverWorkspace, formatKnownProjects, type RecoveredWorkspace } from './workspace-recovery.js';
import { listRegisteredProjects } from './registry.js';

export const SERVER_VERSION = '7.9.0';
const WORKSPACE_AWARE_TOOLS = new Set(['checkpoint', 'recall', 'brief']);
export const DEFAULT_SESSION_KEY = 'default';
const ROOTS_LIST_TIMEOUT_MS = 500;

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handleBrief };

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_KEY;
}

/**
 * Read the MCP client name for the request's protocol era. On 2026-07-28 the
 * client's identity rides on every request's `_meta` envelope under
 * CLIENT_INFO_META_KEY; 2025-era connections keep the initialize-scoped
 * `getClientVersion()`.
 */
function readMcpClientName(
  ctx: { mcpReq: { envelope?: unknown } },
  server: Server
): string | undefined {
  const envelope = ctx.mcpReq.envelope;
  if (envelope === undefined) {
    const name = server.getClientVersion()?.name?.trim();
    return name ? name : undefined;
  }

  if (envelope === null || typeof envelope !== 'object') {
    return undefined;
  }
  const clientInfo = (envelope as Record<string, unknown>)[CLIENT_INFO_META_KEY];
  if (!clientInfo || typeof clientInfo !== 'object') {
    return undefined;
  }
  const name = (clientInfo as Record<string, unknown>).name;
  if (typeof name !== 'string') {
    return undefined;
  }
  const trimmed = name.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Extract MCP-observed identity for a checkpoint save. This is the only place
 * allowed to inspect MCP request context; storage receives a plain object.
 */
function extractObservedActor(
  ctx: { sessionId?: string; mcpReq: { envelope?: unknown } },
  server: Server
): ObservedActor | undefined {
  const observed: ObservedActor = {};
  const harness = readMcpClientName(ctx, server);
  const session = ctx.sessionId;
  if (harness) observed.harness = harness;
  if (session && session !== DEFAULT_SESSION_KEY) observed.session = session;
  return observed.harness || observed.session ? observed : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value as Record<string, unknown> };
  }

  return {};
}

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

export async function hydrateWorkspaceArguments(
  name: string,
  rawArgs: unknown,
  cache: Map<string, Root[] | null | undefined>,
  sessionId: string,
  canRequestRoots: boolean,
  sendRequest: (request: { method: 'roots/list' }) => Promise<{ roots: Root[] }>
): Promise<{ args: Record<string, unknown>; recovered?: RecoveredWorkspace }> {
  const args = asObject(rawArgs);

  if (!WORKSPACE_AWARE_TOOLS.has(name)) {
    return { args };
  }

  const workspace = typeof args.workspace === 'string' ? args.workspace : undefined;

  if (workspace === 'all') {
    return { args };
  }

  if (workspace && workspace !== 'current') {
    return { args };
  }

  const roots = process.env.GOLDFISH_WORKSPACE || !canRequestRoots
    ? undefined
    : await getCachedRoots(cache, sessionId, sendRequest);

  const resolved = roots
    ? resolveWorkspaceWithSource(workspace, { roots })
    : resolveWorkspaceWithSource(workspace);

  // When the chain falls through to process.cwd(), try to recover a better
  // project root before accepting cwd or refusing. Cursor plugin installs (and
  // other harnesses that spawn the server with cwd=home and never advertise
  // the MCP roots capability) would otherwise hard-refuse on every call. The
  // registry reader is real here; tests inject a stub via GOLDFISH_HOME.
  let effective = resolved;
  let recovered: RecoveredWorkspace | undefined;
  if (resolved.source === 'cwd') {
    recovered = await recoverWorkspace({
      cwd: resolved.path,
      tool: name as 'checkpoint' | 'recall' | 'brief',
      registryReader: () => listRegisteredProjects()
    });
    if (recovered) {
      const log = getLogger();
      log.info(`workspace.recovered source=${recovered.source} path=${recovered.path} cwd=${resolved.path}`);
      effective = { path: recovered.path, source: recovered.source };
    }
  }

  const unsafeCwdReason = effective.source === 'cwd'
    ? await resolveUnsafeCwdReason(effective.path)
    : undefined;
  if (unsafeCwdReason) {
    let knownProjects = '';
    try {
      const projects = await listRegisteredProjects();
      knownProjects = formatKnownProjects(projects);
    } catch {
      // Registry read failure must not silence the underlying refusal.
    }
    throw new Error(
      `Refusing to use ${unsafeCwdReason} (${effective.path}) as workspace from process cwd. ` +
        'Set GOLDFISH_WORKSPACE to your project path, pass `workspace:` to a tool call, ' +
        'or open a project folder in your MCP client.' +
        knownProjects
    );
  }

  const hydrated: { args: Record<string, unknown>; recovered?: RecoveredWorkspace } = {
    args: {
      ...args,
      workspace: effective.path
    }
  };
  if (recovered) {
    hydrated.recovered = recovered;
  }
  return hydrated;
}

/**
 * Append a "Workspace: … (recovered via …)" line to a checkpoint/brief result
 * so the agent can see where a recovered root landed. Recovery can pick a
 * wrong-but-plausible root (e.g. a parent .git); without this line the
 * misplacement is silent. Recall already prints its own workspace line, so we
 * only surface for the mutating tools.
 */
function appendRecoveryNotice(result: { content: Array<{ type: string; text?: string }> }, recovered: RecoveredWorkspace): void {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return;
  const sourceLabel = recovered.source === 'registry' ? 'registry' : 'parent walk';
  first.text = `${first.text}\n\nWorkspace: ${recovered.path} (recovered via ${sourceLabel})`;
}

export function createServer() {
  const server = new Server(
    {
      name: 'goldfish',
      version: SERVER_VERSION
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: getInstructions()
    }
  );
  const rootsCache = new Map<string, Root[] | null | undefined>();

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
        ctx.mcpReq.envelope === undefined,
        request => ctx.mcpReq.send(request)
      );
      let result;
      switch (name) {
        case 'checkpoint':
          result = await handleCheckpoint(
            hydratedArgs as unknown as CheckpointArgs,
            extractObservedActor(ctx, server)
          );
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

      // Surface where a recovered root landed for mutating tools. Recall
      // already prints its own workspace line; checkpoint/brief do not, so a
      // wrong-but-plausible recovery would otherwise be silent.
      if (recovered && (name === 'checkpoint' || name === 'brief')) {
        appendRecoveryNotice(result as { content: Array<{ type: string; text?: string }> }, recovered);
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

  return server;
}

/**
 * Start MCP server (when run directly)
 */
export async function startServer() {
  void serveStdio(() => createServer());

  const log = getLogger();
  log.info(`server.start version=${SERVER_VERSION} workspace=${process.cwd()}`);
  log.cleanup();

  console.error('Goldfish MCP Server started');
  console.error('Tools: checkpoint, recall, brief');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
