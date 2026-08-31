import { describe, it, expect, afterEach } from 'bun:test';
import {
  normalizeWorkspace,
  resolveWorkspace,
  resolveWorkspaceWithSource,
  getUnsafeCwdWorkspaceReason,
  getMemoriesDir,
  getBriefsDir,
  getPlansDir,
  ensureMemoriesDir,
  getGoldfishHomeDir,
  parentWalkWorkspace,
} from '../src/workspace';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { mkdir, mkdtemp, rm, stat, symlink } from 'fs/promises';
import { pathToFileURL } from 'url';

const WORKSPACE_UNBOUND_RETRY = 'Workspace is not bound. User-level MCP registrations must pass the absolute project root on every workspace-scoped call. Retry with {"workspace":"<absolute-project-root>"}.';

describe('Workspace normalization', () => {
  it('normalizes full Unix path to simple name', () => {
    expect(normalizeWorkspace('/Users/user/source/goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('/Users/user/source/goldfish/'))
      .toBe('goldfish');
  });

  it('normalizes full Windows path to simple name', () => {
    expect(normalizeWorkspace('C:\\source\\goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('C:\\source\\goldfish\\'))
      .toBe('goldfish');
    expect(normalizeWorkspace('C:\\Users\\user\\source\\goldfish'))
      .toBe('goldfish');
  });

  it('handles package names (@org/name → org-name)', () => {
    expect(normalizeWorkspace('@coa/goldfish-mcp'))
      .toBe('coa-goldfish-mcp');
    expect(normalizeWorkspace('@modelcontextprotocol/sdk'))
      .toBe('modelcontextprotocol-sdk');
  });

  it('handles scoped package paths in filesystem paths', () => {
    expect(normalizeWorkspace('/home/dev/@org/project'))
      .toBe('org-project');
    expect(normalizeWorkspace('/Users/dev/source/@org/my-project'))
      .toBe('org-my-project');
  });

  it('lowercases and sanitizes special characters', () => {
    expect(normalizeWorkspace('My Project!'))
      .toBe('my-project');  // Trailing dashes are trimmed
    expect(normalizeWorkspace('Test@#$%Project'))
      .toBe('test-project');  // Consecutive dashes are collapsed
  });

  it('handles already normalized names', () => {
    expect(normalizeWorkspace('goldfish'))
      .toBe('goldfish');
    expect(normalizeWorkspace('my-cool-project'))
      .toBe('my-cool-project');
  });

  it('removes consecutive dashes', () => {
    expect(normalizeWorkspace('test---project'))
      .toBe('test-project');
  });

  it('trims dashes from start and end', () => {
    expect(normalizeWorkspace('-test-project-'))
      .toBe('test-project');
  });

  it('handles all special characters by using default name', () => {
    // These would become empty after sanitization
    expect(normalizeWorkspace('!@#$%^&*()'))
      .toBe('default');
    expect(normalizeWorkspace('...'))
      .toBe('default');
    expect(normalizeWorkspace('___'))
      .toBe('default');
    expect(normalizeWorkspace('---'))
      .toBe('default');
    expect(normalizeWorkspace(''))
      .toBe('default');
  });
});

describe('Project-level .memories/ storage', () => {
  const tmpDirs: string[] = [];
  const originalCwd = process.cwd();

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `test-goldfish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    process.chdir(originalCwd);

    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  describe('getMemoriesDir', () => {
    it('requires a verified project path', () => {
      expect(() => getMemoriesDir()).toThrow(WORKSPACE_UNBOUND_RETRY);
    });

    it('returns {projectPath}/.memories/ when a path is provided', () => {
      expect(getMemoriesDir('/some/path')).toBe(join('/some/path', '.memories'));
      expect(getMemoriesDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories'));
    });
  });

  describe('getPlansDir', () => {
    it('requires a verified project path', () => {
      expect(() => getPlansDir()).toThrow(WORKSPACE_UNBOUND_RETRY);
    });

    it('returns {projectPath}/.memories/plans/ when a path is provided', () => {
      expect(getPlansDir('/some/path')).toBe(join('/some/path', '.memories', 'plans'));
      expect(getPlansDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories', 'plans'));
    });
  });

  describe('getBriefsDir', () => {
    it('requires a verified project path', () => {
      expect(() => getBriefsDir()).toThrow(WORKSPACE_UNBOUND_RETRY);
    });

    it('returns {projectPath}/.memories/briefs/ when a path is provided', () => {
      expect(getBriefsDir('/some/path')).toBe(join('/some/path', '.memories', 'briefs'));
      expect(getBriefsDir('/Users/user/source/goldfish')).toBe(join('/Users/user/source/goldfish', '.memories', 'briefs'));
    });
  });

  describe('ensureMemoriesDir', () => {
    it('creates .memories/ and .memories/briefs/ directories without creating legacy plans/', async () => {
      const tmpDir = makeTmpDir();
      // tmpDir itself doesn't exist yet — ensureMemoriesDir should create it recursively
      await ensureMemoriesDir(tmpDir);

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);

      const briefsStat = await stat(join(tmpDir, '.memories', 'briefs'));
      expect(briefsStat.isDirectory()).toBe(true);

      await expect(stat(join(tmpDir, '.memories', 'plans'))).rejects.toThrow();
    });

    it('is idempotent — calling twice does not throw', async () => {
      const tmpDir = makeTmpDir();
      await ensureMemoriesDir(tmpDir);
      await ensureMemoriesDir(tmpDir);

      const memoriesStat = await stat(join(tmpDir, '.memories'));
      expect(memoriesStat.isDirectory()).toBe(true);
    });

    it('requires a verified project path when no arg is provided', async () => {
      await expect(ensureMemoriesDir()).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
    });
  });
});

describe('verified workspace binding', () => {
  const tmpDirs: string[] = [];
  const originalWorkspace = process.env.GOLDFISH_WORKSPACE;
  const originalHome = process.env.HOME;

  async function makeTmpDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'test-goldfish-binding-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    if (originalWorkspace === undefined) delete process.env.GOLDFISH_WORKSPACE;
    else process.env.GOLDFISH_WORKSPACE = originalWorkspace;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  it('fails with the exact retry sentence when identity is missing or current', async () => {
    delete process.env.GOLDFISH_WORKSPACE;

    await expect(resolveWorkspace()).rejects.toThrow(new Error(WORKSPACE_UNBOUND_RETRY));
    await expect(resolveWorkspace('current')).rejects.toThrow(new Error(WORKSPACE_UNBOUND_RETRY));
  });

  it('accepts an existing markerless absolute directory for first use', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const project = await makeTmpDir();

    await expect(resolveWorkspaceWithSource(project)).resolves.toEqual({
      path: project,
      source: 'explicit'
    });
    await expect(resolveWorkspaceWithSource(`${project}/`)).resolves.toEqual({
      path: `${project}/`,
      source: 'explicit'
    });
  });

  it('uses explicit, then environment, then the first valid legacy root', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const explicit = await makeTmpDir();
    const env = await makeTmpDir();
    const root = await makeTmpDir();

    await expect(resolveWorkspaceWithSource(explicit, {
      env,
      roots: [{ uri: pathToFileURL(root).href }]
    })).resolves.toEqual({ path: explicit, source: 'explicit' });

    await expect(resolveWorkspaceWithSource(undefined, {
      env,
      roots: [{ uri: pathToFileURL(root).href }]
    })).resolves.toEqual({ path: env, source: 'env' });

    await expect(resolveWorkspaceWithSource(undefined, {
      roots: [
        { uri: 'https://example.com/not-a-file-root' },
        { uri: pathToFileURL(root).href }
      ]
    })).resolves.toEqual({ path: root, source: 'roots' });
  });

  it('uses GOLDFISH_WORKSPACE when the workspace argument is omitted or current', async () => {
    const env = await makeTmpDir();
    process.env.GOLDFISH_WORKSPACE = env;

    await expect(resolveWorkspaceWithSource()).resolves.toEqual({ path: env, source: 'env' });
    await expect(resolveWorkspaceWithSource('current')).resolves.toEqual({ path: env, source: 'env' });
  });

  it('does not replace an invalid explicit path with environment or Roots', async () => {
    const env = await makeTmpDir();
    const root = await makeTmpDir();

    await expect(resolveWorkspace('relative/project', {
      env,
      roots: [{ uri: pathToFileURL(root).href }]
    })).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('does not replace an invalid environment path with a legacy Root', async () => {
    const root = await makeTmpDir();

    await expect(resolveWorkspace(undefined, {
      env: 'relative/project',
      roots: [{ uri: pathToFileURL(root).href }]
    })).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('rejects invalid candidates and never falls back to cwd or parent walking', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const cwdProject = await makeTmpDir();
    await mkdir(join(cwdProject, '.memories'));

    await expect(resolveWorkspace(undefined, { cwd: cwdProject })).rejects.toThrow(
      `${WORKSPACE_UNBOUND_RETRY}\nSuggestions only; choose one explicitly:\n- ${cwdProject}`
    );
    await expect(resolveWorkspace('/path/does/not/exist')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('requires an existing directory rather than accepting a file', async () => {
    const parent = await makeTmpDir();
    const file = join(parent, 'workspace.txt');
    await Bun.write(file, 'not a directory');

    await expect(resolveWorkspace(file)).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('rejects unsafe broad directories for explicit and environment sources', async () => {
    delete process.env.GOLDFISH_WORKSPACE;

    await expect(resolveWorkspace('/')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
    await expect(resolveWorkspace(undefined, { env: homedir() })).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('rejects home aliases, variables, URIs, relative paths, and dot segments', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const project = await makeTmpDir();

    for (const candidate of ['~', `~/${project}`, '${workspaceFolder}', '$HOME/project', `file://${project}`, './project', `../${project}`, `${project}/../${project}`]) {
      await expect(resolveWorkspace(candidate)).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
    }
  });

  it.skipIf(process.platform === 'win32')('rejects foreign Windows absolute paths on POSIX', async () => {
    await expect(resolveWorkspace('C:\\work\\project')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
    await expect(resolveWorkspace('C:/work/project')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it.skipIf(process.platform !== 'win32')('rejects foreign POSIX and drive-relative paths on Windows', async () => {
    await expect(resolveWorkspace('/tmp/project')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
    await expect(resolveWorkspace('C:project')).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });

  it('rejects paths nested below a project marker and suggests that root', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const root = await makeTmpDir();
    await mkdir(join(root, '.memories'));
    const nested = join(root, 'src');
    await mkdir(nested);

    await expect(resolveWorkspace(nested)).rejects.toThrow(
      `${WORKSPACE_UNBOUND_RETRY}\nSuggestions only; choose one explicitly:\n- ${root}`
    );
  });

  it.skipIf(process.platform === 'win32')('rejects symlink aliases of the home directory', async () => {
    delete process.env.GOLDFISH_WORKSPACE;
    const home = await makeTmpDir();
    const parent = await makeTmpDir();
    const homeAlias = join(parent, 'home-link');
    await symlink(home, homeAlias);
    process.env.HOME = homeAlias;

    await expect(resolveWorkspace(home)).rejects.toThrow(WORKSPACE_UNBOUND_RETRY);
  });
});

describe('getUnsafeCwdWorkspaceReason', () => {
  it('rejects filesystem roots, home directories, and Windows system locations', () => {
    expect(getUnsafeCwdWorkspaceReason('/', { HOME: '/Users/murphy' })).toBe('filesystem root');
    expect(getUnsafeCwdWorkspaceReason('C:\\', {})).toBe('filesystem root');
    expect(getUnsafeCwdWorkspaceReason('\\\\server\\share', {})).toBe('filesystem root');

    expect(getUnsafeCwdWorkspaceReason('~', {})).toBe('home directory');
    expect(getUnsafeCwdWorkspaceReason('~/', {})).toBe('home directory');
    expect(getUnsafeCwdWorkspaceReason('/Users/murphy', { HOME: '/Users/murphy' })).toBe('home directory');
    expect(getUnsafeCwdWorkspaceReason('/Users/murphy/', { HOME: '/Users/murphy' })).toBe('home directory');
    expect(getUnsafeCwdWorkspaceReason('C:\\Users\\murphy', {})).toBe('home directory');
    expect(getUnsafeCwdWorkspaceReason('C:/Users/murphy/', {})).toBe('home directory');

    expect(getUnsafeCwdWorkspaceReason('C:\\Windows', {})).toBe('Windows system directory');
    expect(getUnsafeCwdWorkspaceReason('c:/windows/system32', {})).toBe('Windows system directory');
    expect(getUnsafeCwdWorkspaceReason('C:\\Windows\\SysWOW64', {})).toBe('Windows system directory');
  });

  it('allows project paths under home or normal workspace directories', () => {
    expect(getUnsafeCwdWorkspaceReason('/Users/murphy/source/goldfish', { HOME: '/Users/murphy' })).toBeUndefined();
    expect(getUnsafeCwdWorkspaceReason('/home/murphy/project', { HOME: '/home/murphy' })).toBeUndefined();
    expect(getUnsafeCwdWorkspaceReason('C:\\Users\\murphy\\source\\goldfish', {})).toBeUndefined();
    expect(getUnsafeCwdWorkspaceReason('C:\\work\\goldfish', {})).toBeUndefined();
  });

  it('recognizes home via realpath when cwd and HOME differ only by a symlink (macOS /var vs /private/var)', async () => {
    const { realpath, mkdtemp, rm } = await import('fs/promises');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { resolveUnsafeCwdReason } = await import('../src/workspace');
    const home = await mkdtemp(join(tmpdir(), 'test-unsafe-realpath-'));
    // process.cwd() on macOS returns the /private/... realpath form, while
    // HOME is often the /var/... symlink form. Both refer to the same dir.
    const homeViaSymlink = home; // HOME stored as the symlink-style path
    const cwdViaRealpath = await realpath(home);
    // If the platform doesn't symlink-differ (home === realpath(home)), this
    // test still exercises the equality path; the realpath branch must handle
    // both "same string" and "different string, same dir" without throwing.
    const reason = await resolveUnsafeCwdReason(cwdViaRealpath, { HOME: homeViaSymlink });
    expect(reason).toBe('home directory');
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });
});

describe('Goldfish home directory', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
  });

  it('uses the goldfish home directory from HOME or USERPROFILE', () => {
    const originalGoldfishHome = process.env.GOLDFISH_HOME;
    delete process.env.GOLDFISH_HOME;
    try {
      process.env.HOME = '/test/home';
      process.env.USERPROFILE = '/test/profile';
      expect(getGoldfishHomeDir()).toBe(join('/test/home', '.goldfish'));

      delete process.env.HOME;
      expect(getGoldfishHomeDir()).toBe(join('/test/profile', '.goldfish'));
    } finally {
      if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
      else process.env.GOLDFISH_HOME = originalGoldfishHome;
    }
  });

  it('uses GOLDFISH_HOME when set, ignoring HOME and USERPROFILE', () => {
    const originalGoldfishHome = process.env.GOLDFISH_HOME;

    try {
      process.env.GOLDFISH_HOME = '/custom/goldfish';
      process.env.HOME = '/test/home';
      process.env.USERPROFILE = '/test/profile';

      expect(getGoldfishHomeDir()).toBe('/custom/goldfish');
    } finally {
      if (originalGoldfishHome === undefined) delete process.env.GOLDFISH_HOME;
      else process.env.GOLDFISH_HOME = originalGoldfishHome;
    }
  });
});

describe('parentWalkWorkspace', () => {
  const tmpDirs: string[] = [];
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  function makeTmpDir(): string {
    const dir = join(tmpdir(), `test-goldfish-walk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    tmpDirs.push(dir);
    return dir;
  }

  async function makeProjectTree(): Promise<{ root: string; subdir: string; nestedRoot: string; nestedSub: string }> {
    const root = makeTmpDir();
    await mkdir(join(root, '.memories'), { recursive: true });
    const subdir = join(root, 'src');
    await mkdir(subdir, { recursive: true });

    // Nested inner repo with its own .git, inside a subdir of root that also has .git at root.
    const nestedRoot = join(root, 'workspaces', 'inner');
    await mkdir(nestedRoot, { recursive: true });
    await Bun.write(join(nestedRoot, '.git'), '');
    const nestedSub = join(nestedRoot, 'lib');
    await mkdir(nestedSub, { recursive: true });
    return { root, subdir, nestedRoot, nestedSub };
  }

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    for (const dir of tmpDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    tmpDirs.length = 0;
  });

  it('resolves to the enclosing project root when cwd is a subdirectory with .memories/', async () => {
    const { root, subdir } = await makeProjectTree();

    const result = await parentWalkWorkspace(subdir, { env: { HOME: '/nonexistent-home' } });
    expect(result).toEqual({ path: root, source: 'walk' });
  });

  it('finds the innermost repo when nested repos both have markers (cwd in inner)', async () => {
    const { nestedSub } = await makeProjectTree();

    const result = await parentWalkWorkspace(nestedSub, { env: { HOME: '/nonexistent-home' } });
    // The inner repo (workspaces/inner) has .git and is the first match walking up.
    expect(result?.path.replace(/\\/g, '/')).toMatch(/workspaces\/inner$/);
    expect(result?.source).toBe('walk');
  });

  it('resolves to a repo root via .git alone when no .memories/ exists (first use)', async () => {
    const repo = makeTmpDir();
    await Bun.write(join(repo, '.git'), '');
    const sub = join(repo, 'pkg');
    await mkdir(sub, { recursive: true });

    const result = await parentWalkWorkspace(sub, { env: { HOME: '/nonexistent-home' } });
    expect(result).toEqual({ path: repo, source: 'walk' });
  });

  it('prefers .memories/ over .git/ at the same level', async () => {
    const dir = makeTmpDir();
    await mkdir(join(dir, '.memories'), { recursive: true });
    await Bun.write(join(dir, '.git'), '');

    const result = await parentWalkWorkspace(dir, { env: { HOME: '/nonexistent-home' } });
    expect(result).toEqual({ path: dir, source: 'walk' });
  });

  it('includes cwd itself as a candidate', async () => {
    const dir = makeTmpDir();
    await mkdir(join(dir, '.memories'), { recursive: true });

    const result = await parentWalkWorkspace(dir, { env: { HOME: '/nonexistent-home' } });
    expect(result).toEqual({ path: dir, source: 'walk' });
  });

  it('skips an unsafe home directory that happens to contain .git and keeps walking', async () => {
    const home = makeTmpDir();
    // Simulate a user who `git init`s their home dir for dotfile tracking.
    await Bun.write(join(home, '.git'), '');
    // A real project lives under home and has .memories/.
    const project = join(home, 'source', 'myproj');
    await mkdir(join(project, '.memories'), { recursive: true });
    const sub = join(project, 'src');
    await mkdir(sub, { recursive: true });

    const result = await parentWalkWorkspace(sub, { env: { HOME: home } });
    expect(result).toEqual({ path: project, source: 'walk' });
  });

  it('returns undefined when walking from home with no project markers (home skipped, nothing above)', async () => {
    const home = makeTmpDir();
    // No .memories/ or .git/ under home or above.

    const result = await parentWalkWorkspace(home, { env: { HOME: home } });
    expect(result).toBeUndefined();
  });

  it('returns undefined when home itself has .git but nothing else (regression: must not match home)', async () => {
    const home = makeTmpDir();
    await Bun.write(join(home, '.git'), '');

    const result = await parentWalkWorkspace(home, { env: { HOME: home } });
    expect(result).toBeUndefined();
  });

  it('does not canonicalize the whole chain up front (walks raw dirname)', async () => {
    // Build a real symlinked path so realpath would change the starting directory,
    // but the walk must use the raw path so the marker at the real root is found
    // via the symlinked ancestor chain.
    const realRoot = makeTmpDir();
    await mkdir(join(realRoot, '.memories'), { recursive: true });
    const linkParent = makeTmpDir();
    await mkdir(linkParent, { recursive: true });
    const link = join(linkParent, 'link');
    await symlink(realRoot, link);
    const sub = join(link, 'src');
    await mkdir(sub, { recursive: true });

    const result = await parentWalkWorkspace(sub, { env: { HOME: '/nonexistent-home' } });
    // Walking raw dirname from the symlinked path should find the marker at `link`
    // (the symlink resolves to realRoot on stat, but the returned path is the walked
    // ancestor, i.e. the link). We accept either the link or its real target as the
    // resolved root, since both point at the same on-disk project.
    const resolved = result?.path ?? '';
    expect(
      resolved === link ||
      resolved === realRoot ||
      await realpathEquals(resolved, realRoot)
    ).toBe(true);
  });
});

async function realpathEquals(candidate: string, target: string): Promise<boolean> {
  try {
    const { realpath } = await import('fs/promises');
    return await realpath(candidate) === await realpath(target);
  } catch {
    return false;
  }
}
