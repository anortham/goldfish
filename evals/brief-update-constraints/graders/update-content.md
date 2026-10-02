---
type: llm
focus: mock_calls
weight: 2
---

PASS if a brief update call carries new content that includes the 2027-03-01 deadline and the SEPA direct debit constraint, and still keeps the earlier constraints (no double charges, keep PayPal).
FAIL if no update call exists, the new deadline or SEPA constraint is missing, or the update drops the earlier constraints.
