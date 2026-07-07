#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides core tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - brief: Manage durable strategic context
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListRootsResultSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type Root
} from '@modelcontextprotocol/sdk/types.js';
import { getTools } from './tools.js';
import { getInstructions } from './instructions.js';
import { handleCheckpoint, handleRecall, handleBrief } from './handlers/index.js';
import type { CheckpointArgs, RecallArgs, BriefArgs } from './types.js';
import { getLogger } from './logger.js';
import {
  resolveUnsafeCwdReason,
  resolveWorkspaceWithSource
} from './workspace.js';
import { recoverWorkspace, formatKnownProjects, type RecoveredWorkspace } from './workspace-recovery.js';
import { listRegisteredProjects } from './registry.js';

export const SERVER_VERSION = '7.4.3';
const WORKSPACE_AWARE_TOOLS = new Set(['checkpoint', 'recall', 'brief']);
const DEFAULT_SESSION_KEY = 'default';
const ROOTS_LIST_TIMEOUT_MS = 500;

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handleBrief };

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_KEY;
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
  sendRequest: (request: { method: 'roots/list' }, resultSchema: typeof ListRootsResultSchema) => Promise<{ roots: Root[] }>
): Promise<Root[] | undefined> {
  // Only a non-empty successful result is worth caching. An empty list or a
  // failed lookup is treated as "no roots yet" rather than a permanent answer:
  // desktop MCP clients (Cursor) often populate roots late or after a transient
  // failure, and caching the empty/failed state would lock every later tool
  // call out of the workspace for the whole session.
  if (cache.has(sessionId)) {
    return cache.get(sessionId) ?? undefined;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      sendRequest({ method: 'roots/list' }, ListRootsResultSchema),
      new Promise<undefined>(resolve => {
        timeout = setTimeout(() => resolve(undefined), ROOTS_LIST_TIMEOUT_MS);
      })
    ]);
    if (!result) {
      return undefined;
    }
    if (result.roots && result.roots.length > 0) {
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

async function hydrateWorkspaceArguments(
  name: string,
  rawArgs: unknown,
  cache: Map<string, Root[] | null | undefined>,
  sessionId: string,
  sendRequest: (request: { method: 'roots/list' }, resultSchema: typeof ListRootsResultSchema) => Promise<{ roots: Root[] }>
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

  const roots = process.env.GOLDFISH_WORKSPACE
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

  server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    rootsCache.clear();
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const log = getLogger();
    const start = performance.now();

    try {
      const { args: hydratedArgs, recovered } = await hydrateWorkspaceArguments(
        name,
        args,
        rootsCache,
        getSessionKey(extra.sessionId),
        extra.sendRequest
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
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const log = getLogger();
  log.info(`server.start version=${SERVER_VERSION} workspace=${process.cwd()}`);
  log.cleanup(); // Fire-and-forget old log cleanup

  console.error('Goldfish MCP Server started');
  console.error('Tools: checkpoint, recall, brief');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
