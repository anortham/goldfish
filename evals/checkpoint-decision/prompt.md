---
tags: [checkpoint]
max_turns: 15
allowed_tools: [Read, Glob, Grep, Skill]
---

Project: /work/acme-api. We just settled a design question: webhook retries will use an outbox table that a worker polls every 5 seconds, not a message queue. We rejected RabbitMQ because we do not want to run and monitor a broker for one feature. Make sure future sessions know about this decision.
