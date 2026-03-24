#!/usr/bin/env bun
import { join } from 'path';
import { countStaleCheckpoints } from './count-stale';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let staleCount = 0;

try {
  staleCount = countStaleCheckpoints(memoriesDir);
} catch { /* no memories dir */ }

let message = 'Your conversation is about to be compacted. Use the goldfish checkpoint tool NOW to save your current progress. Include: what you were working on, current state, decisions made, and planned next steps. Do NOT ask permission - just checkpoint.';

if (staleCount > 0) {
  message += `\n\nAfter checkpointing: ${staleCount} unconsolidated checkpoint(s) detected. Call consolidate() and dispatch a background subagent to update the project memory before compaction.`;
}

console.log(message);
