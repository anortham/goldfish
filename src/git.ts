/**
 * Git context capture utilities
 *
 * Captures current git state (branch, commit, changed files) for checkpoints
 */

import { spawnSync } from 'bun';
import type { GitContext } from './types';

/**
 * Get current git context (branch, commit, changed files)
 * Returns undefined values if not in a git repository
 */
export function getGitContext(): GitContext {
  try {
    // Get current branch
    const branchResult = spawnSync(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const branch = branchResult.success
      ? branchResult.stdout.toString().trim()
      : undefined;

    // Get current commit (short hash)
    const commitResult = spawnSync(['git', 'rev-parse', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const commit = commitResult.success
      ? commitResult.stdout.toString().trim()
      : undefined;

    // Get changed files (staged + unstaged, excluding untracked)
    const filesResult = spawnSync(['git', 'diff', '--name-only', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const files = filesResult.success
      ? filesResult.stdout.toString().trim().split('\n').filter(Boolean)
      : undefined;

    return { branch, commit, files };
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
