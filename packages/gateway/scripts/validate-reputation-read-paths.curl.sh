#!/usr/bin/env bash
# Manual curl sequence (same flow as validate-reputation-read-paths.ts).
# Set GATEWAY_URL, API_KEY, STUDIO, AGENT before running.
#
#   export GATEWAY_URL=http://127.0.0.1:3000
#   export API_KEY=cc_internal_seed_key1   # if your gateway gates writes
#   export STUDIO=0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0
#   export AGENT=0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831
#   bash scripts/validate-reputation-read-paths.curl.sh

set -euo pipefail
GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:3000}"
STUDIO="${STUDIO:-0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0}"
AGENT="${AGENT:-0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831}"
HDR=(-H "Content-Type: application/json")
if [[ -n "${API_KEY:-}" ]]; then
  HDR+=(-H "x-api-key: $API_KEY")
fi

echo "1) POST /v1/sessions"
SID=$(curl -sS "${HDR[@]}" -X POST "$GATEWAY_URL/v1/sessions" \
  -d "{\"studio_address\":\"$STUDIO\",\"agent_address\":\"$AGENT\",\"work_mandate_id\":\"generic-task\",\"task_type\":\"validation\"}" \
  | jq -r '.data.session_id')
echo "session_id=$SID"

echo "2) POST 5 events"
curl -sS "${HDR[@]}" -X POST "$GATEWAY_URL/v1/sessions/$SID/events" -d @- <<EOF | jq .
[
  {"event_id":"evt_c1","event_type":"task_received","timestamp":"2026-02-10T10:00:00Z","summary":"Task received","studio":{"studio_address":"$STUDIO","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"validation"},"agent":{"agent_address":"$AGENT","role":"worker"},"causality":{"parent_event_ids":[]}},
  {"event_id":"evt_c2","event_type":"plan_created","timestamp":"2026-02-10T10:01:00Z","summary":"Plan","studio":{"studio_address":"$STUDIO","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"validation"},"agent":{"agent_address":"$AGENT","role":"worker"},"causality":{"parent_event_ids":["evt_c1"]}},
  {"event_id":"evt_c3","event_type":"file_written","timestamp":"2026-02-10T10:02:00Z","summary":"Code","studio":{"studio_address":"$STUDIO","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"validation"},"agent":{"agent_address":"$AGENT","role":"worker"},"causality":{"parent_event_ids":["evt_c2"]}},
  {"event_id":"evt_c4","event_type":"test_run","timestamp":"2026-02-10T10:03:00Z","summary":"Tests","studio":{"studio_address":"$STUDIO","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"validation"},"agent":{"agent_address":"$AGENT","role":"worker"},"causality":{"parent_event_ids":["evt_c3"]}},
  {"event_id":"evt_c5","event_type":"submission_created","timestamp":"2026-02-10T10:04:00Z","summary":"Done","studio":{"studio_address":"$STUDIO","studio_policy_version":"engineering-studio-default-v1"},"task":{"work_mandate_id":"generic-task","task_type":"validation"},"agent":{"agent_address":"$AGENT","role":"worker"},"causality":{"parent_event_ids":["evt_c4"]}}
]
EOF

echo "3) POST complete"
curl -sS "${HDR[@]}" -X POST "$GATEWAY_URL/v1/sessions/$SID/complete" \
  -d '{"status":"completed","summary":"curl validation"}' | jq .

echo "4) GET context"
curl -sS "$GATEWAY_URL/v1/sessions/$SID/context" | jq '.data.evidence_summary'

echo "5–8) Reputation + viewer"
for id in 1935 1936 1598 1937; do
  echo "--- agent $id ---"
  curl -sS "$GATEWAY_URL/v1/agent/$id/reputation" | jq '.data | {trust_score, epochs_participated, last_updated_epoch}'
done

echo "Viewer: $GATEWAY_URL/v1/sessions/$SID/viewer"
curl -sS -o /dev/null -w "viewer HTTP %{http_code}\n" "$GATEWAY_URL/v1/sessions/$SID/viewer"

echo "Done."
