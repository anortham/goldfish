# Recall Input Hardening

**Date:** 2026-04-14
**Status:** Approved

## Problem

`recall` currently trusts callers to omit unused parameters cleanly. That works for careful humans and falls apart for tool-calling agents that send placeholder values such as `0` and `""`.

Two failures fell out of that:

- `days: 0` is treated as an explicit date filter, which creates a zero-width date window and returns no checkpoints.
- Empty strings for `since`, `from`, or `to` are treated as present because the code checks `!== undefined`, which can push recall into date mode and even produce `Invalid Date` errors.

This is a caller footgun. Goldfish should harden the API against these common placeholder inputs.

## Design

Normalize recall options at the start of `recall()` before any date-mode or limit logic runs.

The normalization rules are:

- Trim string fields used by recall option parsing.
- Treat blank strings as omitted for `workspace`, `since`, `from`, `to`, `search`, and `planId`.
- Treat non-finite `days` values and `days <= 0` as omitted.
- Leave `limit` behavior unchanged. `limit: 0` remains a documented plan-only mode.
- Preserve existing precedence rules after normalization, especially `since` taking priority over `days` when both are meaningful.

This keeps the public API forgiving without changing the intended semantics for valid input.

## Implementation

### 1. Add a recall option normalizer in `src/recall.ts`

Introduce a small internal helper that returns a sanitized `RecallOptions` object.

Responsibilities:

- Copy through existing fields
- Trim string values
- Replace empty trimmed strings with `undefined`
- Drop invalid `days` values (`NaN`, `Infinity`, negatives, zero)

The helper should run once near the entry to `recall()` so both direct TypeScript callers and MCP handler callers get the same behavior.

### 2. Keep handler behavior thin

`src/handlers/recall.ts` should keep passing arguments through. The hardening belongs in the core recall path, not only at the MCP boundary.

That avoids duplicated logic and protects internal callers such as tests and scripts.

### 3. Update tests first

Add regression coverage in `tests/recall.test.ts` for:

- `days: 0` falling back to normal latest-checkpoint behavior instead of returning an empty list
- empty `since`, `from`, and `to` not triggering date mode or crashing
- `since` still overriding `days` after normalization

The tests should assert on returned checkpoints, not only that the call does not throw.

## Files

- `src/recall.ts`
- `tests/recall.test.ts`

## Non-Goals

- Changing `limit: 0` semantics
- Adding schema-level validation errors for sloppy recall inputs
- Normalizing unrelated tools in this change

## Acceptance Criteria

- `recall({ days: 0 })` behaves like omitted `days`, not a zero-width date window
- `recall({ since: "", from: "", to: "" })` does not throw and behaves like those fields were omitted
- `limit: 0` still returns plan-only output with no checkpoints
- Existing meaningful date filters still work
- Regression tests cover the footguns that triggered this work
