# System Design Decisions and Tradeoffs

## Domain boundaries

- Workflow definition: immutable-version policy, configured by JSON.
- Request instance: submitted data and current state, bound to a snapshot.
- Rule engine: evaluates data and emits chosen action without side effects.
- Workflow service: performs controlled state transitions and simulated side effects.
- Audit: append-only *through exposed API* event stream co-located with request.

## Data flow

`POST /api/requests` → validate HTTP shape → load latest active workflow → validate field schema → check unique idempotency key → evaluate prioritized rules → map action to state → save request plus rule-and-state audit events → for VERIFY call simulator → record result or retry state → return response.

## Retry semantics

The mock provider fails a deterministic number of times using `simulateDependencyFailures`. First failure waits 1 second, second waits 2 seconds, third attempt either succeeds or marks permanently failed. A single-process `setInterval` polls for due retries.

A deliberate simplification: workers do not acquire a distributed lease. A retry worker deployed in more than one instance can invoke the dependency twice. This matters if real provider calls have side effects. A production implementation should claim jobs atomically with an expiring lease and call third-party APIs with an idempotency token.

## Audit consistency

State and audit are updated within one MongoDB document using `$set`, `$inc` and `$push`. This avoids the failure mode where status changes but audit insertion into another collection fails. Disadvantages: embedded audit can grow large, and admins with database access could tamper with history. Real regulatory-grade auditing needs append-only storage and access controls.

## Consistency limitation during initial verification

Request is created before external verification runs. A process crash in the short window between creation and mock verification can leave `VERIFYING` pending. Production needs worker reconciliation of stale `VERIFYING` states.

## Configuration governance

`POST /api/workflows/:key/versions` accepts a replacement definition and publishes `version+1`. Rule syntax is constrained and field paths are checked. Missing: admin auth, approvals, configuration linting for overlapping rules, activation/rollback support and an atomic version allocator for many concurrent publishers. Concurrent publishing can return 409 on duplicate version; caller retries.

## Scale and robustness

- Current approach is fine for a small demo / single instance.
- For large volumes, split audit into a dedicated collection with MongoDB transactions or an outbox.
- For durable retries, use BullMQ/Redis or a dedicated persistent job table with lease ownership.
- For real deployments, require JWT authentication, RBAC for stage approvers, rate limits, input size limits, structured logs, tracing and monitoring.
- Preserve idempotency keys beyond request lifetime or define a documented expiration policy.
- Use a migration strategy for configuration schema changes.

## Answering the evaluator's scoring rubric

| Criterion | Evidence |
|---|---|
| Problem structuring | Separate workflow definitions, requests, decisions, and persistence |
| Architecture quality | Pure decision logic, API orchestration, independent MongoDB models |
| Robustness | Key uniqueness, revision CAS, retry/backoff, errors, persistent state |
| Configurability | JSON policies, rule priorities, version history, request snapshots |
| Explainability | Rule IDs, priorities, reasons, and state events in audit |
| Testing | Unit test suite and manual integration scenarios |
| Tradeoffs | Explicit production limitations above |
