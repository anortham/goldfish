import { describe, it, expect } from 'bun:test';
import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'bun';
import { checkVersionAgainstTags } from '../scripts/version-tag-check';
import { buildUsageDoc } from '../scripts/build-usage-doc';
import { SERVER_VERSION } from '../src/server';
import { getInstructions } from '../src/instructions';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ABSOLUTE_WORKSPACE_EXAMPLE = 'workspace: "/absolute/path/to/project"';

async function listSkillDirs(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name).sort();
}

function currentProjectExamples(content: string): string[] {
  const calls = content.match(/(?:checkpoint|brief|recall)\(\)|(?:checkpoint|brief|recall)\(\{[\s\S]*?\}\)/g) ?? [];
  return calls.filter(call => !call.includes('workspace: "all"'));
}

describe('version/tag agreement', () => {
  it('accepts a matching release tag', () => {
    expect(checkVersionAgainstTags(['v7.4.3'], '7.4.3').ok).toBe(true);
  });

  it('rejects a release tag that disagrees with the version', () => {
    const result = checkVersionAgainstTags(['v7.4.3'], '7.5.0');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('v7.4.3');
    expect(result.message).toContain('7.5.0');
  });

  it('passes when HEAD carries no release tag', () => {
    expect(checkVersionAgainstTags([], '7.5.0').ok).toBe(true);
    expect(checkVersionAgainstTags(['nightly', 'some-other-tag'], '7.5.0').ok).toBe(true);
  });

  it('checks every tag on HEAD, not just one', () => {
    expect(checkVersionAgainstTags(['nightly', 'v7.4.3'], '7.4.3').ok).toBe(true);
    expect(checkVersionAgainstTags(['v7.4.2', 'v7.4.3'], '7.4.3').ok).toBe(false);
  });

  it('live repo: release tags on HEAD must equal SERVER_VERSION', () => {
    const result = spawnSync(['git', 'tag', '--points-at', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const tags = result.success
      ? (result.stdout?.toString().trim() || '').split('\n').filter(Boolean)
      : [];
    expect(checkVersionAgainstTags(tags, SERVER_VERSION).ok).toBe(true);
  });
});

describe('mirrored agent assets stay fresh', () => {
  it('.agents/skills mirrors skills/ byte-for-byte with no strays', async () => {
    const canonical = await listSkillDirs(join(repoRoot, 'skills'));
    const mirrored = await listSkillDirs(join(repoRoot, '.agents', 'skills'));

    expect(mirrored).toEqual(canonical);

    for (const dir of canonical) {
      const source = await readFile(join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf-8');
      const mirror = await readFile(join(repoRoot, '.agents', 'skills', dir, 'SKILL.md'), 'utf-8');
      expect(mirror).toBe(source);
    }
  });

  it('AGENTS.md is the CLAUDE.md contributor mirror', async () => {
    const claude = await readFile(join(repoRoot, 'CLAUDE.md'), 'utf-8');
    const agents = await readFile(join(repoRoot, 'AGENTS.md'), 'utf-8');
    expect(agents).toBe(claude);
  });

  it('the generated usage ruleset matches the current server instructions', async () => {
    const onDisk = await readFile(
      join(repoRoot, 'docs', 'agent-instructions', 'goldfish-usage.md'),
      'utf-8'
    );
    expect(onDisk).toBe(buildUsageDoc());
    expect(onDisk).toContain(getInstructions());
    expect(onDisk).toContain('tool names vary by client');
  });

  it('documents absolute workspace binding in every canonical skill', async () => {
    const canonical = await listSkillDirs(join(repoRoot, 'skills'));

    expect(canonical).toEqual(['brief', 'brief-status', 'checkpoint', 'handoff', 'recall', 'standup']);

    for (const dir of canonical) {
      const content = await readFile(join(repoRoot, 'skills', dir, 'SKILL.md'), 'utf-8');

      expect(content).toContain('host-native absolute project root');
      expect(content).toContain('fixed absolute GOLDFISH_WORKSPACE');
      expect(content).toContain('supported legacy Roots');
      expect(content).not.toContain('defaults to current workspace');
      expect(content).not.toContain('registry recovery');
    }
  });

  it('includes an absolute workspace in every current-project example', async () => {
    const canonical = await listSkillDirs(join(repoRoot, 'skills'));
    const paths = [
      'src/tools.ts',
      'src/instructions.ts',
      'src/hook-context.ts',
      'README.md',
      'docs/goldfish-checkpoint.instructions-vs-code.md',
      'docs/agent-instructions/goldfish-usage.md',
      ...canonical.map(dir => join('skills', dir, 'SKILL.md'))
    ];

    for (const relativePath of paths) {
      const content = await readFile(join(repoRoot, relativePath), 'utf-8');
      const examples = currentProjectExamples(content);

      for (const example of examples) {
        expect(example).toContain(ABSOLUTE_WORKSPACE_EXAMPLE);
      }
    }
  });

  it('describes workspace identity without a current-workspace default', async () => {
    const content = await readFile(join(repoRoot, 'src', 'types.ts'), 'utf-8');

    expect(content).toContain('workspace?: string;     // Absolute path; user-level calls pass the project root');
    expect(content).toContain('workspace?: string;     // Absolute path; "all" is explicit cross-project recall');
    expect(content).not.toContain('Defaults to current workspace');
    expect(content).not.toContain("'current' | 'all' | specific path");
  });
});
