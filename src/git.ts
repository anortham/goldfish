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

/**
 * Get current git context (branch, commit, changed files)
 * Returns undefined values if not in a git repository
 *
 * @param cwd - Optional working directory for git commands (defaults to process.cwd())
 */
export function getGitContext(cwd?: string): GitContext {
  const spawnOpts = { stdio: ['ignore', 'pipe', 'ignore'] as const, cwd };

  try {
    // Get current branch
    const branchResult = spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], spawnOpts);
    const branch = branchResult.success
      ? branchResult.stdout.toString().trim()
      : undefined;

    // Get current commit (short hash)
    const commitResult = spawnSync(['git', 'rev-parse', '--short', 'HEAD'], spawnOpts);
    const commit = commitResult.success
      ? commitResult.stdout.toString().trim()
      : undefined;

    const filesSet = new Set<string>();

    // Query unstaged and staged changes separately so repos with unborn HEAD still report files.
    for (const result of [
      spawnSync(['git', 'diff', '--name-only'], spawnOpts),
      spawnSync(['git', 'diff', '--cached', '--name-only'], spawnOpts)
    ]) {
      if (!result.success) {
        continue;
      }

      for (const file of result.stdout.toString().trim().split('\n')) {
        if (file) {
          filesSet.add(file);
        }
      }
    }

    // Include untracked files as well
    const untrackedResult = spawnSync(
      ['git', 'ls-files', '--others', '--exclude-standard'],
      spawnOpts
    );
    if (untrackedResult.success) {
      for (const file of untrackedResult.stdout.toString().trim().split('\n')) {
        if (file) {
          filesSet.add(file);
        }
      }
    }

    // Filter excluded paths and cap file count
    for (const file of filesSet) {
      if (EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix))) {
        filesSet.delete(file);
      }
    }
    const sorted = Array.from(filesSet).sort();
    const files = sorted.length > 0 ? sorted.slice(0, MAX_GIT_FILES) : undefined;

    const context: GitContext = {};
    if (branch) context.branch = branch;
    if (commit) context.commit = commit;
    if (files) context.files = files;
    return context;
  } catch {
    // Not in a git repository or git not available
    return {};
  }
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
