# Test Coverage

Coverage is verified via `bun test --coverage`. Run that command for current numbers; specific percentages shift release-to-release and belong in CI output, not a static doc.

This file captures the coverage philosophy and testing conventions.

---

## Philosophy

1. **TDD first.** Tests are written before implementation. Every feature begins with a failing test.
2. **Cover behavior, not lines.** A high percentage from happy-path tests is worth less than a lower percentage with real edge-case coverage. Lazy tests are worse than no tests because they give false confidence.
3. **Mock at the boundary.** External dependencies (filesystem, network, third-party APIs) are mocked. Internal logic is exercised directly.
4. **Assert on values, not absence of crashes.** A test that only checks "this didn't throw" is a script, not a test.

---

## Test Layout

| Group | Command | Covers |
|-------|---------|--------|
| Storage & utils | `bun test workspace lock git summary digests file-io logger` | Paths, file ops, utilities |
| Checkpoints | `bun test checkpoints` | Checkpoint CRUD, formatting, parsing |
| Briefs | `bun test briefs` | Brief CRUD, activation |
| Search & ranking | `bun test ranking search` | BM25 search via Orama |
| Recall | `bun test recall` | Aggregation, filtering, date windows |
| Handlers | `bun test handlers` | MCP tool handler responses |
| Server & registry | `bun test server registry` | Server startup, cross-project registry |

These work because bun matches filenames containing the given substring.

---

## Where Coverage Will Always Be Lower

- **`src/server.ts`** -- MCP server entry point. Integration code that's awkward to unit test without the full MCP infrastructure. Handlers (which contain the business logic) are tested independently.
- **Defensive error paths** -- catch blocks for "this should never happen" scenarios are not always exercised. That's acceptable; the recovery itself is uninteresting.

Everything else (checkpoints, briefs, recall, ranking, registry, git context, file locking, handlers) carries strong coverage and any drop should be investigated.

---

## Test Commands

```bash
# Run all tests
bun test

# Run with coverage
bun test --coverage

# Run a specific group
bun test recall

# Watch mode (TDD)
bun test --watch
```
