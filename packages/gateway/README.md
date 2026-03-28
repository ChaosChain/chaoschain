# ChaosChain Gateway

Off-chain orchestration service for ChaosChain. Manages workflows (work submission, score submission, epoch close), serves the public read API, and hosts the Engineering Studio session API.

---

## Run locally with Docker

The fastest way to test the full gateway locally. Postgres and the gateway are both spun up with a single command.

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- No other process bound to ports 3000 or 5432

### 1. Configure environment

`.env.docker` ships pre-filled with safe local defaults (test signer key, mock Arweave, Sepolia RPC). Review it before running:

```bash
cat packages/gateway/.env.docker
```

If you want to test on-chain flows, replace `SIGNER_PRIVATE_KEY` with your own key and make sure `RPC_URL` is valid.

### 2. Build and start

Run from the **repository root** (the Dockerfile build context is the root):

```bash
docker compose up --build
```

First build takes ~1–2 minutes. On subsequent runs use `docker compose up` (no `--build`) for a fast start.

You should see:

```
gateway  | {"level":"info","msg":"Session API mounted (/v1/sessions)"}
gateway  | {"level":"info","msg":"Gateway started successfully","port":3000}
```

### 3. Verify health

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok", "version": "1.0", ... }
```

### 4. Run the full-loop session test

```bash
cd packages/gateway
GATEWAY_URL=http://localhost:3000 API_KEY=your_chaoschain_api_key npm run test:session-full-loop
```

Expected output:

```
Gateway: http://localhost:3000

Step 1 OK – session_id=sess_...
Step 2 OK – events accepted=3
Step 3 OK – workflow_id=null, data_hash=null
Step 4 OK – context has evidence_summary, no full DAG
Step 5 OK – evidence has full DAG, nodes.length=4
Optional: skipping score submission (no workflow_id/data_hash)

Full loop test passed
```

> `workflow_id` and `data_hash` are null locally unless `SIGNER_PRIVATE_KEY` is funded on Sepolia. The session API and DAG pipeline work end-to-end without a signer.

### 5. Test the session viewer

Run the 7-step curl full loop, then open the viewer in a browser:

```bash
cd packages/gateway
GATEWAY_URL=http://localhost:3000 API_KEY=your_chaoschain_api_key ./scripts/full-loop-curl.sh
```

From the output, copy the `session_id` (e.g. `sess_...`). Then open:

**Local:** `http://localhost:3000/v1/sessions/<session_id>/viewer`  
**Production:** `https://gateway.chaoscha.in/v1/sessions/<session_id>/viewer`

You should see the session header, timeline with badges and parent→child arrows, and the evidence summary footer. No API key is required for the viewer route.

### 6. Stop and clean up

```bash
docker compose down          # stop containers, keep Postgres data
docker compose down -v       # stop and delete Postgres volume (full reset)
```

### Useful commands

```bash
# Tail logs
docker compose logs -f gateway

# Restart just the gateway (after code change + rebuild)
docker compose up --build gateway

# Open a psql shell into the database
docker compose exec postgres psql -U postgres -d gateway

# Check what tables were created
docker compose exec postgres psql -U postgres -d gateway -c '\dt'
```

### Pushing to Railway

When you're satisfied with local testing, set the same environment variables in the Railway dashboard (under Variables) and trigger a deploy. The Dockerfile and `docker-compose.yml` are for local use only — Railway uses the Dockerfile directly.

Key variables to set in Railway:

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Railway injects this automatically when you add a Postgres plugin. |
| `RPC_URL` | Your Alchemy/Infura Sepolia endpoint. |
| `SIGNER_PRIVATE_KEY` | Set as a secret; use a funded Sepolia key. |
| `API_KEY` | Gating key for verifier/worker clients. |
| `ADMIN_KEY` | For key management routes (`/admin/keys`). |
| `USE_MOCK_ARWEAVE` | Set to `false` in production; configure Turbo credentials. |

---

## Quick Start (without Docker)

```bash
cp .env .env.local   # adjust DATABASE_URL to your local Postgres
npm install
npm run build
npm start
```

## Engineering Studio — Session API

The Session API lets coding agents submit structured session events and have them persisted, transformed into an Evidence DAG, and bridged into the on-chain WorkSubmission workflow.

### Endpoints

#### `POST /v1/sessions`

Create a new coding session.

**Headers:** `Content-Type: application/json`

**Request body:**

```json
{
  "studio_address": "0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0",
  "agent_address": "0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831",
  "studio_policy_version": "engineering-studio-default-v1",
  "work_mandate_id": "generic-task",
  "task_type": "feature"
}
```

**Response `201`:**

```json
{
  "version": "1.0",
  "data": {
    "session_id": "sess_abc123…",
    "status": "running",
    "event_count": 0,
    "workflow_id": null,
    "data_hash": null
  }
}
```

---

#### `POST /v1/sessions/:id/events`

Append canonical coding-session events to a running session.

**Headers:** `Content-Type: application/json`

**Request body** (single event or array):

```json
{
  "event_type": "task_received",
  "timestamp": "2026-03-14T10:00:00Z",
  "summary": "Received task",
  "studio": { "studio_address": "0x…", "studio_policy_version": "v1" },
  "task": { "work_mandate_id": "generic-task", "task_type": "feature" },
  "agent": { "agent_address": "0x…", "role": "worker" },
  "causality": { "parent_event_ids": [] }
}
```

**Response `201`:**

```json
{
  "version": "1.0",
  "data": {
    "session_id": "sess_abc123…",
    "events_accepted": 1,
    "total_events": 1,
    "events": [{ "event_id": "evt_…", "…": "…" }]
  }
}
```

---

#### `POST /v1/sessions/:id/complete`

Mark a session as complete. Materialises a terminal node if needed, triggers the WorkSubmission workflow (when configured), and persists `workflow_id` + `data_hash`.

**Headers:** `Content-Type: application/json`

**Request body:**

```json
{ "summary": "All tests pass", "status": "completed" }
```

**Response `200`:**

```json
{
  "version": "1.0",
  "data": {
    "session_id": "sess_abc123…",
    "status": "completed",
    "completed_at": "2026-03-14T12:00:00Z",
    "workflow_id": "eb8e02a6-…",
    "data_hash": "0x1269…"
  }
}
```

---

#### `GET /v1/sessions/:id/viewer`

Self-contained HTML page that shows session metadata, evidence timeline (nodes with badges and parent→child arrows), and evidence summary footer. No API key required. Open in a browser: `http://localhost:3000/v1/sessions/<session_id>/viewer` or `https://gateway.chaoscha.in/v1/sessions/<session_id>/viewer`.

---

#### `GET /v1/sessions/:id/context`

Lightweight verifier scoring context. Returns metadata, policy, mandate, and an evidence summary (no full DAG).

**Response `200`:**

```json
{
  "version": "1.0",
  "data": {
    "session_metadata": { "session_id": "…", "status": "completed", "…": "…" },
    "studioPolicy": { "…": "…" },
    "workMandate": { "taskId": "generic-task", "…": "…" },
    "evidence_summary": {
      "merkle_root": "0x…",
      "node_count": 5,
      "roots": ["evt_1"],
      "terminals": ["evt_5"],
      "evidence_uri": "/v1/sessions/sess_abc123…/evidence"
    }
  }
}
```

---

#### `GET /v1/sessions/:id/evidence`

Full Evidence DAG for deep inspection.

**Response `200`:**

```json
{
  "version": "1.0",
  "data": {
    "evidence_dag": {
      "nodes": [{ "node_id": "…", "event_type": "…", "…": "…" }],
      "edges": [{ "parent_node_id": "…", "child_node_id": "…", "relation": "causal" }],
      "roots": ["evt_1"],
      "terminals": ["evt_5"],
      "merkle_root": "0x…"
    }
  }
}
```

---

### Running the full-loop test locally

A single script runs the full session → context → evidence flow against a **local** gateway. The gateway process must already be running (e.g. `npm run dev` or `npm start`).

**Environment:**

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:3000` | Base URL of the gateway. The default port is 3000 (see `PORT` in app config). |
| `API_KEY` | *(empty)* | If the gateway returns 401 on any request, set this to a valid API key; the script will fail clearly if a gated endpoint returns 401 and no key is set. |

**Run the script:**

```bash
# From packages/gateway (gateway must be running on port 3000)
npm run test:session-full-loop
```

Or with explicit URL and optional API key:

```bash
GATEWAY_URL=http://localhost:3000 API_KEY=your_key npm run test:session-full-loop
```

To test against a deployed gateway (e.g. Railway), set `GATEWAY_URL` to the production base URL and `API_KEY` if required:

```bash
GATEWAY_URL=https://your-gateway.railway.app API_KEY=cc_xxx npm run test:session-full-loop
```

The script creates a session, appends three events (task_received → plan_created → submission_created), completes the session, then fetches context (asserting evidence_summary only, no full DAG) and evidence (asserting full DAG). On success it prints "Full loop test passed" and exits 0; on failure it prints "Full loop test failed: …" and exits 1.

### Pre-deploy: session + reputation read paths (no closeEpoch)

Before merging to `develop` / production, validate that **session ingestion**, **session viewer**, and **`GET /v1/agent/:id/reputation`** all work against a **local** gateway wired to Sepolia RPC (same registry addresses as production).

1. Start Postgres and run `npm run dev` from `packages/gateway` (see main README / `.env.example`).
2. In another terminal:

```bash
cd packages/gateway
API_KEY=cc_internal_seed_key1 npm run validate:reputation-read-paths
```

The script: creates a session → posts **5** events → completes → checks `GET /v1/sessions/:id/context` (`evidence_summary.node_count >= 5`) → checks `GET /v1/sessions/:id/viewer` (HTML) → checks reputation for agents **1935, 1936, 1598, 1937** (Gilbert E2E IDs on studio `0xFA0795…`) and asserts JSON-serializable numbers (no `BigInt` leaks). It does **not** call `closeEpoch`.

Optional manual curls: `scripts/validate-reputation-read-paths.curl.sh` (requires `jq`).

**Seven-step curl script (local gateway):**

To run the full pipeline with **curl** (create session → events → complete → context → evidence → score submission → reputation), use the shell script. It uses `GATEWAY_URL` and `API_KEY` and fills `SESSION_ID` / `data_hash` from responses so you don't paste them by hand. **Do not paste lines starting with `#` in the same command as curl** — the shell treats `#` as a comment and can run it as a command.

```bash
# From packages/gateway, with gateway running (e.g. docker compose up)
GATEWAY_URL=http://localhost:3000 API_KEY=your_chaoschain_api_key ./scripts/full-loop-curl.sh
```

Steps: 1) create session, 2) emit 3 events, 3) complete session, 4) GET context, 5) GET evidence, 6) POST score-submission, 7) GET reputation. Step 7 may error if the agent is not registered on-chain; the rest validate the pipeline.
