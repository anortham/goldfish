# OpenCode Razorback Cutover

**Date:** 2026-04-12
**Status:** Approved

## Problem

The global OpenCode install is using a legacy `superpowers` symlink-based setup:

- `C:/Users/CHS300372/.config/opencode/plugins/superpowers.js` is a symlink
- `C:/Users/CHS300372/.config/opencode/skills/superpowers` is a junction
- `C:/Users/CHS300372/.config/opencode/superpowers/` is the cloned source checkout

That layout conflicts with the requested replacement. Razorback's upstream install is plugin-based and auto-registers its own skills, so the old symlink wiring needs to go.

## Design

Target the plugin-based razorback setup first, keeping the existing `julie` and `goldfish` MCP configuration unchanged.

Remove the legacy `superpowers` install points:

- `C:/Users/CHS300372/.config/opencode/plugins/superpowers.js`
- `C:/Users/CHS300372/.config/opencode/skills/superpowers`
- `C:/Users/CHS300372/.config/opencode/superpowers/`

If the upstream git-plugin install path fails at runtime, fall back to a local wrapper plugin:

- clone razorback to `C:/Users/CHS300372/.config/opencode/razorback/`
- add `C:/Users/CHS300372/.config/opencode/plugins/razorback.js`
- have that wrapper re-export `../razorback/.opencode/plugins/razorback.js`

This keeps razorback's own plugin code and skill registration intact while avoiding the broken git-package module resolution path.

## Verification

- Confirm `opencode.json` preserves the MCP entries and contains no stale `skills.paths` override
- Confirm the legacy `superpowers` symlink, junction, and checkout no longer exist
- If the `opencode` CLI is available, start a new process and check that razorback loads from the local plugin wrapper and exposes its skills

## Observed Runtime Issue

OpenCode 1.4.3 read the upstream `plugin` config entry and attempted to install razorback from git, but then failed with:

```text
Cannot find module '...node_modules\\razorback'
```

The razorback repository does contain the real plugin file at `.opencode/plugins/razorback.js`, so the failure is in the git-package plugin load path rather than Julie or the skills themselves.

## Non-Goals

- Preserving a rollback copy of `superpowers`
- Installing razorback per-project instead of globally
- Changing Julie or Goldfish MCP registration
