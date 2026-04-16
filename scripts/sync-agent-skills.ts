#!/usr/bin/env bun

/**
 * Sync script for repo-local agent assets.
 *
 * Two responsibilities:
 *   1. Mirror canonical skills from `skills/` into `.agents/skills/` so
 *      non-Claude harnesses (Codex, OpenCode, etc.) can discover them.
 *   2. Generate `AGENTS.md` from the canonical `CLAUDE.md` at repo root.
 *      `CLAUDE.md` is the single source of truth; `AGENTS.md` is a byte-for-byte
 *      copy maintained for harnesses that read AGENTS.md instead. Edit CLAUDE.md
 *      and rerun `bun run sync:agent-skills` — never edit AGENTS.md by hand.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

async function writeAtomically(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tempPath, content, 'utf-8');
  await rename(tempPath, path);
}

async function listDirectories(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const canonicalSkillsDir = join(repoRoot, 'skills');
const mirroredSkillsDir = join(repoRoot, '.agents', 'skills');

const canonicalSkillDirs = await listDirectories(canonicalSkillsDir);

await mkdir(mirroredSkillsDir, { recursive: true });

const existingMirroredDirs = await listDirectories(mirroredSkillsDir);
for (const skillDir of existingMirroredDirs) {
  if (!canonicalSkillDirs.includes(skillDir)) {
    await rm(join(mirroredSkillsDir, skillDir), { recursive: true, force: true });
  }
}

for (const skillDir of canonicalSkillDirs) {
  const sourcePath = join(canonicalSkillsDir, skillDir, 'SKILL.md');
  const targetDir = join(mirroredSkillsDir, skillDir);
  const targetPath = join(targetDir, 'SKILL.md');
  const content = await readFile(sourcePath, 'utf-8');

  await mkdir(targetDir, { recursive: true });
  await writeAtomically(targetPath, content);
}

console.log(`Synced ${canonicalSkillDirs.length} Goldfish skills into .agents/skills`);

const claudeMdPath = join(repoRoot, 'CLAUDE.md');
const agentsMdPath = join(repoRoot, 'AGENTS.md');
const claudeMdContent = await readFile(claudeMdPath, 'utf-8');
await writeAtomically(agentsMdPath, claudeMdContent);
console.log('Synced AGENTS.md from CLAUDE.md');
