---
type: llm
focus: last_message
weight: 2
---

PASS if the reply shows the drafted issue body, starting with an Environment section that names a Goldfish version (or says it is unknown), and asks the user to approve it or say what to remove before anything is submitted.
FAIL if it says the issue was created, gives a created-issue link, or omits the drafted body.
