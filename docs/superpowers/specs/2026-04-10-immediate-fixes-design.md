# Goldfish Immediate Fixes Design

This spec captures the short stabilization pass requested after the project review. The goal is to record the work in `TODO.md`, then fix the highest-value trust and correctness issues before adding anything new.

## Goals

- Add the review results to `TODO.md` in the repo's current lean backlog style
- Fix documentation and manifest drift that makes the project look inconsistent
- Align plan-save behavior with the contract agents are told to follow
- Harden shared file writes for registry, memory, and consolidation state
- Reject malformed current-format checkpoint and recall inputs instead of accepting bad data silently
- Add regression coverage for the changed behavior

## Non-Goals

- No new product features
- No database or storage model changes
- No semantic recall redesign
- No broad refactors outside the touched bug surface

## 1. TODO Backlog Update

### Problem

The review produced a concrete "Do Now" list, but `TODO.md` currently only contains older backlog buckets. The file was recently cleaned to a live backlog, so the new items should be added as current work rather than as a long review summary.

### Design

Add a new top section:

```md
## Immediate Fixes
```

Under it, add seven unchecked items matching this pass:

1. Fix version and skill inventory drift across docs and manifests
2. Align plan save behavior with activation guidance
3. Make registry writes atomic
4. Add locking around memory and consolidation state writes
5. Tighten malformed checkpoint parsing
6. Validate `from` and `to` inputs strictly
7. Add regression coverage for the above, including unborn-`HEAD` git state

Each item stays short and action-oriented. No review transcript, severity labels, or archived commentary goes into `TODO.md`.

## 2. Docs and Manifest Drift

### Problem

The repo advertises conflicting versions and an incomplete skill list:

- `README.md` says `6.5.0`
- `package.json`, `.claude-plugin/plugin.json`, and `src/server.ts` say `6.5.1`
- `.claude-plugin/marketplace.json` says `5.3.0`
- `README.md` documents five skills while `skills/` contains six, including `consolidate`

This is a trust problem, not cosmetic cleanup.

### Design

Normalize version references to `6.5.1` everywhere they are intended to describe the current release. Update the README skill lists and plugin structure examples to include `consolidate` and to describe six skills, not five.

### Tests

- Extend or update version-sync coverage if needed
- Keep docs changes narrow; no behavior changes required

## 3. Plan Save / Activation Contract

### Problem

Goldfish tells agents that saving a plan should activate it so recall shows it automatically, but implementation defaults `activate` to `false`. That mismatch lives in tool descriptions and runtime behavior.

### Design

Choose one contract and make the code and docs match. The recommended contract is:

- `plan({ action: "save" ... })` activates by default
- explicit `activate: false` remains supported when a caller needs it

That keeps the tool aligned with server instructions, hooks, and recall expectations.

### Affected Areas

- `src/tools.ts`
- `src/instructions.ts`
- `src/handlers/plan.ts`
- `src/plans.ts`
- plan handler and plan storage tests

### Tests

- Save without `activate` should produce an active plan
- Save with `activate: false` should keep the plan inactive
- Existing explicit activation behavior should still work

## 4. Shared File Write Hardening

### Problem

Some shared state is protected unevenly:

- `src/registry.ts` uses locking but writes `registry.json` directly
- `src/memory.ts` uses atomic writes but does not lock `memory.yaml` or consolidation state writes

That leaves crash windows and overlapping-writer risk on files agents treat as durable shared truth.

### Design

Use the same write discipline across these paths:

- lock the target file
- read/update inside the lock when needed
- write temp file then rename

Apply this to:

- `~/.goldfish/registry.json`
- `{project}/.memories/memory.yaml`
- `~/.goldfish/consolidation-state/{workspace}.json`

Keep the current storage layout and formats unchanged.

### Tests

- Registry tests should still pass with atomic writes
- Add targeted tests for write helpers if existing coverage does not prove lock + write behavior
- No need for broad concurrency stress tests in this pass if focused regression tests cover the lock contract

## 5. Stricter Checkpoint Parsing

### Problem

Current checkpoint parsing accepts malformed current-format markdown too quietly:

- missing `timestamp` falls back to `new Date().toISOString()`
- missing `id` can become the string `"undefined"`

That makes broken files look valid and can pollute recall, consolidation, and semantic indexing.

### Design

Split legacy migration tolerance from current-format validation:

- keep support for valid legacy timestamp formats like Unix seconds/milliseconds
- reject missing or empty `id`
- reject missing or empty `timestamp`
- reject invalid timestamp strings for current-format markdown

If a current checkpoint file is malformed, parsing should throw instead of inventing metadata.

### Tests

- Missing `id` throws
- Missing `timestamp` throws
- Empty `timestamp` throws
- Invalid timestamp string throws
- Existing legacy timestamp compatibility still passes

## 6. Strict `from` / `to` Validation

### Problem

`since` parsing is strict, but `from` and `to` currently pass through to `new Date(...)` in later code paths. Invalid values can produce vague or silent results.

### Design

Validate `from` and `to` at the recall option layer before scanning checkpoints. The accepted formats stay the same:

- ISO 8601 timestamps
- `YYYY-MM-DD`

Invalid values should throw a clear error, matching the tone already used for invalid `since`.

### Tests

- invalid `from` throws
- invalid `to` throws
- valid date-only and ISO values still work

## 7. Unborn-`HEAD` Git Coverage

### Problem

`src/git.ts` calls `git diff --name-only HEAD`. In a freshly initialized repo without a first commit, `HEAD` does not exist. Current tests cover normal repos but not this edge case.

### Design

Add regression coverage for a repo after `git init` and before the first commit. Expected behavior:

- no crash
- empty or partial git context is acceptable
- untracked files should still be handled sanely if the command mix allows it

Only change implementation if the test proves current behavior is wrong.

## Execution Order

Implement in this order:

1. `TODO.md` update plus docs/manifest drift fix
2. plan activation contract
3. registry atomic writes
4. memory/consolidation locking
5. checkpoint parsing hardening
6. `from` / `to` validation
7. unborn-`HEAD` regression coverage and any required code fix

Each behavior change follows TDD:

1. write failing test
2. run targeted test and confirm failure
3. write minimal implementation
4. run targeted test and confirm pass
5. move to the next item
6. run the full suite at the end

## Risks and Tradeoffs

- Making plan save activate by default changes behavior for callers that relied on inactive saves. Supporting explicit `activate: false` keeps that escape hatch.
- Stricter checkpoint parsing may surface malformed local files that were previously ignored. That is the point; silent acceptance is worse.
- Adding locks to memory writes can expose latent test assumptions about write ordering. Tests should be adjusted to match the stronger contract, not the old race-prone behavior.

## Success Criteria

- `TODO.md` has an `Immediate Fixes` section with the seven items
- docs, manifests, and README skill inventory agree on the current release and available skills
- saving a plan without an explicit `activate` flag produces an active plan
- registry, memory, and consolidation state writes use the hardened write discipline
- malformed current-format checkpoints are rejected
- invalid `from` / `to` inputs fail loudly
- regression coverage exists for unborn-`HEAD`
- full test suite passes after the changes
