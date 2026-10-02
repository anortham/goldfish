---
type: llm
focus: last_message
weight: 2
---

PASS if the response is one document with sections named `Direction`, `Recent activity`, `Next steps`, and `Open questions`; the next steps include filtering the migration query to card subscribers and rerunning the dry run; the open questions include annual PayPal plans.
FAIL if any of those sections is missing, the next step is missing, or the response dumps raw tool output.
