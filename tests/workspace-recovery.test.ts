import { describe, it, expect, afterEach } from 'bun:test';
import { recoverWorkspace, formatKnownProjects } from '../src/workspace-recovery';
import type { RegisteredProject } from '../src/types';
import { mkdir, rm, symlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

// Helper to build a registered-project stub. The recovery orchestrator uses
// listRegisteredProjects semantics: entries should have a live .memories/ dir
// for 4a/4b (the real reader filters stale entries). Tests create the dirs so
// realpath-based ancestor checks and the "single registered" path are honest.
function project(path: string): RegisteredProject {
  const base = path.replace(/^.*[/\\]/, '');
  return { path, name: base, registered: '2026-06-26T00:00:00.000Z' };
}

describe('recoverWorkspace', () => {
  const tmpDirs: string[] = [];
  const originalHome = process.env.HOME;

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `test-goldfish-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tmpDirs.push(dir);
    return dir;
  }

  function reader(projects: RegisteredProject[]) {
    return async () => projects;
  }

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  it('4a: resolves to the registered root when cwd is a subdirectory of it', async () => {
    const root = makeTmpDir();
    await mkdir(join(root, '.memories'), { recursive: true });
    const sub = join(root, 'src', 'deep');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(root)]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result).toEqual({ path: root, source: 'registry' });
  });

  it('4a: picks the deepest registered ancestor when multiple ancestors are registered', async () => {
    const outer = makeTmpDir();
    await mkdir(join(outer, '.memories'), { recursive: true });
    const inner = join(outer, 'workspaces', 'inner');
    await mkdir(join(inner, '.memories'), { recursive: true });
    const sub = join(inner, 'lib');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(outer), project(inner)]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result).toEqual({ path: inner, source: 'registry' });
  });

  it('prefers a nearer nested project marker over an outer registered ancestor', async () => {
    const outer = makeTmpDir();
    await mkdir(join(outer, '.memories'), { recursive: true });
    const inner = join(outer, 'workspaces', 'inner');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, '.git'), '');
    const sub = join(inner, 'lib');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(outer)]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result).toEqual({ path: inner, source: 'walk' });
  });

  it('4a: resolves via parent walk (source=walk) when cwd is under a project with .memories/ but NOT registered', async () => {
    const root = makeTmpDir();
    await mkdir(join(root, '.memories'), { recursive: true });
    const sub = join(root, 'src');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result).toEqual({ path: root, source: 'walk' });
  });

  it('4b: single registered project + unsafe cwd + recall -> resolves to that project', async () => {
    const projectDir = makeTmpDir();
    await mkdir(join(projectDir, '.memories'), { recursive: true });
    const home = makeTmpDir();
    // No .memories/ or .git/ under home so the walk finds nothing.

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'recall',
      registryReader: reader([project(projectDir)]),
      env: { HOME: home },
    });

    expect(result).toEqual({ path: projectDir, source: 'registry' });
  });

  it('4b: single registered project + unsafe cwd + checkpoint -> refuses (returns undefined)', async () => {
    const projectDir = makeTmpDir();
    await mkdir(join(projectDir, '.memories'), { recursive: true });
    const home = makeTmpDir();

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'checkpoint',
      registryReader: reader([project(projectDir)]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('4a: registered $HOME with .memories/ + cwd=home + checkpoint -> refuses (returns undefined)', async () => {
    // Regression guard: a home directory that was registered as a project
    // (e.g. the user once ran goldfish from home) must NOT let a mutating tool
    // recover to home via 4a. The unsafe-cwd guard has to win over a stale
    // home registration for writes; only recall may use it.
    const home = makeTmpDir();
    await mkdir(join(home, '.memories'), { recursive: true });

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'checkpoint',
      registryReader: reader([project(home)]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('4a: registered $HOME with .memories/ + cwd=home + brief -> refuses (returns undefined)', async () => {
    const home = makeTmpDir();
    await mkdir(join(home, '.memories'), { recursive: true });

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'brief',
      registryReader: reader([project(home)]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('4a: registered $HOME with .memories/ + cwd=home + recall -> resolves to home (read-only allowed)', async () => {
    // Recall is read-only, so using a registered home is acceptable: the user
    // explicitly registered it and we are not writing anything new there.
    const home = makeTmpDir();
    await mkdir(join(home, '.memories'), { recursive: true });

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'recall',
      registryReader: reader([project(home)]),
      env: { HOME: home },
    });

    expect(result).toEqual({ path: home, source: 'registry' });
  });

  it('4b: single registered project + unsafe cwd + brief -> refuses (returns undefined)', async () => {
    const projectDir = makeTmpDir();
    await mkdir(join(projectDir, '.memories'), { recursive: true });
    const home = makeTmpDir();

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'brief',
      registryReader: reader([project(projectDir)]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('4b: two registered projects + unsafe cwd + recall -> refuses (returns undefined)', async () => {
    const a = makeTmpDir();
    await mkdir(join(a, '.memories'), { recursive: true });
    const b = makeTmpDir();
    await mkdir(join(b, '.memories'), { recursive: true });
    const home = makeTmpDir();

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'recall',
      registryReader: reader([project(a), project(b)]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('first-use refusal: empty registry, no markers, unsafe cwd -> returns undefined', async () => {
    const home = makeTmpDir();

    const result = await recoverWorkspace({
      cwd: home,
      tool: 'recall',
      registryReader: reader([]),
      env: { HOME: home },
    });

    expect(result).toBeUndefined();
  });

  it('safe cwd with no enclosing markers and no registered ancestor -> returns undefined (accept cwd upstream)', async () => {
    // A standalone safe dir with no .memories/.git/ and no registered ancestor.
    const standalone = makeTmpDir();
    await mkdir(standalone, { recursive: true });

    const result = await recoverWorkspace({
      cwd: standalone,
      tool: 'checkpoint',
      registryReader: reader([]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result).toBeUndefined();
  });

  it('4a: macOS /private symlink parity — cwd via /var matches a registered /private/var path', async () => {
    // On macOS, /var is a symlink to /private/var. realpath canonicalizes both.
    // Create a real project under the tmpdir and register it via the resolved
    // (realpath) path, then call recovery with a cwd expressed through a
    // symlink that aliases the same location.
    const realRoot = makeTmpDir();
    await mkdir(join(realRoot, '.memories'), { recursive: true });
    const linkParent = makeTmpDir();
    await mkdir(linkParent, { recursive: true });
    const link = join(linkParent, 'alias');
    await symlink(realRoot, link);
    const sub = join(link, 'src');
    await mkdir(sub, { recursive: true });

    // Register the real path; recovery must still match the symlinked cwd via realpath.
    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(realRoot)]),
      env: { HOME: '/nonexistent-home' },
    });

    // The resolved root may be reported as either the registered real path or
    // the symlinked ancestor, depending on which branch matched. Both point at
    // the same on-disk project, so compare via realpath.
    expect(result?.source).toBe('registry');
    const { realpath } = await import('fs/promises');
    expect(await realpath(result!.path)).toBe(await realpath(realRoot));
  });

  it('4a: realpath failure falls back to string-prefix comparison without throwing', async () => {
    // A registered path that does not exist on disk (realpath throws) but whose
    // string form is an ancestor of cwd should still match via the fallback.
    const ghost = '/nonexistent/ghost-project';
    const sub = `${ghost}/src`;

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(ghost)]),
      env: { HOME: '/nonexistent-home' },
    });

    // No .memories/ on disk for the ghost, so 4a should still match by path
    // (the registered entry's liveness is the reader's responsibility; the
    // orchestrator trusts the reader's filter and matches by path prefix).
    expect(result).toEqual({ path: ghost, source: 'registry' });
  });

  it('4a: realpath fallback matches Windows drive letters case-insensitively', async () => {
    const result = await recoverWorkspace({
      cwd: 'c:/Users/Murphy/source/goldfish/src',
      tool: 'checkpoint',
      registryReader: reader([project('C:/Users/Murphy/source/goldfish')]),
      env: { HOME: 'Z:/not-home' },
    });

    expect(result).toEqual({ path: 'C:/Users/Murphy/source/goldfish', source: 'registry' });
  });
});

// Probe for the selection-gap concern: chooseRecoveryCandidate compares only
// path-key LENGTH between the registry ancestor and the parent-walk match,
// with no ancestry check between them, and the two use different path models
// (registry: realpath/normalized; walk: raw dirname chain). These tests pin
// the actual shipped behavior under disagreement so we can decide whether the
// length-only comparison needs an ancestry guard.
describe('recoverWorkspace selection between registry and walk candidates', () => {
  const tmpDirs: string[] = [];
  const originalHome = process.env.HOME;

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `test-goldfish-sel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tmpDirs.push(dir);
    return dir;
  }

  function reader(projects: RegisteredProject[]) {
    return async () => projects;
  }

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  it('prefers the deeper walk match when cwd is inside a registered outer project but a deeper unregistered dir has .memories/', async () => {
    // outer/ is registered (has .memories/). outer/work/inner is NOT registered
    // but has its own .memories/. cwd = outer/work/inner/src.
    // Registry ancestor = outer (registered). Walk match = outer/work/inner (deeper).
    // Length-only comparison should pick the deeper walk match.
    const outer = makeTmpDir();
    await mkdir(join(outer, '.memories'), { recursive: true });
    const inner = join(outer, 'work', 'inner');
    await mkdir(join(inner, '.memories'), { recursive: true });
    const sub = join(inner, 'src');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(outer)]),
      env: { HOME: '/nonexistent-home' },
    });

    // Deeper candidate wins -> walk match at inner.
    expect(result?.source).toBe('walk');
    const { realpath } = await import('fs/promises');
    expect(await realpath(result!.path)).toBe(await realpath(inner));
  });

  it('prefers the deeper registered ancestor when the walk match is shallower', async () => {
    // Registered inner project is deeper than a walk-found .git at an outer dir.
    // inner/ is registered (has .memories/). outer/ is NOT registered but has .git.
    // cwd = outer/inner/src. Registry ancestor = inner. Walk match = inner's .memories/
    // (walk is inclusive from cwd upward and prefers .memories/ over .git/), so both
    // agree on inner. This pins that the walk does not skip past a .memories/ at cwd's
    // ancestor to reach an outer .git.
    const outer = makeTmpDir();
    await mkdir(outer, { recursive: true });
    await writeFile(join(outer, '.git'), '');
    const inner = join(outer, 'inner');
    await mkdir(join(inner, '.memories'), { recursive: true });
    const sub = join(inner, 'src');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(inner)]),
      env: { HOME: '/nonexistent-home' },
    });

    const { realpath } = await import('fs/promises');
    expect(await realpath(result!.path)).toBe(await realpath(inner));
  });

  it('drops an unsafe registered $HOME and still recovers via walk to a deeper safe project (checkpoint)', async () => {
    // home/ is registered AND is cwd's ancestor, so findRegisteredAncestor
    // returns home. But home is unsafe -> the mutating path must drop it and
    // still let the walk find home/work/proj (.memories/), which is the safe
    // project the agent actually wants. Pins "drop unsafe registry, keep walk".
    const home = makeTmpDir();
    await mkdir(join(home, '.memories'), { recursive: true });
    const proj = join(home, 'work', 'proj');
    await mkdir(join(proj, '.memories'), { recursive: true });
    const sub = join(proj, 'src');
    await mkdir(sub, { recursive: true });

    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(home)]),
      env: { HOME: home },
    });

    expect(result?.source).toBe('walk');
    const { realpath } = await import('fs/promises');
    expect(await realpath(result!.path)).toBe(await realpath(proj));
  });

  it('treats registry and walk candidates pointing at the same on-disk dir (via symlink) as equal, returning registry', async () => {
    // Registry is registered via the realpath form; the walk reaches the same
    // dir through a symlink ancestor. comparablePathKey canonicalizes both via
    // realpath, so they must compare EQUAL — choosing registry (the equality
    // branch) rather than falling into the length tiebreak. This pins that a
    // symlink does not flip registry->walk for the same project.
    const realRoot = makeTmpDir();
    await mkdir(join(realRoot, '.memories'), { recursive: true });
    const linkParent = makeTmpDir();
    await mkdir(linkParent, { recursive: true });
    const link = join(linkParent, 'alias');
    await symlink(realRoot, link);
    const sub = join(link, 'src');
    await mkdir(sub, { recursive: true });

    // Register the real path; the walk discovers the same dir via the symlink.
    // Both candidates point at realRoot on disk -> equality -> registry wins.
    const result = await recoverWorkspace({
      cwd: sub,
      tool: 'checkpoint',
      registryReader: reader([project(realRoot)]),
      env: { HOME: '/nonexistent-home' },
    });

    expect(result?.source).toBe('registry');
    const { realpath } = await import('fs/promises');
    expect(await realpath(result!.path)).toBe(await realpath(realRoot));
  });
});

describe('formatKnownProjects', () => {
  it('returns empty string for an empty list', () => {
    expect(formatKnownProjects([])).toBe('');
  });

  it('formats a single project path', () => {
    const result = formatKnownProjects([
      { path: '/Users/me/proj', name: 'proj', registered: '2026-06-26T00:00:00.000Z' },
    ]);
    expect(result).toContain('Known projects:');
    expect(result).toContain('/Users/me/proj');
  });

  it('formats multiple project paths, joined', () => {
    const result = formatKnownProjects([
      { path: '/Users/me/a', name: 'a', registered: '2026-06-26T00:00:00.000Z' },
      { path: '/Users/me/b', name: 'b', registered: '2026-06-26T00:00:00.000Z' },
    ]);
    expect(result).toContain('/Users/me/a');
    expect(result).toContain('/Users/me/b');
  });
});
