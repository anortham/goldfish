# Move billing to Stripe
ID: move-billing-to-stripe
Status: active
Created: 2026-10-02T12:32:23.220Z
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
