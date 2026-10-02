---
expect:
  workspace: /^(\/|all$)/
---

🐋 Recalled 5 checkpoints
Workspace: (cross-project)

## Workspaces
- **acme-api** (/work/acme-api): 4 checkpoints, last: 2026-10-02T12:32:23.262Z
- **docs-site** (/work/docs-site): 1 checkpoints, last: 2026-10-02T12:32:23.268Z

---

## Checkpoints

### 2026-10-02 12:32 checkpoint_97b005dd
Tags: docs, onboarding
Next: Add screenshots for the deploy step.
Workspace: docs-site
## Rewrote the getting-started guide

New guide covers install, first project, and deploy in one page.

- **Impact:** onboarding docs ticket closed

### 2026-10-02 12:32 checkpoint_dde51f5e
Tags: tests, ci, dashboard
Brief: move-billing-to-stripe
Workspace: acme-api
Upgraded the test runner and fixed flaky snapshot tests

### 2026-10-02 12:32 checkpoint_321ce29d
Tags: billing, migration, paypal, blocked
Brief: move-billing-to-stripe
Type: incident
Next: Filter the migration query to provider = card, rerun the dry run, then compare invoice totals for 20 sampled accounts.
Workspace: acme-api
Migration dry run blocked on PayPal subscribers

### 2026-10-02 12:32 checkpoint_5e18d7d3
Tags: billing, webhooks, idempotency, decision
Brief: move-billing-to-stripe
Type: decision
Workspace: acme-api
Store Stripe event IDs for webhook idempotency

### 2026-10-02 12:32 checkpoint_c7e756e0
Tags: billing, stripe, subscriptions
Brief: move-billing-to-stripe
Workspace: acme-api
Stripe customer sync
