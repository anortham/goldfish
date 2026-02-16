#!/usr/bin/env bun
/**
 * Goldfish MCP Server
 *
 * Provides 3 tools for AI agents:
 * - checkpoint: Save work progress
 * - recall: Restore context
 * - plan: Manage long-running plans
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { getTools } from './tools.js';
import { getInstructions } from './instructions.js';
import { handleCheckpoint, handleRecall, handlePlan } from './handlers/index.js';

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handlePlan };

/**
 * Start MCP server (when run directly)
 */
export async function startServer() {
  const server = new Server(
    {
      name: 'goldfish',
      version: '5.0.4'
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: getInstructions()
    }
  );

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: getTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'checkpoint':
          return await handleCheckpoint(args);
        case 'recall':
          return await handleRecall(args);
        case 'plan':
          return await handlePlan(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
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

  console.error('Goldfish MCP Server started');
  console.error('Tools: checkpoint, recall, plan');
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
