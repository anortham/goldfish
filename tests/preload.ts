/**
 * Suite-wide isolation: point GOLDFISH_HOME at a per-run temp directory
 * before any test file loads, so nothing in the suite can read or write the
 * real ~/.goldfish (registry, logs). Individual tests that need a specific
 * goldfish home still set/restore GOLDFISH_HOME themselves.
 *
 * Enforced by tests/test-isolation.test.ts.
 */

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.GOLDFISH_HOME = mkdtempSync(join(tmpdir(), 'goldfish-test-home-'));
