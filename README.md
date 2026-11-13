# FlowForge — Configurable Workflow Decision Platform

A complete full-stack assignment implementation with **Node.js + Express + MongoDB + React**. Uses configurable JSON policy definitions, a generic rule evaluator, multi-stage manual approvals, versioned workflows, an audit timeline, idempotent submission, failure simulation, and automatic/manual retries.

## Quick start — macOS

**Prerequisites:** Node.js 20+ and either MongoDB Atlas (recommended if MongoDB is not installed) or a local MongoDB server.

```bash
# From project root
npm run install:all
cp backend/.env.example backend/.env
# Edit backend/.env: set MONGO_URI to the actual running MongoDB URI.
# Terminal A
npm run dev:backend
# Terminal B
npm run dev:frontend
```

Open **http://localhost:5173**. API: **http://localhost:5000/api/health**.

**Using MongoDB Atlas:** Create a free cluster, create a database user, allow your current IP, and copy the **Drivers** connection URI into `backend/.env` as `MONGO_URI`. Replace `<username>`, `<password>`, and add `/flowforge` before connection options. URL-encode passwords with reserved URL characters. Keep this file private.

**Using local MongoDB:** Ensure `mongod` is running. Default `MONGO_URI=mongodb://127.0.0.1:27017/flowforge`.

**Ports occupied?** Set `PORT=5001` in backend `.env` and update the proxy target in `frontend/vite.config.js` to `http://localhost:5001`.

## Demo walkthrough (5 minutes)

1. **Create Expense Reimbursement**: employee `Alex`, amount `3000`, category `Travel`, receipt `Yes`. Decision: **APPROVED**, rule `E02`.
2. Submit amount `12000`, receipt `Yes`. Decision: **WAITING_REVIEW** at `manager`. Select **Approve** (moves to `finance`); approve again (becomes **APPROVED**). Each reviewer and reason is in **Audit timeline**.
3. Submit expense with receipt `No`. Decision: **REJECTED**, rule `E01`. Audit contains the exact rule ID and explanation.
4. **Vendor Onboarding**: vendor `Acme`, risk score `20`, documents `Yes`, external check `Yes`, simulated failures `1`. Initial status **RETRY_SCHEDULED**, automatically transitions to **WAITING_REVIEW** when the retry succeeds. Then approve compliance.
5. Open **Workflows**: for `expense` change the first amount threshold (`"value": 5000`) to `10000` and publish. Run a fresh request amount `7000`; it now auto-approves. Old requests retain their original version and decision.
6. For idempotency, use `curl` twice with the same key (examples below). The second call replays the original result instead of creating a duplicate.

## API examples

```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/workflows
curl http://localhost:5000/api/requests
curl http://localhost:5000/api/stats

curl -X POST http://localhost:5000/api/requests \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-expense-0001' \
  -d '{"workflowKey":"expense","applicant":"Alex","payload":{"employee":"Alex","amount":12000,"category":"Travel","hasReceipt":true}}'

# Replace <ID> with MongoDB request _id
curl -X POST http://localhost:5000/api/requests/<ID>/review \
  -H 'Content-Type: application/json' \
  -d '{"decision":"APPROVE","expectedStage":"manager","actor":"Manager Priya","comment":"Receipt verified"}'

curl -X POST http://localhost:5000/api/requests/<ID>/retry
curl http://localhost:5000/api/requests/<ID>
```

### API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/workflows` | Latest active version of each workflow |
| GET | `/api/workflows/:key` | Latest configuration |
| GET | `/api/workflows/:key/versions` | All versions |
| POST | `/api/workflows/:key/versions` | Publish a new configuration version |
| POST | `/api/requests` | Validate, evaluate, and submit an idempotent request |
| GET | `/api/requests` | Paginated list (filter by `status` and `workflowKey`) |
| GET | `/api/requests/:id` | Request, snapshot, and full audit trail |
| POST | `/api/requests/:id/review` | Approve or reject current manual stage |
| POST | `/api/requests/:id/retry` | Manual retry of a pending/failed external check |
| GET | `/api/stats` | Status counts |

## Architecture

```text
Browser (React + Vite)
         │ HTTP/JSON
         ▼
Express REST API ──► Validation (Zod + definition fields)
         │
         ├──► Workflow Registry (MongoDB, versioned definitions)
         │
         └──► Decision Engine (pure rule evaluator)
                     │
                     ├── APPROVE / REJECT  ─────────────┐
                     ├── REVIEW (manager → finance) ───┤
                     └── VERIFY (mock dependency) ─────┤
                                   │                   │
                                   ▼                   │
                         Retry worker / backoff        │
                                   │                   │
                                   └─────────┬─────────┘
                                             ▼
                                   MongoDB Request document
                                  [state + embedded audit]
```

**Separation of concerns:** Express routes handle transport; `services/` coordinate persistence; `engine/rules.js` only evaluates deterministic policies; `engine/decisions.js` resolves outcomes; Mongoose models manage storage. The frontend never decides approvals.

## Core engineering decisions

- **Configurable**: `Workflow` documents hold fields, prioritized rules, default action, and manual stages. Publishing inserts a *new version*. No branch logic is hardcoded for specific workflows in the server.
- **Versioning**: each request embeds the complete workflow definition snapshot it evaluated. A policy update applies only to new requests.
- **Priority**: rules are sorted ascending by `priority`; the first match wins. Default action applies if nothing matches. `all`, `any`, `not`, `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists` supported.
- **Idempotency**: `(workflowKey, idempotencyKey)` has a unique MongoDB index. Same key + equivalent payload returns the same request; different payload produces `409`.
- **Concurrency**: reviewers perform conditional atomic MongoDB updates checking `status`, `revision`, and `currentStage`. Concurrent decisions cannot both succeed; one receives `409`.
- **Auditing**: immutable-by-API events are appended in the *same single-document atomic update* as state changes. Each event records actor, time, action, and decision evidence.
- **Fault tolerance**: deterministic fake identity provider can fail a configurable number of times. Exponential backoff retries until max attempts, then moves to `FAILED`; operator can restart verification.
- **Minimal dependencies**: no real 3rd-party provider, scheduler infrastructure, Redis, or Kafka. The testable fake verifier satisfies the dependency failure requirement.

## Testing

```bash
npm test
npm run build
```

Node's built-in test runner includes 16 tests of rule selection, nested condition logic, guardrails, transitions, failure simulation and payload validation. A separate checklist of MongoDB integration tests is in `docs/TEST_PLAN.md`.

**Important production limitations**: This is a demo prototype. There is no authentication/authorization, no administrative approval for configuration changes, no payload PII redaction, and the retry poller is not safe to run on multiple processes simultaneously without a claim/lease mechanism. A single MongoDB document keeps each request's audit and state consistent, but very large histories will eventually hit document-size limits. For production, introduce JWT/RBAC, immutable audit collection with transactions/outbox, a durable queue/worker claim, schema limits, rate limiting, log correlation and monitoring.

## Files

```text
flowforge-mern/
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── src/
│   │   ├── server.js
│   │   ├── engine/{rules.js,decisions.js}
│   │   ├── models/{Workflow.js,Request.js}
│   │   ├── routes/api.js
│   │   ├── services/{workflows.js,requests.js}
│   │   └── workflows/{expense.json,vendor.json}
│   └── tests/engine.test.js
├── frontend/
│   ├── index.html
│   ├── vite.config.js
│   └── src/{main.jsx,style.css}
├── docs/
│   ├── INTERVIEW_GUIDE.md
│   ├── TEST_PLAN.md
│   └── DESIGN_DECISIONS.md
└── package.json
```

## Deployment notes

Frontend can be deployed to Vercel (root directory `frontend`; build `npm run build`, output `dist`; set `VITE_API_URL` to your deployed backend URL). Backend can be deployed on a Node hosting platform; set `MONGO_URI`, `FRONTEND_ORIGIN` and `PORT` through environment variables. MongoDB Atlas should be accessible from backend host. **On free/serverless instances, the in-process retry worker may pause when instances sleep**; deploy a continuously running worker or use a real queue for reliable retries.
