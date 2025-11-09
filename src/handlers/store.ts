/**
 * Handler for the 'store' tool
 *
 * Stores memories in project-level .goldfish/memories/ JSONL files
 * and triggers background embedding generation.
 */

import { getWorkspaceStorage } from '../storage/workspace.js';
import { syncWorkspace } from '../sync/index.js';
import type { Memory, MemoryType, MemorySource } from '../storage/types';

/**
 * Valid memory types
 */
const VALID_TYPES: MemoryType[] = [
  'decision',
  'bug-fix',
  'feature',
  'insight',
  'observation',
  'refactor'
];

/**
 * Valid memory sources
 */
const VALID_SOURCES: MemorySource[] = [
  'agent',
  'user',
  'system',
  'development-session'
];

/**
 * Store tool arguments
 */
interface StoreArgs {
  type: MemoryType;
  source: MemorySource;
  content: string;
  tags?: string[];
  workspacePath?: string;
}

/**
 * Handles the 'store' tool call
 *
 * Stores a memory in project-level JSONL storage and triggers
 * background embedding generation.
 *
 * @param args Tool arguments
 * @returns MCP tool response
 */
export async function handleStore(args: any) {
  // Validate required fields
  if (!args.type) {
    throw new Error('Missing required field: type');
  }
  if (!args.source) {
    throw new Error('Missing required field: source');
  }
  if (!args.content) {
    throw new Error('Missing required field: content');
  }

  // Validate type enum
  if (!VALID_TYPES.includes(args.type)) {
    throw new Error(`Invalid type: ${args.type}. Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  // Validate source enum
  if (!VALID_SOURCES.includes(args.source)) {
    throw new Error(`Invalid source: ${args.source}. Must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  const typedArgs = args as StoreArgs;

  // Get workspace path (use provided or current directory)
  const workspacePath = typedArgs.workspacePath || process.cwd();

  // Get or create workspace storage
  const storage = await getWorkspaceStorage(workspacePath);

  // Store the memory
  const memory = await storage.store({
    type: typedArgs.type,
    source: typedArgs.source,
    content: typedArgs.content,
    tags: typedArgs.tags
  });

  // Trigger background embedding sync
  // Note: We don't await this - it runs in the background
  const memoriesDir = storage.getMemoriesDir();
  const workspaceName = workspacePath.split(/[/\\]/).pop() || 'default';

  setImmediate(async () => {
    try {
      await syncWorkspace(workspaceName, memoriesDir);
    } catch (error: any) {
      console.error(`⚠️  Background sync failed for ${workspaceName}:`, error.message);
    }
  });

  // Determine file path and line number
  const timestamp = memory.timestamp;
  const dateKey = timestamp.split('T')[0]; // Extract YYYY-MM-DD
  const filePath = `.goldfish/memories/${dateKey}.jsonl`;

  // Build response
  const response = {
    success: true,
    memory,
    filePath,
    message: `✅ Memory stored in ${filePath}`
  };

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(response, null, 2)
      }
    ]
  };
}
