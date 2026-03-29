/**
 * Memory module: file I/O for memory.yaml (and legacy MEMORY.md fallback)
 * and consolidation state at ~/.goldfish/consolidation-state/{workspace}.json
 * (with legacy .memories/.last-consolidated fallback).
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import YAML from 'yaml';
import type { ConsolidationState, MemoryData, MemorySection } from './types';
import { getConsolidationStatePath, getConsolidationStateDir, normalizeWorkspace } from './workspace';

const MEMORIES_DIR = '.memories';
const MEMORY_YAML = 'memory.yaml';
const MEMORY_MD_LEGACY = 'MEMORY.md';
const CONSOLIDATION_STATE_FILE_LEGACY = '.last-consolidated';

const SECTION_DISPLAY_NAMES: Record<keyof MemoryData, string> = {
  decisions: 'Decisions',
  open_questions: 'Open Questions',
  deferred_work: 'Deferred Work',
  gotchas: 'Gotchas',
};

// Ordered list of keys for consistent section ordering
const SECTION_KEYS: Array<keyof MemoryData> = [
  'decisions',
  'open_questions',
  'deferred_work',
  'gotchas',
];

function memoriesDir(workspace: string): string {
  return join(workspace, MEMORIES_DIR);
}

/**
 * Detect if a content string is YAML memory format.
 * YAML memory starts with one of the four known keys.
 */
function isYamlMemory(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith('decisions:') ||
    trimmed.startsWith('open_questions:') ||
    trimmed.startsWith('deferred_work:') ||
    trimmed.startsWith('gotchas:')
  );
}

/**
 * Read memory from the workspace.
 * Tries memory.yaml first; falls back to MEMORY.md for migration.
 * Returns null if neither file exists.
 */
export async function readMemory(workspace: string): Promise<string | null> {
  const dir = memoriesDir(workspace);

  // Try memory.yaml first
  const yamlPath = join(dir, MEMORY_YAML);
  try {
    return await readFile(yamlPath, 'utf-8');
  } catch (err: unknown) {
    if (!isEnoent(err)) throw err;
  }

  // Fall back to MEMORY.md (legacy migration path)
  const mdPath = join(dir, MEMORY_MD_LEGACY);
  try {
    return await readFile(mdPath, 'utf-8');
  } catch (err: unknown) {
    if (!isEnoent(err)) throw err;
  }

  return null;
}

/**
 * Write memory content to .memories/memory.yaml.
 * Creates the directory if needed. Uses atomic write-then-rename.
 */
export async function writeMemory(workspace: string, content: string): Promise<void> {
  const dir = memoriesDir(workspace);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, MEMORY_YAML);
  await atomicWrite(filePath, content);
}

/**
 * Read consolidation state.
 * Tries ~/.goldfish/consolidation-state/{workspace}.json first;
 * falls back to .memories/.last-consolidated for migration.
 * Returns null on ENOENT or JSON parse error.
 */
export async function readConsolidationState(workspace: string): Promise<ConsolidationState | null> {
  // Try new path first
  const newPath = getConsolidationStatePath(workspace);
  try {
    const raw = await readFile(newPath, 'utf-8');
    try {
      return JSON.parse(raw) as ConsolidationState;
    } catch {
      return null; // malformed JSON
    }
  } catch (err: unknown) {
    if (!isEnoent(err)) throw err;
  }

  // Fall back to legacy .memories/.last-consolidated
  const legacyPath = join(memoriesDir(workspace), CONSOLIDATION_STATE_FILE_LEGACY);
  try {
    const raw = await readFile(legacyPath, 'utf-8');
    try {
      return JSON.parse(raw) as ConsolidationState;
    } catch {
      return null; // malformed JSON
    }
  } catch (err: unknown) {
    if (!isEnoent(err)) throw err;
  }

  return null;
}

/**
 * Write consolidation state to ~/.goldfish/consolidation-state/{workspace}.json.
 * Creates the directory if needed. Uses atomic write-then-rename.
 */
export async function writeConsolidationState(workspace: string, state: ConsolidationState): Promise<void> {
  await mkdir(getConsolidationStateDir(), { recursive: true });
  const filePath = getConsolidationStatePath(workspace);
  const content = JSON.stringify(state, null, 2);
  await atomicWrite(filePath, content);
}

/**
 * Parse YAML memory content into a MemoryData structure.
 * Returns an empty object for null, empty, invalid YAML, or non-YAML content.
 */
export function parseMemoryYaml(content: string | null): MemoryData {
  if (!content) return {};
  if (!isYamlMemory(content)) return {};

  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== 'object') return {};

    const result: MemoryData = {};

    for (const key of SECTION_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        result[key] = value.map(item => String(item));
      }
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * Parse memory content into MemorySection[] for search.
 * Handles both YAML (new) and markdown (legacy) formats.
 * Signature is stable: recall.ts and other callers depend on it.
 */
export function parseMemorySections(content: string): MemorySection[] {
  if (!content) return [];

  if (isYamlMemory(content)) {
    return parseYamlSections(content);
  }

  return parseMarkdownSections(content);
}

function parseYamlSections(content: string): MemorySection[] {
  const data = parseMemoryYaml(content);
  const sections: MemorySection[] = [];

  for (const key of SECTION_KEYS) {
    const entries = data[key];
    if (!entries || entries.length === 0) continue;

    sections.push({
      slug: key,
      header: SECTION_DISPLAY_NAMES[key],
      content: entries.map(e => `- ${e}`).join('\n'),
    });
  }

  return sections;
}

function parseMarkdownSections(content: string): MemorySection[] {
  // Find the first ## header; discard everything before it
  const firstHeaderIdx = content.indexOf('\n## ');
  const startsAtBeginning = content.startsWith('## ');

  let workingContent: string;
  if (startsAtBeginning) {
    workingContent = content;
  } else if (firstHeaderIdx !== -1) {
    workingContent = content.slice(firstHeaderIdx + 1); // skip the leading \n
  } else {
    return [];
  }

  // Split on newline + ## to get chunks. Each chunk starts with "## <header>\n<body>"
  const parts = workingContent.split(/(?=^## )/m);

  const sections: MemorySection[] = [];
  for (const part of parts) {
    if (!part.startsWith('## ')) continue;
    const newlineIdx = part.indexOf('\n');
    const header = newlineIdx === -1 ? part.slice(3).trim() : part.slice(3, newlineIdx).trim();
    const body = newlineIdx === -1 ? '' : part.slice(newlineIdx);
    sections.push({
      slug: headerToSlug(header),
      header,
      content: body,
    });
  }

  return sections;
}

function headerToSlug(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Return a summary of memory content (at most 300 chars, truncated with "...").
 * For markdown: returns up to the second ## header.
 * For YAML: returns the raw YAML string up to 300 chars.
 * Returns null for null or empty input.
 */
export function getMemorySummary(content: string | null): string | null {
  if (!content) return null;

  if (isYamlMemory(content)) {
    const summary = content.trim();
    if (summary.length > 300) {
      return summary.slice(0, 300) + '...';
    }
    return summary || null;
  }

  // Legacy markdown path
  const firstHeaderIdx = content.indexOf('## ');
  let cutoff = content.length;

  if (firstHeaderIdx !== -1) {
    const secondHeaderIdx = content.indexOf('\n## ', firstHeaderIdx + 1);
    if (secondHeaderIdx !== -1) {
      cutoff = secondHeaderIdx + 1; // include the \n before the second ##
    }
  }

  let summary = content.slice(0, cutoff);

  if (summary.length > 300) {
    summary = summary.slice(0, 300) + '...';
  }

  return summary.trim();
}

/**
 * Atomic write: write to a temp file then rename into place.
 * Prevents corruption on crashes.
 */
async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  await writeFile(tempPath, content, 'utf-8');
  try {
    await rename(tempPath, filePath);
  } catch (error: any) {
    if (error.code === 'ENOENT' && process.platform === 'win32') {
      await writeFile(filePath, content, 'utf-8');
      try { await unlink(tempPath); } catch {}
    } else {
      throw error;
    }
  }
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
