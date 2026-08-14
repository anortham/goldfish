#!/usr/bin/env bun

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);

  try {
    process.stderr.write(`goldfish cursor session-start hook: ${message}\n`);
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
  process.stdout.write(JSON.stringify({ additional_context: getHookContext() }));
} catch (error) {
  reportError(error);
}
