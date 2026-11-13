# Test Plan and Expected Outcomes

## Automatic tests

```bash
npm test
```

The Node test runner covers the following 16 unit cases:

1. Both workflow definitions validate.
2. Nested AND, NOT, and strictly typed comparisons.
3. Prototype traversal is blocked.
4. Missing receipt rejects expense.
5. Expense at ₹5,000 is approved.
6. Expense ₹12,000 routes to manager.
7. Large expense reaches configured default review.
8. Stage transition resolves to finance.
9. Vendor risk >=80 rejects.
10. Low-risk, complete vendor invokes external verification.
11. Simulated dependency fails once and then recovers.
12. External verification mismatch rejects.
13. Exponential retry backoff is capped.
14. Numeric bounds, unknown fields, and valid payload validation.
15. Priority ordering chooses missing-receipt rule ahead of amount.
16. Publishing definition with invalid stage reference fails validation.

## Manual integration scenarios (requires MongoDB running)

| Scenario | How to trigger | Expected |
|---|---|---|
| Health | `GET /api/health` | 200, ok=true |
| Create | POST expense with valid data and unique key | 201 and request |
| Invalid input | Negative amount | 400 |
| Duplicate submission | Same idempotency key and payload | 200, replayed=true, same _id |
| Key conflict | Same idempotency key, different amount | 409 |
| Manual approval | Expense amount=12000, then approve | Stage changes manager → finance |
| Rejected review | Reject pending review | REJECTED, audit appended |
| Conflict | Two parallel reviews with same stage | Only one succeeds; other 409 |
| Failure simulation | Vendor simulated failures=1 | RETRY_SCHEDULED, then WAITING_REVIEW |
| Retry exhaustion | Vendor simulated failures=10 | FAILED after three attempts |
| Manual recovery | POST retry on failed vendor | Starts another set of attempts |
| Configuration change | Publish modified expense threshold | Version increments; new submissions use new version |
| Stable snapshot | Inspect existing request after publish | workflowVersion and definition unchanged |
| Audit | GET request after actions | Rule/actor/timestamp/transition evidence |

### Parallel approval test using curl

Create an expense needing approval, replace `<ID>`, then execute:

```bash
for n in 1 2; do
  curl -s -w '\nHTTP %{http_code}\n' -X POST "http://localhost:5000/api/requests/<ID>/review" \
    -H 'Content-Type: application/json' \
    -d "{\"decision\":\"APPROVE\",\"expectedStage\":\"manager\",\"actor\":\"Manager $n\"}" &
done
wait
```

The `expectedStage` precondition guarantees that a stale manager approval cannot accidentally approve the finance stage, even if the requests arrive sequentially. One response should succeed and the other should receive HTTP 409. Role-specific permissions are still needed before production use.
