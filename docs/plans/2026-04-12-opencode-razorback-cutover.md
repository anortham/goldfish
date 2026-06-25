# OpenCode Razorback Cutover Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the global legacy `superpowers` OpenCode install with a working razorback install tuned for Julie.

**Architecture:** Preserve the existing global OpenCode config file and MCP server entries, remove the legacy symlink and checkout-based superpowers install, and load razorback through a thin local wrapper plugin that re-exports the repository's real `.opencode/plugins/razorback.js` entrypoint. Verification checks filesystem state first, then plugin loading through a fresh `opencode` process if the CLI is present.

**Tech Stack:** OpenCode global config, PowerShell filesystem commands, plugin-based skill registration, Julie MCP

**Design doc:** `docs/plans/2026-04-12-opencode-razorback-cutover-design.md`

---

### Task 1: Keep the global OpenCode config clean

**Files:**
- Modify: `C:/Users/CHS300372/.config/opencode/opencode.json`

**Step 1: Preserve the MCP config**

Do not change the existing `mcp.julie` or `mcp.goldfish` entries.

**Step 2: Verify the file shape**

Read `C:/Users/CHS300372/.config/opencode/opencode.json` and confirm it contains the unchanged MCP entries and no stale `plugin` or `skills.paths` wiring from failed attempts.

---

### Task 2: Remove the legacy superpowers install

**Files:**
- Delete: `C:/Users/CHS300372/.config/opencode/plugins/superpowers.js`
- Delete: `C:/Users/CHS300372/.config/opencode/skills/superpowers`
- Delete: `C:/Users/CHS300372/.config/opencode/superpowers/`

**Step 1: Remove the symlink and junction**

Delete the legacy `plugins/superpowers.js` symlink and the `skills/superpowers` junction.

**Step 2: Remove the cloned checkout**

Delete the old `superpowers` checkout directory.

**Step 3: Verify removal**

Confirm none of the three paths still exist.

---

### Task 3: Install and verify the razorback wrapper plugin

**Files:**
- Create: `C:/Users/CHS300372/.config/opencode/plugins/razorback.js`
- Create: `C:/Users/CHS300372/.config/opencode/razorback/`
- Read: `C:/Users/CHS300372/.config/opencode/opencode.json`

**Step 1: Clone razorback locally**

Clone `https://github.com/anortham/razorback.git` to `C:/Users/CHS300372/.config/opencode/razorback/`.

**Step 2: Create the wrapper plugin**

Create `C:/Users/CHS300372/.config/opencode/plugins/razorback.js` with:

```js
export { RazorbackPlugin } from "../razorback/.opencode/plugins/razorback.js";
```

**Step 3: Confirm no stale path-based skill wiring remains**

Search the OpenCode config for any `skills.paths` entry or stale `superpowers` reference that would compete with razorback.

**Step 4: Probe plugin loading with a fresh process**

If `opencode` is installed in `PATH`, run a fresh `opencode` command and inspect logs or output for razorback plugin loading.

**Step 5: Record the result**

If plugin loading succeeds, note that a restart or fresh OpenCode process will pick up razorback. If the CLI is unavailable, record that filesystem and config verification passed and runtime verification could not be performed.
