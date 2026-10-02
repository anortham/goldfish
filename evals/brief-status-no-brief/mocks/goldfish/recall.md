---
expect:
  workspace: /^(\/|all$)/
---

🐋 Recalled 4 checkpoints
Workspace: /work/acme-api
Memories: /work/acme-api/.memories (found)

---

## Checkpoints

### 2026-10-02 12:32 checkpoint_35320a74
Tags: tests, ci, dashboard
Actor: harness=claude-code user=dev
## Upgraded the test runner and fixed flaky snapshot tests

Unrelated to billing: bumped vitest and rewrote 9 flaky snapshot tests in the admin dashboard.

- **Impact:** CI is green again on main

### 2026-10-02 12:32 checkpoint_91e33a01
Tags: billing, migration, paypal, blocked
Type: incident
Context: Dry run of the existing-subscription migration.
Evidence: dry-run log: 412 paypal rows selected
Next: Filter the migration query to provider = card, rerun the dry run, then compare invoice totals for 20 sampled accounts.
Unknowns: Do annual PayPal plans need a manual migration path later?
Actor: harness=claude-code user=dev
## Migration dry run blocked on PayPal subscribers

The migration script tried to move 412 PayPal subscribers to Stripe, which breaks the "keep PayPal" constraint.

- **Evidence:** dry-run log shows 412 rows with `provider = paypal` selected
- **Status:** blocked until the script filters by provider

### 2026-10-02 12:32 checkpoint_d9c1ec0c
Tags: billing, webhooks, idempotency, decision
Type: decision
Decision: Persist processed Stripe event IDs in a unique-indexed table.
Alternatives: Redis SET with TTL: replays can arrive after expiry
Actor: harness=claude-code user=dev
## Store Stripe event IDs for webhook idempotency

Replayed `invoice.paid` events double-credited accounts in staging.

- **Decision:** persist processed event IDs in a `stripe_events` table with a unique index
- **Rejected:** Redis SET with TTL, because replays can arrive after the TTL
- **Impact:** webhook handler is safe to retry

### 2026-10-02 12:32 checkpoint_8d33959d
Tags: billing, stripe, subscriptions
Symbols: StripeBillingService.createSubscription
Actor: harness=claude-code user=dev
## Stripe customer sync

New signups now create a Stripe customer and subscription.

- **Added:** `StripeBillingService.createSubscription`
- **Tests:** 18 billing tests pass
- **Impact:** success criterion 1 is done for new signups
