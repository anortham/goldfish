# Cross-Client Portability and Workspace Roots

**Date:** 2026-04-16
**Status:** Approved

## Context

Goldfish's core is already broader than its packaging.

The MCP server works outside Claude Code today, but the repo, docs, and install story still frame Goldfish as a Claude Code plugin first and everything else second. That mismatch creates friction in the places where Goldfish should be easiest to adopt:

- Codex Desktop, where users already have MCP, skills, and hooks available
- OpenCode, which can load skills and MCP servers without Claude-specific packaging
- VS Code with GitHub Copilot, which already supports MCP and workspace roots

At the same time, Goldfish's product model has changed. `brief` is now the forward-looking artifact and `checkpoint` is the evidence trail. Pulling harness plan files back into Goldfish standup would drag the system toward the plan-manager role it is trying to leave behind.

There is also a workspace-resolution gap. Goldfish currently resolves workspace as:

1. explicit tool argument
2. `GOLDFISH_WORKSPACE`
3. `process.cwd()`

That worked as a stopgap for GUI clients, but it leaves VS Code users setting an env var that should no longer be needed once Goldfish understands MCP roots.

## Problem

Goldfish has four related problems:

1. **Product identity drift**
   - The repo markets Goldfish as a Claude Code plugin even though the MCP server is cross-client.
   - Non-Claude users get a second-class install story.

2. **Client portability gaps**
   - Skills exist, but the delivery model is Claude-shaped.
   - Docs do not clearly separate cross-client core behavior from Claude-only adapter behavior.

3. **Workspace detection brittleness**
   - GUI MCP clients can launch the server with a bad `cwd`.
   - VS Code should not need `GOLDFISH_WORKSPACE` if it already sends roots.

4. **Standup scope creep**
   - Standup becomes muddy if it tries to read harness plans, draft plans, and repo plans from every client.
   - Goldfish is retiring the `plan` artifact in favor of `brief`; standup should reinforce that split, not blur it.

## Decision

Goldfish will be positioned and implemented as a **cross-client MCP memory system** with thin client adapters.

The decision has four parts:

### 1. Cross-client positioning becomes the default story

Goldfish's product identity is:

- MCP server first
- Claude Code plugin as one client adapter
- client-specific skills, hooks, and instructions layered on top where the client supports them

The Claude Code experience remains first-class, but it is no longer the only canonical frame for the product.

### 2. Goldfish adds MCP roots support for workspace resolution

Workspace resolution changes to:

1. explicit workspace argument
2. `GOLDFISH_WORKSPACE`
3. MCP roots
4. `process.cwd()`

Roots support is request-time, not startup-time.

Goldfish should only query roots when the current workspace was inferred from `cwd` and the client advertises roots support. This avoids treating weak startup `cwd` as authoritative while preserving explicit overrides.

### 3. Client adapters stay thin and non-disruptive

Goldfish keeps Claude-specific assets intact and adds client-native install and instruction surfaces where useful.

- Claude Code keeps `.claude-plugin/`, `skills/`, and existing hooks
- Codex gets native packaging and skill discovery support without changing the MCP core
- OpenCode gets native skill and MCP setup support without reworking the memory model
- VS Code with GitHub Copilot gets a first-class MCP plus instructions path, not a pretend plugin layer

### 4. Standup uses Goldfish memory only

`standup` reports from:

- briefs, which capture direction
- checkpoints, which capture evidence

It does **not** read harness plan-mode files, Claude draft plans, Codex plan state, OpenCode plan state, or repo execution plans as standup inputs.

`docs/plans/` remains useful as a human-readable execution artifact, but it is not a Goldfish memory source for standup.

## Goals

- Make Goldfish easy to use in Claude Code, Codex Desktop, OpenCode, and VS Code with GitHub Copilot
- Remove the need for `GOLDFISH_WORKSPACE` in clients that already provide reliable MCP roots
- Keep the Claude Code plugin stable for existing users
- Preserve Goldfish's product split:
  - brief = direction
  - checkpoint = evidence
  - standup = summary from Goldfish memory
- Reduce packaging and docs confusion across clients

## Non-Goals

- Replacing client-native planning systems
- Reading or indexing harness plan artifacts for standup
- Turning roots into implicit multi-root recall across unrelated workspaces
- Removing Claude Code plugin support
- Building separate memory models per client

## Why This Split

Goldfish is strongest when it owns one job cleanly: durable developer memory.

That job already has a coherent shape:

- checkpoints preserve what happened
- briefs preserve what matters now
- recall restores context
- consolidate distills noisy history into durable memory

Once standup starts scraping plan systems, Goldfish becomes a mixed bag of memory, workflow glue, and harness archaeology. That weakens the brief migration and makes the output less trustworthy.

The cleaner line is:

- planning belongs to the harness and repo docs
- memory belongs to Goldfish

## Product Model

### 1. Core layer

The portable Goldfish core is:

- MCP tools
- behavioral instructions
- markdown storage in `.memories/`
- semantic cache and consolidation support

This layer must behave the same across clients.

### 2. Adapter layer

Client-specific adapters add convenience but do not change the memory model.

Examples:

- plugin manifests
- skills placement and discovery
- lifecycle hooks where available
- client-specific instruction files
- install docs and config snippets

### 3. Memory layer

Goldfish memory artifacts remain:

- `.memories/briefs/*.md`
- `.memories/<date>/*.md`
- `.memories/memory.yaml`

That keeps the source of truth in the repo and keeps cross-client behavior consistent.

## Client Experience Model

### Claude Code

Claude keeps the full adapter experience:

- plugin install
- skills
- `SessionStart`
- `PreCompact`

No existing Claude workflow should break because of this work.

### Codex Desktop

Codex should get:

- native MCP setup docs
- native skill packaging or discovery support
- optional hooks where Codex supports them

As of 2026-04-16, Codex Desktop should still be treated as a client that may require `GOLDFISH_WORKSPACE` when roots are unavailable.

### OpenCode

OpenCode should get:

- native MCP setup docs
- native skill packaging or discovery support
- lifecycle automation only where the platform exposes an equivalent hook surface

Goldfish should not fake Claude semantics where OpenCode differs.

### VS Code with GitHub Copilot

VS Code should be treated as:

- MCP server
- instruction file
- roots-aware workspace binding

It does not need a Claude-style plugin story.

The existing VS Code instructions file should evolve to reflect the brief-first model and cross-client positioning.

## Workspace Resolution Design

### Resolution order

Goldfish resolves the workspace path in this order:

1. explicit workspace argument on the tool call
2. `GOLDFISH_WORKSPACE`
3. first valid client root from `roots/list`
4. `process.cwd()`

### Request-time roots resolution

Goldfish should not query roots during initialization.

Instead:

- inspect client capabilities after initialization
- on the first tool call that needs a workspace, request roots if the current workspace came from weak startup `cwd`
- cache the result for the session
- refresh the cached roots if the client sends `notifications/roots/list_changed`

### Root semantics

Goldfish does not become a multi-root workspace aggregator because roots exist.

Rules:

- use the first valid root as the active workspace for default operations
- keep explicit `workspace: "all"` behavior unchanged
- do not widen recall or checkpoint scope implicitly across every root

This keeps roots as a workspace-binding fix, not a product-model rewrite.

## Standup Scope

### Inputs

`standup` reads:

- cross-project checkpoints
- the active brief for each workspace when available

### Output interpretation

Standup should report:

- what direction each workspace is pursuing, from the brief
- what work has happened, from checkpoints
- what is blocked or stale, when checkpoints and brief drift apart

### Exclusions

Standup should not read:

- `~/.claude/plans`
- Codex internal plan state
- OpenCode internal plan state
- `docs/plans/`
- `docs/superpowers/plans/`

Those can remain useful execution documents, but they are not Goldfish memory artifacts and should not define Goldfish standup.

## Compatibility

### Existing Claude users

This change must not interrupt Claude Code users who already have Goldfish installed as a plugin.

Compatibility requirements:

- `.claude-plugin/` remains supported
- existing skills remain available during the migration
- Claude hooks keep working
- current tool names and compatibility aliases remain stable unless changed by a separate migration

### Existing VS Code users

VS Code users who already set `GOLDFISH_WORKSPACE` should keep working unchanged.

Roots support only removes the need for the env var when the client can supply roots. It does not invalidate the env var path.

## Documentation Changes

The docs should separate:

- portable Goldfish core
- client-specific adapter instructions
- Claude-only conveniences

This means:

- README leads with cross-client identity
- Claude plugin installation remains documented, but as one path among several
- VS Code docs stop presenting `GOLDFISH_WORKSPACE` as mandatory once roots support lands
- client setup sections are grouped by harness

## Rejected Alternatives

### 1. Keep Goldfish positioned as a Claude plugin and add a footnote about MCP portability

Rejected because the server already has a broader role than that, and the current framing hides it.

### 2. Ingest harness plan files into standup

Rejected because it pulls Goldfish back into the plan-manager role it is leaving behind.

It also creates attribution noise, client-specific heuristics, and mixed-trust summaries. Standup should remain grounded in Goldfish memory artifacts.

### 3. Use roots to widen default scope across all open folders

Rejected because roots are a workspace-binding mechanism, not a substitute for Goldfish's explicit cross-project model.

## Consequences

### Positive

- Goldfish becomes easier to adopt outside Claude Code
- VS Code users get a cleaner setup
- the brief migration stays coherent
- standup output stays narrow and trustworthy
- existing Claude users keep their current experience

### Costs

- more adapter docs and packaging metadata to maintain
- roots support adds session-state logic to workspace resolution
- some old README language and examples will need a blunt rewrite

## Open Questions

- What is the cleanest canonical source for shared skill content before generating client-specific wrappers?
- Which OpenCode lifecycle events are close enough to Goldfish's Claude hooks to justify an adapter?
- Should Codex Desktop get project-local setup examples committed under `.codex/` in this repo, or should docs remain snippet-only?
