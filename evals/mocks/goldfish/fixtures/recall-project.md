🐟 Recalled 4 checkpoints + active brief
Workspace: /work/acme-api
Memories: /work/acme-api/.memories (found)

---

## Active Brief: Move billing to Stripe (active)
Updated: 2026-10-02T12:32:23.220Z
Tags: billing, stripe

## Goal

Move all subscription billing from the in-house invoicing module to Stripe Billing.

## Why Now

The in-house module cannot handle proration or tax, and support spends ~6 hours a week on billing tickets.

## Constraints

- No double charges during cutover.
- Keep PayPal checkout for existing PayPal subscribers.
- Ship before the 2027-01-15 price change.

## Success Criteria

1. New subscriptions are created in Stripe.
2. Existing subscriptions migrate with no billing gap.
3. Webhooks are idempotent (replayed events do not double-apply).
4. The old invoicing module is deleted.

## References

- docs/plans/2026-09-20-stripe-migration.md

---

## Checkpoints

### 2026-10-02 12:32 checkpoint_dde51f5e
Tags: tests, ci, dashboard
Brief: move-billing-to-stripe
Actor: harness=claude-code user=dev
## Upgraded the test runner and fixed flaky snapshot tests

Unrelated to billing: bumped vitest and rewrote 9 flaky snapshot tests in the admin dashboard.

- **Impact:** CI is green again on main

### 2026-10-02 12:32 checkpoint_321ce29d
Tags: billing, migration, paypal, blocked
Brief: move-billing-to-stripe
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

### 2026-10-02 12:32 checkpoint_5e18d7d3
Tags: billing, webhooks, idempotency, decision
Brief: move-billing-to-stripe
Type: decision
Decision: Persist processed Stripe event IDs in a unique-indexed table.
Alternatives: Redis SET with TTL: replays can arrive after expiry
Actor: harness=claude-code user=dev
## Store Stripe event IDs for webhook idempotency

Replayed `invoice.paid` events double-credited accounts in staging.

- **Decision:** persist processed event IDs in a `stripe_events` table with a unique index
- **Rejected:** Redis SET with TTL, because replays can arrive after the TTL
- **Impact:** webhook handler is safe to retry

### 2026-10-02 12:32 checkpoint_c7e756e0
Tags: billing, stripe, subscriptions
Brief: move-billing-to-stripe
Symbols: StripeBillingService.createSubscription
Actor: harness=claude-code user=dev
## Stripe customer sync

New signups now create a Stripe customer and subscription.

- **Added:** `StripeBillingService.createSubscription`
- **Tests:** 18 billing tests pass
- **Impact:** success criterion 1 is done for new signups
