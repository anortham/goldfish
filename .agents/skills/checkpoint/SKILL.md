---
name: checkpoint
description: Save developer context to Goldfish memory — checkpoint at meaningful milestones, not after every action
allowed-tools: mcp__goldfish__checkpoint
---

# Checkpoint — Save Developer Memory

## When to Checkpoint

**When in doubt, checkpoint** — a few extra checkpoints are better than lost context.

- **Completed a deliverable** — feature slice, bug fix, refactor step
- **Made a key decision** — architecture, tradeoffs, approach choices that future sessions must follow
- **Committed or pushed work** — natural checkpoint moment after code lands
- **Reaching a stopping point** — end of a work session or switching tasks
- **Before context compaction** — preserve active state (PreCompact hook handles this automatically)
- **Found something non-obvious** — blockers, root causes, discoveries worth preserving
- **User shared requirements/constraints** — preserve what future work must honor

Space out checkpoints so each one captures a distinct piece of progress — one per logical milestone is the right cadence.

## How to Write Good Descriptions

Your description becomes the **markdown body** of a `.md` file. Format it with structure — headers, bullet points, bold, code spans.

### The WHAT/WHY/HOW/IMPACT Formula

```
mcp__goldfish__checkpoint({
  description: "## Implemented JWT refresh token rotation\n\nThe existing single-token approach was vulnerable to token theft.\n\n- **Approach:** Rotate tokens on each use, limiting the attack window\n- **Added:** `RefreshTokenStore` with atomic file writes and 7-day expiry\n- **Tests:** All 12 auth tests passing\n- **Impact:** Unblocks the session management PR",
  tags: ["feature", "auth", "security", "jwt", "refresh-token", "token-rotation", "session-management"]
})
```

### Good vs Bad

**GOOD (structured markdown):**
```
## Fixed race condition in checkpoint writes

Concurrent saves could corrupt the daily markdown file.

- **Root cause:** Non-atomic write pattern
- **Fix:** Switched to write-tmp-then-rename with file locking
- **Verified:** Reproduced with parallel test, confirmed fix
```

**BAD (no structure):** "Fixed race condition in checkpoint file writes where concurrent saves could corrupt the daily markdown file. Root cause was non-atomic write pattern."

**BAD (no context):** "Fixed file writing bug"

## Structured Fields

Use `type` to classify your checkpoint for better searchability:

- `type: "decision"` → include `decision` + `alternatives`
- `type: "incident"` → include `context` + `evidence`
- `type: "learning"` → include `impact`

All types benefit from `symbols`, `next`, and `impact`.

## Tags — Think About Future Search

Tags power fuzzy search recall. Write them for **discoverability** — how would future-you search for this?

**Category tags** (1-2):
- **Type:** `feature`, `bug-fix`, `refactor`, `docs`, `test`
- **Area:** `auth`, `api`, `ui`, `database`, `build`
- **Status:** `wip`, `blocked`, `discovery`, `decision`

**Concept tags** (2-5) — the important part:
- Include **synonyms and related terms** for the core topic
- Include **the problem domain**, not just the solution
- Think: "what words might I use when searching for this later?"

Example: a checkpoint about implementing retry logic for payment webhooks:
- BAD tags: `["bug-fix", "payments"]`
- GOOD tags: `["bug-fix", "payments", "retry", "resilience", "webhooks", "fault-tolerance", "idempotency"]`

Example: a decision to use WebSockets over SSE for real-time updates:
- BAD tags: `["decision", "api"]`
- GOOD tags: `["decision", "real-time", "websockets", "sse", "push", "streaming", "notifications"]`

## What Gets Captured Automatically

You don't need to include these — Goldfish captures them:
- **Git branch** — current branch name
- **Git commit** — current HEAD short hash
- **Changed files** — files modified since last commit (`.memories/` excluded)
- **Timestamp** — UTC, always

Focus your description on the MEANING, not the mechanics.
