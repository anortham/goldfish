/**
 * Session-start hook payload for harnesses that inject context (Claude Code, Codex CLI).
 *
 * Composed at runtime from the canonical server instructions so the injected
 * guidance can never drift from what the MCP server itself reports. Two harness
 * limits shape this file: server instructions are capped at 2,000 chars (so the
 * guidance below cannot live there), and MCP tool descriptions are hidden until
 * the model searches for them (so the tools' existence must be advertised here).
 */

import { getInstructions } from './instructions';

/**
 * Parameter-shape reference shared by the hook payload and the generated
 * instruction-tier usage doc (`scripts/build-usage-doc.ts`).
 */
export const TOOL_QUICK_REFERENCE = `## Tool Quick Reference

- \`checkpoint({ description, type?, tags?, symbols?, next?, ... })\` — save a progress checkpoint. Write the description as structured markdown covering WHAT, WHY, HOW, and IMPACT.
- \`recall({ search?, days?, since?, limit?, full?, workspace?, type?, tags?, file?, symbol? })\` — restore prior context when resuming prior work, after context loss or compaction, when the user asks, or when earlier decisions are relevant.
- \`brief({ action: "save" | "get" | "list" | "activate" | "update" | "complete" | "delete", title?, content?, ... })\` — durable strategic direction for the workspace.

Exact tool names vary by client install: a direct MCP registration typically exposes \`checkpoint\`/\`recall\`/\`brief\` under an \`mcp__goldfish__\` prefix, while plugin installs may use a longer namespace. Use whichever goldfish tools your session lists.`;

const TOOL_AVAILABILITY = `## Goldfish Tools Are Available Here

This session has the goldfish MCP tools: \`checkpoint\`, \`recall\`, and \`brief\`. Their descriptions may be deferred — hidden until you load or search for them — so an empty tool list at session start does not mean goldfish is absent. Load or search for the goldfish tools before concluding they are unavailable, and never tell the user memory is unavailable without looking first.`;

const CHECKPOINT_QUALITY = `## Checkpoint Quality

A checkpoint description is structured markdown, not a one-line note. Cover:

- **WHAT** changed — the concrete change, with files or symbols.
- **WHY** — the reason or the decision behind it.
- **HOW** — the approach taken, including alternatives rejected.
- **IMPACT** — what this unblocks, breaks, or changes for the next session.

A future session reads only these words. "Fixed the bug" is a lost checkpoint; the structure above is what makes it worth reading.`;

/**
 * Build the static guidance injected at session start.
 *
 * Raw text — both Claude Code and Codex accept plain stdout as developer
 * context. Kept under Goldfish's 10,000-character safety budget.
 */
export function getHookContext(): string {
  return `# Goldfish Memory

${getInstructions()}

${TOOL_AVAILABILITY}

${TOOL_QUICK_REFERENCE}

${CHECKPOINT_QUALITY}`;
}
