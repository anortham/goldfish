---
tags: [brief]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Project: /work/acme-api. We agreed on the direction for next quarter: move subscription billing to Stripe Billing. Why: the in-house invoicing module cannot do proration or tax. Constraints: no double charges, keep PayPal for existing PayPal subscribers, ship before 2027-01-15. Done means new subscriptions are created in Stripe, existing subscriptions migrate with no billing gap, and the old invoicing module is deleted. Record this direction so every future session works toward it.
