/**
 * Goldfish Memory Storage Module
 *
 * Provides JSONL-based storage for project memories with:
 * - Git-friendly format (newline-delimited JSON)
 * - BLAKE3 hashing for change detection
 * - Project-level storage (.goldfish/memories/)
 * - Clean TypeScript API
 */

// Core types
export * from './types';

// JSONL utilities
export * from './jsonl';

// BLAKE3 hashing
export * from './hash';

// Workspace storage
export * from './workspace';
