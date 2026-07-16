#!/usr/bin/env bun

/**
 * Builds the instruction-tier usage ruleset from the canonical server
 * instructions. Harnesses that never surface MCP server instructions
 * (Zed, Amp, Jules, Cursor rules, Windsurf, Cline, Kiro, ...) get their
 * Goldfish guidance by copying this generated file into their repo's
 * instruction surface. Written by `bun run sync:agent-skills`; a test
 * fails when the committed copy drifts from the generator.
 */

import { getInstructions } from '../src/instructions';

export function buildUsageDoc(): string {
  return `# Goldfish Memory — Usage Rules for Agents

<!-- Generated from src/instructions.ts by \`bun run sync:agent-skills\`. Do not edit by hand. -->

Copy this file's contents into your repository's agent instruction surface — \`AGENTS.md\`, \`.cursor/rules/\`, \`.windsurf/rules/\`, \`.clinerules/\`, \`.kiro/steering/\` — when your harness does not show MCP server instructions. Harnesses that do show them (Claude Code, and any client honoring \`instructions\`) need nothing from this file.

---

${getInstructions()}

---

## Tool Quick Reference

- \`checkpoint({ description, type?, tags?, symbols?, next?, ... })\` — save a progress checkpoint. Write the description as structured markdown covering WHAT, WHY, HOW, and IMPACT.
- \`recall({ search?, days?, since?, limit?, full?, workspace?, type?, tags?, file?, symbol? })\` — restore prior context. Call at session start and after context loss.
- \`brief({ action: "save" | "get" | "list" | "activate" | "update" | "complete" | "delete", title?, content?, ... })\` — durable strategic direction for the workspace.

Exact tool names vary by client install: a direct MCP registration typically exposes \`checkpoint\`/\`recall\`/\`brief\` under an \`mcp__goldfish__\` prefix, while plugin installs may use a longer namespace. Use whichever goldfish tools your session lists.
`;
}

if (import.meta.main) {
  console.log(buildUsageDoc());
}
