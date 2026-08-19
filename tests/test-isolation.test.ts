/**
 * Guard: the test suite must never touch the real ~/.goldfish.
 *
 * tests/preload.ts (wired via bunfig.toml) points GOLDFISH_HOME at a
 * per-run temp directory before any test file loads. Without it, any test
 * that saves a checkpoint registers its temp workspace in the user's real
 * registry (registerProject falls back to ~/.goldfish when GOLDFISH_HOME
 * is unset). This file fails if the preload is removed or stops working.
 */

import { describe, it, expect } from 'bun:test';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { getGoldfishHomeDir } from '../src/workspace';

describe('test isolation', () => {
  it('GOLDFISH_HOME points at a per-run temp dir, not the real ~/.goldfish', () => {
    const home = process.env.GOLDFISH_HOME;
    expect(home).toBeDefined();
    expect(home!.startsWith(tmpdir())).toBe(true);
    expect(home).not.toBe(join(homedir(), '.goldfish'));
  });

  it('getGoldfishHomeDir() resolves to the isolated dir', () => {
    expect(getGoldfishHomeDir()).toBe(process.env.GOLDFISH_HOME!);
  });

  it('GOLDFISH_HARNESS, GOLDFISH_MODEL, and GOLDFISH_SESSION are unset by preload', () => {
    expect(process.env.GOLDFISH_HARNESS).toBeUndefined();
    expect(process.env.GOLDFISH_MODEL).toBeUndefined();
    expect(process.env.GOLDFISH_SESSION).toBeUndefined();
  });
});
