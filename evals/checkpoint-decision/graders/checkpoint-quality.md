---
type: llm
focus: mock_calls
weight: 2
---

PASS if a checkpoint call has a description in structured markdown (a heading or bullet points), states the decision to use a polled outbox table for webhook retries, and records the rejected option (a message queue or RabbitMQ) with the reason it was rejected.
FAIL if no checkpoint call exists, the description is one unstructured sentence, or the rejected option or its reason is missing.
