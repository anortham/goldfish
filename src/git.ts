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
    const filesSet = new Set<string>();

    if (filesResult.success) {
      for (const file of filesResult.stdout.toString().trim().split('\n')) {
        if (file) {
          filesSet.add(file);
        }
      }
    }

    // Include untracked files as well
    const untrackedResult = spawnSync(
      ['git', 'ls-files', '--others', '--exclude-standard'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    if (untrackedResult.success) {
      for (const file of untrackedResult.stdout.toString().trim().split('\n')) {
        if (file) {
          filesSet.add(file);
        }
      }
    }

    const files = filesSet.size > 0 ? Array.from(filesSet).sort() : undefined;

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
