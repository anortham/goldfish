/**
 * Workspace recovery for the cwd fallback.
 *
 * When the resolution chain (explicit arg > GOLDFISH_WORKSPACE > MCP roots)
 * falls through to `process.cwd()`, this module tries to recover a better
 * project root before the caller accepts cwd or refuses:
 *
 *   4a. registry-ancestor: cwd or an ancestor is a registered project -> use it
 *   5.  parent walk: nearest enclosing .memories/ or .git/ (skipping unsafe dirs)
 *   4b. single-registered: exactly one registered project AND tool=recall -> use it
 *
 * Lives in its own module to avoid a cycle: registry.ts already imports from
 * workspace.ts, so the orchestrator that calls both must sit outside workspace.ts.
 * The registry reader is injected so tests never touch ~/.goldfish/registry.json.
 */

import { realpath } from 'fs/promises';
import {
  normalizePathKeyForSafetyCheck,
  resolveUnsafeCwdReason,
  parentWalkWorkspace,
  type RecoveredWorkspace
} from './workspace';
import type { RegisteredProject } from './types';

export type { RecoveredWorkspace } from './workspace';

export type RegistryReader = () => Promise<RegisteredProject[]>;

export type RecoveryTool = 'checkpoint' | 'recall' | 'brief';

export interface RecoverOptions {
  cwd: string;
  tool: RecoveryTool;
  registryReader: RegistryReader;
  env?: Record<string, string | undefined>;
}

async function tryRealpath(p: string): Promise<string | undefined> {
  try {
    return await realpath(p);
  } catch {
    return undefined;
  }
}

/**
 * True if `candidate` is an ancestor of (or equal to) `child`, using realpath
 * canonicalization when available and falling back to a normalized string
 * prefix comparison when realpath fails (broken symlink, missing dir, perms).
 */
async function isAncestorOrEqual(child: string, candidate: string): Promise<boolean> {
  const c = await comparablePathKey(child);
  const r = await comparablePathKey(candidate);
  if (c === r) return true;
  return c.startsWith(r + '/');
}

async function comparablePathKey(p: string): Promise<string> {
  return normalizePathKeyForSafetyCheck(await tryRealpath(p) ?? p);
}

/**
 * Find the deepest registered project that is an ancestor of (or equal to) cwd.
 * "Deepest" = longest realpath-or-normalized path, so an inner registered repo
 * wins over an outer one when both contain cwd.
 */
async function findRegisteredAncestor(
  cwd: string,
  projects: RegisteredProject[]
): Promise<RegisteredProject | undefined> {
  let best: RegisteredProject | undefined;
  let bestLen = -1;
  for (const project of projects) {
    if (await isAncestorOrEqual(cwd, project.path)) {
      const len = (await comparablePathKey(project.path)).length;
      if (len > bestLen) {
        best = project;
        bestLen = len;
      }
    }
  }
  return best;
}

async function chooseRecoveryCandidate(
  registry: RecoveredWorkspace | undefined,
  walked: RecoveredWorkspace | undefined
): Promise<RecoveredWorkspace | undefined> {
  if (!registry) return walked;
  if (!walked) return registry;

  const registryKey = await comparablePathKey(registry.path);
  const walkedKey = await comparablePathKey(walked.path);
  if (registryKey === walkedKey) {
    return registry;
  }

  return walkedKey.length > registryKey.length ? walked : registry;
}

/**
 * Attempt to recover a usable workspace root from the registry and/or a parent
 * walk. Returns the recovered root + source, or `undefined` when no recovery
 * applies (in which case the caller should accept cwd if safe, else refuse).
 */
export async function recoverWorkspace(opts: RecoverOptions): Promise<RecoveredWorkspace | undefined> {
  const env = opts.env ?? process.env;
  const projects = await opts.registryReader();
  const mutating = opts.tool !== 'recall';

  // 4a: deepest registered ancestor of cwd. A registered project that is
  // itself an unsafe dir (notably $HOME, which can land in the registry if the
  // user ever ran goldfish from home) must not be used by a mutating tool —
  // that would re-open the silent-home-write class of bug this recovery layer
  // exists to prevent. Drop the unsafe candidate and fall back to the walk,
  // which may still find a safe enclosing project. Recall is read-only, so it
  // may still use a registered home.
  const ancestor = await findRegisteredAncestor(opts.cwd, projects);
  let registry: RecoveredWorkspace | undefined = ancestor
    ? { path: ancestor.path, source: 'registry' as const }
    : undefined;
  if (registry && mutating) {
    const reason = await resolveUnsafeCwdReason(registry.path, env);
    if (reason) {
      registry = undefined;
    }
  }

  // 5: parent walk for .memories/ or .git/ (skips unsafe dirs internally).
  const walked = await parentWalkWorkspace(opts.cwd, { env });
  const recovered = await chooseRecoveryCandidate(registry, walked);
  if (recovered) return recovered;

  // 4b: single-registered recall-only fallback. Only when cwd is itself unsafe
  // (we are about to refuse) and only for read-side tools. A single historical
  // registration is weak evidence for current *write* intent, so mutating tools
  // fall through to refusal-with-list instead.
  const cwdUnsafe = Boolean(await resolveUnsafeCwdReason(opts.cwd, env));
  if (cwdUnsafe && opts.tool === 'recall' && projects.length === 1) {
    return { path: projects[0]!.path, source: 'registry' };
  }

  return undefined;
}

/**
 * Format the "Known projects:" suffix for a refusal message. Returns empty
 * string when there are no registered projects, so the caller can append
 * unconditionally without producing a dangling label.
 */
export function formatKnownProjects(projects: RegisteredProject[]): string {
  if (projects.length === 0) return '';
  const paths = projects.map(p => p.path).join(', ');
  return ` Known projects: ${paths} — pass one as \`workspace:\`.`;
}
