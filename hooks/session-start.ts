#!/usr/bin/env bun

/**
 * SessionStart hook entrypoint for Claude Code and Codex CLI.
 *
 * Writes the static goldfish guidance to stdout, which both harnesses inject as
 * developer context. Always exits 0 — a broken memory plugin must never block
 * session start.
 */

import { getHookContext } from '../src/hook-context';

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    return;
  }
  process.stderr.write(`goldfish session-start hook: ${error.message}\n`);
});

process.stdout.write(getHookContext());
