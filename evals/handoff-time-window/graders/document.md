---
type: llm
focus: last_message
---

PASS if the response is one handoff document with sections named `Direction`, `Recent activity`, `Next steps`, and `Open questions`.
FAIL if any of those sections is missing or the response dumps raw tool output.
