# Interview Guide: Explain FlowForge Confidently

## 45-second introduction

“I built FlowForge, a configurable workflow decision platform using Node.js, Express, MongoDB and React. The platform processes real business requests, validates input, evaluates prioritized JSON rules, then either automatically approves, rejects, or routes to multiple manual review stages. It maintains lifecycle state and explainable audit logs. Unlike a simple CRUD approval app, an administrator can publish a new policy version without changing backend logic, while in-progress requests retain their original policy snapshot. I also designed idempotent submission, concurrency-safe reviews, and retry behavior for simulated external dependency failures.”

## 2-minute architecture explanation

“The React dashboard is a thin client: it submits requests, renders current states, provides approval actions, and shows full audit history. Express exposes REST APIs, validates request shape with Zod, then fetches the latest workflow definition stored in MongoDB. Each definition contains input fields, ordered rules, default behavior and approval stages.

“The pure rule engine evaluates nested conditions such as AND/OR and comparisons. It chooses the first matching rule by priority and returns an action. The workflow service translates that action to a state like APPROVED, REJECTED, WAITING_REVIEW or VERIFYING. Each request stores its workflow version and a snapshot of the exact configuration used.

“Updates to request state and audit events are performed together in one atomic MongoDB document operation. A revision counter provides optimistic concurrency control: if two reviewers try to approve simultaneously, only the first valid transition succeeds. For vendor verification, I simulate an external provider outage. A retry worker checks due tasks, uses exponential backoff, and eventually marks a request FAILED if attempts are exhausted. Duplicate submissions are prevented using an idempotency key backed by a unique compound index.”

## Common interview questions

**1. Why a separate rule engine?** Pure policy evaluation can be tested without API or database dependencies. New workflow definitions don't require rewriting if/else branches.

**2. How are rules configured?** JSON stored in MongoDB with a key, version, prioritized conditions, actions, and stages. Publishing increments the version.

**3. What happens when the rule changes midway?** Existing requests keep a snapshot of the definition they started with. New ones evaluate against the newest version. This prevents retroactive business-policy changes.

**4. How does idempotency work?** The API requires an `Idempotency-Key`. MongoDB enforces uniqueness of `(workflowKey, idempotencyKey)`. Repeating the same submission returns the existing result; reusing the key for different content fails with HTTP 409.

**5. What about simultaneous approvals?** A conditional `findOneAndUpdate` requires the current status, stage, and revision. First update increments revision. Second request finds no matching revision and gets HTTP 409. Audit and state update together atomically.

**6. What if the external dependency fails?** Capture error and attempt count, mark `RETRY_SCHEDULED`, compute next retry using exponential backoff. Retry until max attempts, then transition to `FAILED`. Operator can manually restart. No actual external network service is necessary for the test.

**7. How can the evaluator explain a decision?** Audit contains `RULE_EVALUATED` with rule ID, priority, reason, and resulting action, plus state transition and reviewer actions with timestamps.

**8. Why MongoDB?** Flexible JSON-like workflow definitions map naturally to BSON. A request and embedded audit share a document, allowing atomic updates without multi-document transactions. The tradeoff is potential document growth and a weaker fit for relational reporting.

**9. What happens if two rules both match?** Sort ascending priority, first matching rule wins. Configuration should give exception rules (like missing receipts) higher priority.

**10. Why not Kafka or Redis?** A two-hour prototype prioritizes correctness and readability. A single-process poller is sufficient to demonstrate retries, while a production deployment should use a durable queue and lease-based worker ownership.

**11. How do you handle security?** This demo validates payload fields, rejects unknown fields, and forbids executing arbitrary user code in rules. It intentionally omits authentication/RBAC; production requires protected admin configuration and role-specific approval permissions.

**12. How is the system extensible?** Add another JSON definition with fields, rule conditions, stages and actions. Only genuinely new types of steps require extending the generic action interpreter.

## Important limitation to state accurately

“FlowForge is a functional local MVP intended for evaluation. I have not implemented production authentication, distributed worker locking, real third-party integrations, or an enterprise-grade tamper-resistant audit log. I would add these before deploying for real approvals.”

## Live demo speaking script

1. “Here's the overview dashboard with statuses and active workflows.”
2. “I'll submit an expense of ₹3,000. Rule E02 auto-approves it.”
3. “At ₹12,000, the rule routes to the manager. Approving moves the same request to finance, then to approved.”
4. “In the audit timeline, you can see the original rule, transition and reviewer decisions, all with timestamps.”
5. “I'll simulate a failed vendor verification. It schedules a retry, then recovers, without losing the request.”
6. “I'll change the expense threshold in the configuration and publish version 2. New requests use it, while older request snapshots still show v1.”
7. “Finally, the unique idempotency key and revision counter protect against double submission and conflicting reviewer updates.”
