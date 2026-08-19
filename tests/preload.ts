/**
 * Suite-wide isolation: point GOLDFISH_HOME at a per-run temp directory
 * before any test file loads, so nothing in the suite can read or write the
 * real ~/.goldfish (registry, logs). Individual tests that need a specific
 * goldfish home still set/restore GOLDFISH_HOME themselves.
 *
 * Also clear the actor identity variables so a developer's shell never leaks
 * harness/model/session values into saved test checkpoints. Tests that need
 * them set/restore the variables themselves.
 *
 * Enforced by tests/test-isolation.test.ts.
 */

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.GOLDFISH_HOME = mkdtempSync(join(tmpdir(), 'goldfish-test-home-'));
delete process.env.GOLDFISH_HARNESS;
delete process.env.GOLDFISH_MODEL;
delete process.env.GOLDFISH_SESSION;
