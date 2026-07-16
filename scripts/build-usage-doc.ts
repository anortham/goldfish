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
import { TOOL_QUICK_REFERENCE } from '../src/hook-context';

export function buildUsageDoc(): string {
  return `# Goldfish Memory — Usage Rules for Agents

<!-- Generated from src/instructions.ts by \`bun run sync:agent-skills\`. Do not edit by hand. -->

Copy this file's contents into your repository's agent instruction surface — \`AGENTS.md\`, \`.cursor/rules/\`, \`.windsurf/rules/\`, \`.clinerules/\`, \`.kiro/steering/\` — when your harness does not show MCP server instructions. Harnesses that do show them (Claude Code, and any client honoring \`instructions\`) need nothing from this file.

---

${getInstructions()}

---

${TOOL_QUICK_REFERENCE}
`;
}

if (import.meta.main) {
  console.log(buildUsageDoc());
}
