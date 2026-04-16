#!/usr/bin/env bun

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
