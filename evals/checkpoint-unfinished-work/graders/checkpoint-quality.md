---
type: llm
focus: mock_calls
weight: 2
---

PASS if a checkpoint call records what works (the query and the streaming writer), what is missing (pagination and the permission check), and a `next` field that names a concrete next step about pagination or the permission check.
FAIL if no checkpoint call exists, the done and missing parts are not both recorded, or `next` is absent or vague.
