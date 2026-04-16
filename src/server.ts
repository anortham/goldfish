#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides 4 core tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - brief: Manage durable strategic context
 * - consolidate: Prepare memory consolidation
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
import { handleCheckpoint, handleRecall, handleBrief, handlePlan, handleConsolidate } from './handlers/index.js';
import type { CheckpointArgs, RecallArgs, BriefArgs, PlanArgs, ConsolidateArgs } from './types.js';
import { pruneOrphanedSemanticCaches } from './semantic-cache.js';
import { getLogger } from './logger.js';
import { resolveWorkspace } from './workspace.js';

export const SERVER_VERSION = '6.6.0';
const WORKSPACE_AWARE_TOOLS = new Set(['checkpoint', 'recall', 'brief', 'plan', 'consolidate']);
const DEFAULT_SESSION_KEY = 'default';

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handleBrief, handlePlan, handleConsolidate };

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
  if (cache.has(sessionId)) {
    return cache.get(sessionId) ?? undefined;
  }

  try {
    const result = await sendRequest({ method: 'roots/list' }, ListRootsResultSchema);
    cache.set(sessionId, result.roots);
    return result.roots;
  } catch {
    cache.set(sessionId, null);
    return undefined;
  }
}

async function hydrateWorkspaceArguments(
  name: string,
  rawArgs: unknown,
  cache: Map<string, Root[] | null | undefined>,
  sessionId: string,
  sendRequest: (request: { method: 'roots/list' }, resultSchema: typeof ListRootsResultSchema) => Promise<{ roots: Root[] }>
): Promise<Record<string, unknown>> {
  const args = asObject(rawArgs);

  if (!WORKSPACE_AWARE_TOOLS.has(name)) {
    return args;
  }

  const workspace = typeof args.workspace === 'string' ? args.workspace : undefined;

  if (workspace === 'all') {
    return args;
  }

  if (workspace && workspace !== 'current') {
    return args;
  }

  const roots = process.env.GOLDFISH_WORKSPACE
    ? undefined
    : await getCachedRoots(cache, sessionId, sendRequest);

  return {
    ...args,
    workspace: resolveWorkspace(workspace, { roots })
  };
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

  // Prune orphaned semantic caches (fire-and-forget)
  pruneOrphanedSemanticCaches().catch(() => {
    // Silently ignore, pruning is best-effort
  });

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
      const hydratedArgs = await hydrateWorkspaceArguments(
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
        case 'plan':
          result = await handlePlan(hydratedArgs as unknown as PlanArgs);
          break;
        case 'consolidate':
          result = await handleConsolidate(hydratedArgs as ConsolidateArgs);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
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
  console.error('Tools: checkpoint, recall, brief, consolidate (plan supported as compatibility alias)');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
