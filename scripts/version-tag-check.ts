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

export function checkVersionAgainstTag(
  tag: string | null,
  version: string
): { ok: boolean; message: string } {
  if (!tag || !RELEASE_TAG_PATTERN.test(tag)) {
    return { ok: true, message: 'HEAD is not an exact release tag; nothing to check' };
  }

  if (tag === `v${version}`) {
    return { ok: true, message: `release tag ${tag} matches SERVER_VERSION ${version}` };
  }

  return {
    ok: false,
    message: `release tag ${tag} does not match SERVER_VERSION ${version} — bump all version surfaces before tagging`
  };
}

export function getExactTagForHead(cwd?: string): string | null {
  const result = spawnSync(['git', 'describe', '--exact-match', '--tags', 'HEAD'], {
    ...(cwd ? { cwd } : {}),
    stdio: ['ignore', 'pipe', 'ignore']
  });
  if (!result.success) return null;
  return result.stdout?.toString().trim() || null;
}

if (import.meta.main) {
  const { SERVER_VERSION } = await import('../src/server');
  const result = checkVersionAgainstTag(getExactTagForHead(), SERVER_VERSION);
  console.log(result.message);
  if (!result.ok) process.exit(1);
}
