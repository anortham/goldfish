#!/usr/bin/env bun

/**
 * Release guard: when HEAD carries an exact release tag (vX.Y.Z), that tag
 * must equal SERVER_VERSION. The version-surface tests only check that the
 * five version files agree with each other — they all pass when every file
 * is stale together. Comparing against the git tag catches exactly that.
 *
 * Runs as part of the test suite (vacuously green off-tag) and standalone:
 *   bun scripts/version-tag-check.ts
 */

import { spawnSync } from 'bun';

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

/**
 * Every release-shaped tag on HEAD must equal v{version}. All tags are
 * checked — `git describe` picks a single tag, so a non-release tag on the
 * same commit could otherwise shadow a mismatched release tag.
 */
export function checkVersionAgainstTags(
  tags: string[],
  version: string
): { ok: boolean; message: string } {
  const releaseTags = tags.filter(tag => RELEASE_TAG_PATTERN.test(tag));

  if (releaseTags.length === 0) {
    return { ok: true, message: 'HEAD carries no release tag; nothing to check' };
  }

  const mismatched = releaseTags.filter(tag => tag !== `v${version}`);
  if (mismatched.length === 0) {
    return { ok: true, message: `release tag ${releaseTags.join(', ')} matches SERVER_VERSION ${version}` };
  }

  return {
    ok: false,
    message: `release tag ${mismatched.join(', ')} does not match SERVER_VERSION ${version} — bump all version surfaces before tagging`
  };
}

export function getTagsForHead(cwd?: string): string[] {
  const result = spawnSync(['git', 'tag', '--points-at', 'HEAD'], {
    ...(cwd ? { cwd } : {}),
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (!result.success) return [];
  return (result.stdout?.toString().trim() || '').split('\n').filter(Boolean);
}

if (import.meta.main) {
  const { SERVER_VERSION } = await import('../src/server');
  const result = checkVersionAgainstTags(getTagsForHead(), SERVER_VERSION);
  console.log(result.message);
  if (!result.ok) process.exit(1);
}
