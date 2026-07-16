#!/usr/bin/env bun

/**
 * SessionStart hook entrypoint for Claude Code and Codex CLI.
 *
 * Writes the static goldfish guidance to stdout, which both harnesses inject as
 * developer context. Always exits 0 — a broken memory plugin must never block
 * session start.
 */

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  try {
    process.stderr.write(`goldfish session-start hook: ${message}\n`);
  } catch {
    return;
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    return;
  }
  reportError(error);
});

try {
  const { getHookContext } = await import('../src/hook-context');
  process.stdout.write(getHookContext());
} catch (error) {
  reportError(error);
}
