#!/usr/bin/env npx tsx
/**
 * Local validation: session write/read + public reputation reads (no closeEpoch).
 *
 * Prerequisites:
 *   1. Postgres reachable (DATABASE_URL in .env)
 *   2. Gateway running: `cd packages/gateway && npm run dev`
 *   3. RPC + registry env vars set (see .env.example) so ReputationReader can query Sepolia
 *
 * Usage:
 *   cd packages/gateway
 *   API_KEY=cc_internal_seed_key1 npm run validate:reputation-read-paths
 *
 * Or with explicit gateway URL:
 *   GATEWAY_URL=http://127.0.0.1:3000 API_KEY=... npm run validate:reputation-read-paths
 */

const GATEWAY_URL = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY ?? process.env.CHAOSCHAIN_API_KEY ?? '';

const STUDIO_ADDRESS = '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';
const AGENT_ADDRESS = '0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831';

/** Gilbert E2E agent IDs on Engineering Studio v2 (Sepolia) — order: explicit task IDs then 1937 */
const REPUTATION_AGENT_IDS = [1935, 1936, 1598, 1937] as const;

const POLICY = 'engineering-studio-default-v1';
const MANDATE = 'generic-task';

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

function fail(step: string, msg: string): never {
  console.error(`\nFAIL [${step}] ${msg}`);
  process.exit(1);
}

function assertNoBigInt(val: unknown, path: string): void {
  if (typeof val === 'bigint') fail(path, `BigInt leak at ${path} — would break JSON.stringify`);
  if (Array.isArray(val)) {
    val.forEach((v, i) => assertNoBigInt(v, `${path}[${i}]`));
    return;
  }
  if (val !== null && typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      assertNoBigInt(v, `${path}.${k}`);
    }
  }
}

function assertReputationPayload(data: Record<string, unknown>, agentId: number): void {
  assertNoBigInt(data, `reputation agent ${agentId}`);
  if (typeof data.agent_id !== 'number') fail('reputation', `agent ${agentId}: agent_id must be number`);
  if (typeof data.trust_score !== 'number') fail('reputation', `agent ${agentId}: trust_score must be number`);
  if (typeof data.epochs_participated !== 'number') {
    fail('reputation', `agent ${agentId}: epochs_participated must be number`);
  }
  try {
    JSON.stringify(data);
  } catch (e) {
    fail('reputation', `agent ${agentId}: JSON.stringify failed — ${(e as Error).message}`);
  }
}

function baseEvent(
  eventId: string,
  eventType: string,
  timestamp: string,
  summary: string,
  parentIds: string[],
): Record<string, unknown> {
  return {
    event_id: eventId,
    event_type: eventType,
    timestamp,
    summary,
    studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: POLICY },
    task: { work_mandate_id: MANDATE, task_type: 'validation' },
    agent: { agent_address: AGENT_ADDRESS, role: 'worker' },
    causality: { parent_event_ids: parentIds },
  };
}

async function main(): Promise<void> {
  console.log('=== Reputation + session read-path validation ===');
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log(`API key: ${API_KEY ? '(set)' : '(empty — OK if gateway has no key gating)'}`);
  console.log('');

  // --- 1. Create session ---
  const createRes = await fetch(`${GATEWAY_URL}/v1/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      studio_address: STUDIO_ADDRESS,
      agent_address: AGENT_ADDRESS,
      work_mandate_id: MANDATE,
      task_type: 'validation',
    }),
  });
  const createJson = (await createRes.json()) as Record<string, unknown>;
  if (!createRes.ok) {
    const err = createJson.error as { message?: string } | undefined;
    fail(
      '1 POST /v1/sessions',
      `status ${createRes.status} ${err?.message ?? JSON.stringify(createJson)}`,
    );
  }
  const sessionId = (createJson.data as Record<string, unknown>)?.session_id as string | undefined;
  if (!sessionId) fail('1 POST /v1/sessions', 'missing data.session_id');
  console.log(`1 OK  POST /v1/sessions → session_id=${sessionId}`);

  // --- 2. Five chained events ---
  const events = [
    baseEvent('evt_v1', 'task_received', '2026-02-10T10:00:00Z', 'Task received', []),
    baseEvent('evt_v2', 'plan_created', '2026-02-10T10:01:00Z', 'Plan drafted', ['evt_v1']),
    baseEvent('evt_v3', 'file_written', '2026-02-10T10:02:00Z', 'Implementation', ['evt_v2']),
    baseEvent('evt_v4', 'test_run', '2026-02-10T10:03:00Z', 'Tests executed', ['evt_v3']),
    baseEvent('evt_v5', 'submission_created', '2026-02-10T10:04:00Z', 'Ready for review', ['evt_v4']),
  ];

  const eventsRes = await fetch(`${GATEWAY_URL}/v1/sessions/${sessionId}/events`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(events),
  });
  const eventsJson = (await eventsRes.json()) as Record<string, unknown>;
  if (!eventsRes.ok) {
    const err = eventsJson.error as { message?: string } | undefined;
    fail(
      '2 POST /v1/sessions/:id/events',
      `status ${eventsRes.status} ${err?.message ?? JSON.stringify(eventsJson)}`,
    );
  }
  const accepted = (eventsJson.data as Record<string, unknown>)?.events_accepted;
  if (accepted !== 5) fail('2 POST events', `expected events_accepted=5, got ${accepted}`);
  console.log('2 OK  POST /v1/sessions/:id/events (5 events accepted)');

  // --- 3. Complete ---
  const completeRes = await fetch(`${GATEWAY_URL}/v1/sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ status: 'completed', summary: 'validate-reputation-read-paths' }),
  });
  const completeJson = (await completeRes.json()) as Record<string, unknown>;
  if (!completeRes.ok) {
    const err = completeJson.error as { message?: string } | undefined;
    fail(
      '3 POST /v1/sessions/:id/complete',
      `status ${completeRes.status} ${err?.message ?? JSON.stringify(completeJson)}`,
    );
  }
  console.log('3 OK  POST /v1/sessions/:id/complete');

  // --- 4. Context + evidence_summary ---
  const ctxRes = await fetch(`${GATEWAY_URL}/v1/sessions/${sessionId}/context`);
  const ctxJson = (await ctxRes.json()) as Record<string, unknown>;
  if (!ctxRes.ok) {
    const err = ctxJson.error as { message?: string } | undefined;
    fail('4 GET context', `status ${ctxRes.status} ${err?.message ?? JSON.stringify(ctxJson)}`);
  }
  const ctxData = ctxJson.data as Record<string, unknown>;
  const summary = ctxData?.evidence_summary as Record<string, unknown> | undefined;
  if (!summary) fail('4 GET context', 'missing evidence_summary');
  if (typeof summary.node_count !== 'number' || summary.node_count < 5) {
    fail('4 GET context', `expected evidence_summary.node_count >= 5, got ${summary.node_count}`);
  }
  assertNoBigInt(ctxData, 'session context');
  console.log(
    `4 OK  GET /v1/sessions/:id/context (node_count=${summary.node_count}, roots=${(summary.roots as unknown[])?.length ?? '?'})`,
  );

  // --- 5–7. Reputation (Gilbert E2E agent IDs) ---
  for (const agentId of REPUTATION_AGENT_IDS) {
    const repRes = await fetch(`${GATEWAY_URL}/v1/agent/${agentId}/reputation`);
    const text = await repRes.text();
    let repJson: Record<string, unknown>;
    try {
      repJson = JSON.parse(text) as Record<string, unknown>;
    } catch {
      fail('reputation', `agent ${agentId}: invalid JSON body`);
    }
    if (repRes.status !== 200) {
      const err = repJson.error as { code?: string; message?: string } | undefined;
      fail(
        'reputation',
        `GET /v1/agent/${agentId}/reputation → ${repRes.status} ${err?.code ?? ''} ${err?.message ?? text.slice(0, 200)}`,
      );
    }
    const data = repJson.data as Record<string, unknown> | undefined;
    if (!data) fail('reputation', `agent ${agentId}: missing data`);
    assertReputationPayload(data, agentId);
    console.log(
      `    GET /v1/agent/${agentId}/reputation → 200 trust_score=${data.trust_score} epochs_participated=${data.epochs_participated}`,
    );
  }
  console.log('5–7 OK  Reputation reads (1935, 1936, 1598, 1937 — Gilbert E2E set)');

  // --- Session viewer ---
  const viewerRes = await fetch(`${GATEWAY_URL}/v1/sessions/${sessionId}/viewer`);
  const html = await viewerRes.text();
  if (viewerRes.status !== 200) fail('viewer', `GET viewer → ${viewerRes.status}`);
  if (!html.includes('<!DOCTYPE html') && !html.includes('<!doctype html')) {
    fail('viewer', 'response does not look like HTML');
  }
  if (!html.includes('ChaosChain')) fail('viewer', 'expected ChaosChain branding in HTML');
  if (!html.includes('ROOT')) fail('viewer', 'expected session viewer to mark ROOT nodes');
  console.log(`8 OK  GET /v1/sessions/:id/viewer (HTML ${html.length} bytes)`);

  console.log('\nPASS — all read paths OK, no BigInt serialization issues.');
}

main().catch((err) => {
  const msg = (err as Error).message;
  if (msg === 'fetch failed' || msg.includes('ECONNREFUSED')) {
    console.error(
      '\nFAIL: Cannot reach gateway. Start it with: cd packages/gateway && npm run dev',
      `\n       GATEWAY_URL=${GATEWAY_URL}`,
    );
  } else {
    console.error('\nFAIL:', err);
  }
  process.exit(1);
});
