/**
 * Memory module: file I/O for MEMORY.md and .last-consolidated
 */

import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import type { ConsolidationState, MemorySection } from './types';

const MEMORIES_DIR = '.memories';
const MEMORY_FILE = 'MEMORY.md';
const CONSOLIDATION_STATE_FILE = '.last-consolidated';

function memoriesDir(workspace: string): string {
  return join(workspace, MEMORIES_DIR);
}

/**
 * Read .memories/MEMORY.md from the given workspace.
 * Returns null if the file does not exist.
 */
export async function readMemory(workspace: string): Promise<string | null> {
  const filePath = join(memoriesDir(workspace), MEMORY_FILE);
  try {
    return await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/**
 * Write content to .memories/MEMORY.md, creating the directory if needed.
 * Uses atomic write-then-rename to prevent corruption.
 */
export async function writeMemory(workspace: string, content: string): Promise<void> {
  const dir = memoriesDir(workspace);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, MEMORY_FILE);
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

/**
 * Read .memories/.last-consolidated as parsed JSON.
 * Returns null on ENOENT or any parse error.
 */
export async function readConsolidationState(workspace: string): Promise<ConsolidationState | null> {
  const filePath = join(memoriesDir(workspace), CONSOLIDATION_STATE_FILE);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
  try {
    return JSON.parse(raw) as ConsolidationState;
  } catch {
    // Malformed JSON, treat as absent
    return null;
  }
}

/**
 * Write consolidation state as JSON to .memories/.last-consolidated.
 * Uses atomic write-then-rename to prevent corruption.
 */
export async function writeConsolidationState(workspace: string, state: ConsolidationState): Promise<void> {
  const dir = memoriesDir(workspace);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, CONSOLIDATION_STATE_FILE);
  const tempPath = `${filePath}.tmp.${Date.now()}`;
  const content = JSON.stringify(state, null, 2);
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

/**
 * Parse MEMORY.md content into sections by ## headers.
 * Content before the first ## header is ignored.
 */
export function parseMemorySections(content: string): MemorySection[] {
  if (!content) return [];

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
  // Use a regex split that preserves the delimiter via capture group
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
 * Return a summary of MEMORY.md content: content up to the second ## header,
 * or up to 300 chars (whichever comes first). Truncates with "..." if over 300.
 * Returns null for null or empty input.
 */
export function getMemorySummary(content: string | null): string | null {
  if (!content) return null;

  // Find position of second ## header
  const firstHeaderIdx = content.indexOf('## ');
  let cutoff = content.length;

  if (firstHeaderIdx !== -1) {
    const secondHeaderIdx = content.indexOf('\n## ', firstHeaderIdx + 1);
    if (secondHeaderIdx !== -1) {
      // Include up to (but not including) the second header line; keep the preceding newline
      cutoff = secondHeaderIdx + 1; // include the \n before the second ##
    }
  }

  let summary = content.slice(0, cutoff);

  if (summary.length > 300) {
    summary = summary.slice(0, 300) + '...';
  }

  return summary.trim();
}

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}
