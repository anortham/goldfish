#!/usr/bin/env bun
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const workspace = process.cwd();
const memoriesDir = join(workspace, '.memories');

let staleCount = 0;

try {
  let lastTimestamp = 0;
  try {
    const raw = readFileSync(join(memoriesDir, '.last-consolidated'), 'utf-8');
    const state = JSON.parse(raw);
    lastTimestamp = new Date(state.timestamp).getTime();
  } catch { /* no state */ }

  try {
    const entries = readdirSync(memoriesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dateDir = join(memoriesDir, entry.name);
      const files = readdirSync(dateDir);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const mtime = statSync(join(dateDir, file)).mtimeMs;
        if (mtime > lastTimestamp) staleCount++;
      }
    }
  } catch { /* no dirs */ }
} catch { /* no memories dir */ }

let message = 'Your conversation is about to be compacted. Use the goldfish checkpoint tool NOW to save your current progress. Include: what you were working on, current state, decisions made, and planned next steps. Do NOT ask permission - just checkpoint.';

if (staleCount > 0) {
  message += `\n\nAfter checkpointing: ${staleCount} unconsolidated checkpoint(s) detected. Call consolidate() and dispatch a background subagent to update the project memory before compaction.`;
}

console.log(message);
