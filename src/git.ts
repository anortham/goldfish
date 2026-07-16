/**
 * Git context capture utilities
 *
 * Captures current git state (branch, commit, changed files) for checkpoints
 */

import { spawnSync } from 'bun';
import type { GitContext } from './types';

/** Maximum number of files to include in git context */
export const MAX_GIT_FILES = 30;

/** Paths to exclude from git file lists */
const EXCLUDED_PREFIXES = ['.memories/'];

/** Run one git command asynchronously; null on any failure. */
async function runGit(args: string[], cwd?: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      ...(cwd ? { cwd } : {}),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore'
    });
    const [output, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited
    ]);
    return exitCode === 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Get current git context (branch, commit, changed files)
 * Returns undefined values if not in a git repository
 *
 * All git commands run concurrently and never block the event loop — git is
 * the dominant cost of a checkpoint save, and the MCP server must keep
 * serving other requests while it runs.
 *
 * @param cwd - Optional working directory for git commands (defaults to process.cwd())
 */
export async function getGitContext(cwd?: string): Promise<GitContext> {
  // Unstaged and staged changes are queried separately so repos with unborn
  // HEAD still report files.
  const [branchOut, commitOut, unstagedOut, stagedOut, untrackedOut] = await Promise.all([
    runGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
    runGit(['rev-parse', '--short', 'HEAD'], cwd),
    runGit(['diff', '--name-only'], cwd),
    runGit(['diff', '--cached', '--name-only'], cwd),
    runGit(['ls-files', '--others', '--exclude-standard'], cwd)
  ]);

  const branch = branchOut?.trim() || undefined;
  const commit = commitOut?.trim() || undefined;

  const filesSet = new Set<string>();
  for (const out of [unstagedOut, stagedOut, untrackedOut]) {
    if (out === null) continue;
    for (const file of out.trim().split('\n')) {
      if (file && !EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix))) {
        filesSet.add(file);
      }
    }
  }
  const sorted = Array.from(filesSet).sort();
  const files = sorted.length > 0 ? sorted.slice(0, MAX_GIT_FILES) : undefined;

  const context: GitContext = {};
  if (branch) context.branch = branch;
  if (commit) context.commit = commit;
  if (files) context.files = files;
  return context;
}

/**
 * Check if current directory is in a git repository
 */
export function isGitRepository(): boolean {
  try {
    const result = spawnSync(['git', 'rev-parse', '--git-dir'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return result.success;
  } catch {
    return false;
  }
}
