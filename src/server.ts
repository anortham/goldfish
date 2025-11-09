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
import { handleCheckpoint, handleRecall, handlePlan, handleStore } from './handlers/index.js';
import { syncWorkspace } from './sync/index.js';
import { existsSync } from 'fs';
import { join } from 'path';

// Re-export for backward compatibility with tests
export { getTools, getInstructions, handleCheckpoint, handleRecall, handlePlan, handleStore };

/**
 * Start MCP server (when run directly)
 */
export async function startServer() {
  const server = new Server(
    {
      name: 'goldfish',
      version: '4.0.0'
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
        case 'store':
          return await handleStore(args);
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
            text: `❌ Error: ${error.message}`
          }
        ],
        isError: true
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('🐠 Goldfish MCP Server started');
  console.error('📁 Storage: ~/.goldfish/');
  console.error('🔧 Tools: checkpoint, store, recall, plan');
  console.error('');

  // Phase 3: Background sync of project memories
  // Check if current directory has .goldfish/memories/ and sync embeddings
  const cwd = process.cwd();
  const memoriesDir = join(cwd, '.goldfish', 'memories');

  if (existsSync(memoriesDir)) {
    // Extract workspace name from cwd
    const workspaceName = cwd.split(/[/\\]/).pop() || 'default';

    console.error(`🔄 Syncing workspace: ${workspaceName}`);

    // Run sync in background (don't block server)
    setImmediate(async () => {
      try {
        const stats = await syncWorkspace(workspaceName, memoriesDir);

        if (stats.embeddingsGenerated > 0) {
          console.error(`✅ Sync complete: ${stats.embeddingsGenerated} embeddings generated`);
        } else if (stats.totalMemories > 0) {
          console.error(`✅ Sync complete: All ${stats.totalMemories} memories already embedded`);
        } else {
          console.error(`ℹ️  No memories found in workspace`);
        }
      } catch (error: any) {
        console.error(`⚠️  Sync failed: ${error.message}`);
        // Don't crash server - sync is optional
      }
    });
  }
}

// Run server if executed directly
if (import.meta.main) {
  startServer().catch(console.error);
}
