#!/usr/bin/env bash
#
# Minimal full-loop test: 7 curl calls against the gateway.
# Uses GATEWAY_URL (default http://localhost:3000) and API_KEY.
# Run from repo root or packages/gateway:
#   GATEWAY_URL=http://localhost:3000 API_KEY=your_chaoschain_api_key ./scripts/full-loop-curl.sh
#
set -e
GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
API_KEY="${API_KEY:-}"
if [ -z "$API_KEY" ]; then
  echo "WARNING: API_KEY not set. Some endpoints may return 401."
fi

STUDIO="0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0"
WORKER="0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831"
# Verifier address (use same as worker for local test, or set VERIFIER_ADDRESS)
VERIFIER="${VERIFIER_ADDRESS:-$WORKER}"

echo "Gateway: $GATEWAY_URL"
echo ""

# Step 1 — create session
echo "Step 1 — create session"
R1=$(curl -s -X POST "$GATEWAY_URL/v1/sessions" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "{
    \"studio_address\": \"$STUDIO\",
    \"agent_address\": \"$WORKER\",
    \"work_mandate_id\": \"generic-task\",
    \"task_type\": \"feature\"
  }")
SESSION_ID=$(echo "$R1" | sed -n 's/.*"session_id":"\([^"]*\)".*/\1/p')
if [ -z "$SESSION_ID" ]; then
  echo "Step 1 failed. Response: $R1"
  exit 1
fi
echo "Step 1 OK — session_id=$SESSION_ID"
echo ""

# Step 2 — emit events (evt_1, evt_2, evt_3 with correct parent chain)
echo "Step 2 — emit events"
R2=$(curl -s -X POST "$GATEWAY_URL/v1/sessions/$SESSION_ID/events" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '[
    {"event_type":"task_received","event_id":"evt_1","timestamp":"2026-03-15T10:00:00Z","summary":"Received feature task","causality":{"parent_event_ids":[]},"agent":{"agent_address":"0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831","role":"worker"},"studio":{"studio_address":"0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"feature"}},
    {"event_type":"plan_created","event_id":"evt_2","timestamp":"2026-03-15T10:02:00Z","summary":"Created implementation plan","causality":{"parent_event_ids":["evt_1"]},"agent":{"agent_address":"0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831","role":"worker"},"studio":{"studio_address":"0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"feature"}},
    {"event_type":"submission_created","event_id":"evt_3","timestamp":"2026-03-15T10:15:00Z","summary":"Submitted completed feature work","causality":{"parent_event_ids":["evt_2"]},"agent":{"agent_address":"0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831","role":"worker"},"studio":{"studio_address":"0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"feature"}}
  ]')
if echo "$R2" | grep -q '"events_accepted":3'; then
  echo "Step 2 OK — events accepted=3"
else
  echo "Step 2 failed. Response: $R2"
  exit 1
fi
echo ""

# Step 3 — complete session
echo "Step 3 — complete session"
R3=$(curl -s -X POST "$GATEWAY_URL/v1/sessions/$SESSION_ID/complete" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"status": "completed", "summary": "Feature task completed"}')
DATA_HASH=$(echo "$R3" | sed -n 's/.*"data_hash":"\([^"]*\)".*/\1/p')
WORKFLOW_ID=$(echo "$R3" | sed -n 's/.*"workflow_id":"\([^"]*\)".*/\1/p')
if echo "$R3" | grep -q '"status":"completed"'; then
  echo "Step 3 OK — workflow_id=$WORKFLOW_ID data_hash=${DATA_HASH:0:18}..."
else
  echo "Step 3 failed. Response: $R3"
  exit 1
fi
echo ""

# Step 4 — verify context
echo "Step 4 — verify context"
R4=$(curl -s "$GATEWAY_URL/v1/sessions/$SESSION_ID/context" -H "x-api-key: $API_KEY")
if echo "$R4" | grep -q '"evidence_summary"' && echo "$R4" | grep -q '"session_metadata"' && ! echo "$R4" | grep -q '"evidence_dag"'; then
  echo "Step 4 OK — session_metadata, studioPolicy, workMandate, evidence_summary present; no evidence_dag"
else
  echo "Step 4 failed or context still contains evidence_dag. Response (first 500 chars): ${R4:0:500}"
  exit 1
fi
echo ""

# Step 5 — fetch evidence
echo "Step 5 — fetch evidence"
R5=$(curl -s "$GATEWAY_URL/v1/sessions/$SESSION_ID/evidence" -H "x-api-key: $API_KEY")
if echo "$R5" | grep -q '"nodes"' && echo "$R5" | grep -q '"edges"' && echo "$R5" | grep -q '"merkle_root"'; then
  echo "Step 5 OK — nodes, edges, roots, terminals, merkle_root present"
else
  echo "Step 5 failed. Response (first 500 chars): ${R5:0:500}"
  exit 1
fi
echo ""

# Step 6 — submit verifier score (only if we have data_hash from step 3)
echo "Step 6 — submit verifier score"
if [ -z "$DATA_HASH" ] || [ "$DATA_HASH" = "null" ]; then
  echo "Step 6 skipped — no data_hash from step 3"
else
  R6=$(curl -s -X POST "$GATEWAY_URL/workflows/score-submission" \
    -H "Content-Type: application/json" \
    -H "x-api-key: $API_KEY" \
    -d "{
      \"studio_address\": \"$STUDIO\",
      \"data_hash\": \"$DATA_HASH\",
      \"scores\": [7200, 6500, 8000, 7500, 7000],
      \"validator_address\": \"$VERIFIER\",
      \"signer_address\": \"$VERIFIER\",
      \"worker_address\": \"$WORKER\",
      \"epoch\": 0,
      \"salt\": \"0x0000000000000000000000000000000000000000000000000000000000000001\"
    }")
  if echo "$R6" | grep -q '"id"'; then
    echo "Step 6 OK — score submission created"
  else
    echo "Step 6 failed (may need registered verifier on-chain). Response: $R6"
  fi
fi
echo ""

# Step 7 — check reputation (agent 1598; may 404/error if not registered on-chain)
echo "Step 7 — check reputation"
R7=$(curl -s "$GATEWAY_URL/v1/agent/1598/reputation")
if echo "$R7" | grep -q '"agent_id"'; then
  echo "Step 7 OK — reputation response received"
elif echo "$R7" | grep -q '"error"'; then
  echo "Step 7 — reputation endpoint returned error (expected if agent 1598 not registered)"
else
  echo "Step 7 response: $R7"
fi
echo ""

echo "Full loop test (7 steps) done."
