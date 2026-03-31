#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides 4 tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - plan: Manage long-running plans
 * - consolidate: Prepare memory consolidation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { getTools } from './tools.js';
import { getInstructions } from './instructions.js';
import { handleCheckpoint, handleRecall, handlePlan, handleConsolidate } from './handlers/index.js';
import type { CheckpointArgs, RecallArgs, PlanArgs, ConsolidateArgs } from './types.js';
import { pruneOrphanedSemanticCaches } from './semantic-cache.js';
import { getLogger } from './logger.js';

export const SERVER_VERSION = '6.5.1';

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handlePlan, handleConsolidate };

/**
 * Start MCP server (when run directly)
 */
export async function startServer() {
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

  // Prune orphaned semantic caches (fire-and-forget)
  pruneOrphanedSemanticCaches().catch(() => {
    // Silently ignore — pruning is best-effort
  });

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const log = getLogger();
    const start = performance.now();

    try {
      let result;
      switch (name) {
        case 'checkpoint':
          result = await handleCheckpoint(args as unknown as CheckpointArgs);
          break;
        case 'recall':
          result = await handleRecall(args as RecallArgs);
          break;
        case 'plan':
          result = await handlePlan(args as unknown as PlanArgs);
          break;
        case 'consolidate':
          result = await handleConsolidate((args ?? {}) as ConsolidateArgs);
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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const log = getLogger();
  log.info(`server.start version=${SERVER_VERSION} workspace=${process.cwd()}`);
  log.cleanup(); // Fire-and-forget old log cleanup

  console.error('Goldfish MCP Server started');
  console.error('Tools: checkpoint, recall, plan, consolidate');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
