---
type: llm
focus: last_message
weight: 2
---

PASS if the response says replayed events can arrive after a Redis TTL expires, and that the team chose to store processed Stripe event IDs in a table with a unique index.
FAIL if either the reason or the chosen approach is missing or wrong, or the response guesses without citing memory.
