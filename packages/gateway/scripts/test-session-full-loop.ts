#!/usr/bin/env npx tsx
/**
 * Full-loop test for Engineering Studio Session API.
 *
 * Run against a local gateway (default http://localhost:3000).
 * Set GATEWAY_URL and optionally API_KEY in the environment.
 *
 * Usage:
 *   GATEWAY_URL=http://localhost:3000 npx tsx scripts/test-session-full-loop.ts
 *   # or from package root:
 *   cd packages/gateway && npm run test:session-full-loop
 */

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? '';

const STUDIO_ADDRESS = '0xA855F7893ac01653D1bCC24210bFbb3c47324649';
const AGENT_ADDRESS = '0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831';
const TIMESTAMP = '2026-03-14T10:00:00Z';

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

async function fetchJson(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data?: unknown; error?: { code: string; message: string } }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { data?: unknown; error?: { code: string; message: string } };
  if (!res.ok && res.status === 401) {
    console.error('Full loop test failed: 401 Unauthorized. Set API_KEY if the gateway requires it.');
    process.exit(1);
  }
  return { status: res.status, ...json };
}

function fail(step: number, msg: string): never {
  console.error(`Full loop test failed: Step ${step} – ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`Gateway: ${GATEWAY_URL}`);
  console.log('');

  // --- Step 1: Create session ---
  const createRes = await fetchJson('POST', '/v1/sessions', {
    studio_address: STUDIO_ADDRESS,
    agent_address: AGENT_ADDRESS,
    work_mandate_id: 'generic-task',
    task_type: 'feature',
  });
  if (createRes.status < 200 || createRes.status >= 300) {
    fail(1, `POST /v1/sessions returned ${createRes.status}${createRes.error ? ` – ${createRes.error.message}` : ''}`);
  }
  const sessionId = (createRes.data as Record<string, unknown>)?.session_id as string;
  if (!sessionId) fail(1, 'response missing session_id');
  console.log(`Step 1 OK – session_id=${sessionId}`);

  // --- Step 2: Append three events ---
  const events = [
    {
      event_id: 'evt_1',
      event_type: 'task_received',
      timestamp: TIMESTAMP,
      summary: 'Received task',
      studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'generic-task', task_type: 'feature' },
      agent: { agent_address: AGENT_ADDRESS, role: 'worker' as const },
      causality: { parent_event_ids: [] as string[] },
    },
    {
      event_id: 'evt_2',
      event_type: 'plan_created',
      timestamp: '2026-03-14T10:05:00Z',
      summary: 'Created plan',
      studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'generic-task', task_type: 'feature' },
      agent: { agent_address: AGENT_ADDRESS, role: 'worker' as const },
      causality: { parent_event_ids: ['evt_1'] },
    },
    {
      event_id: 'evt_3',
      event_type: 'submission_created',
      timestamp: '2026-03-14T10:10:00Z',
      summary: 'Submission created',
      studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'generic-task', task_type: 'feature' },
      agent: { agent_address: AGENT_ADDRESS, role: 'worker' as const },
      causality: { parent_event_ids: ['evt_2'] },
    },
  ];
  const eventsRes = await fetchJson('POST', `/v1/sessions/${sessionId}/events`, events);
  if (eventsRes.status < 200 || eventsRes.status >= 300) {
    fail(2, `POST /v1/sessions/:id/events returned ${eventsRes.status}${eventsRes.error ? ` – ${eventsRes.error.message}` : ''}`);
  }
  const eventsData = eventsRes.data as Record<string, unknown>;
  const accepted = eventsData?.events_accepted as number;
  if (accepted !== 3) fail(2, `expected events_accepted=3, got ${accepted}`);
  console.log('Step 2 OK – events accepted=3');

  // --- Step 3: Complete session ---
  const completeRes = await fetchJson('POST', `/v1/sessions/${sessionId}/complete`, {
    status: 'completed',
    summary: 'Full loop test',
  });
  if (completeRes.status < 200 || completeRes.status >= 300) {
    fail(3, `POST /v1/sessions/:id/complete returned ${completeRes.status}${completeRes.error ? ` – ${completeRes.error.message}` : ''}`);
  }
  const completeData = completeRes.data as Record<string, unknown>;
  const workflowId = completeData?.workflow_id as string | null | undefined;
  const dataHash = completeData?.data_hash as string | null | undefined;
  console.log(`Step 3 OK – workflow_id=${workflowId ?? 'null'}, data_hash=${dataHash ? `${dataHash.slice(0, 10)}…` : 'null'}`);

  // --- Step 4: GET context (must have evidence_summary, no full DAG) ---
  const contextRes = await fetchJson('GET', `/v1/sessions/${sessionId}/context`);
  if (contextRes.status < 200 || contextRes.status >= 300) {
    fail(4, `GET /v1/sessions/:id/context returned ${contextRes.status}`);
  }
  const contextData = contextRes.data as Record<string, unknown>;
  const summary = contextData?.evidence_summary as Record<string, unknown> | undefined;
  if (!summary) fail(4, 'context response missing evidence_summary');
  if (typeof summary.merkle_root !== 'string' || !summary.merkle_root.startsWith('0x')) {
    fail(4, 'evidence_summary missing or invalid merkle_root');
  }
  if (typeof summary.node_count !== 'number') fail(4, 'evidence_summary missing node_count');
  if (!Array.isArray(summary.roots)) fail(4, 'evidence_summary missing roots');
  if (!Array.isArray(summary.terminals)) fail(4, 'evidence_summary missing terminals');
  if (typeof summary.evidence_uri !== 'string' || !summary.evidence_uri.includes('/evidence')) {
    fail(4, 'evidence_summary missing or invalid evidence_uri');
  }
  if (contextData?.evidence_dag != null) {
    fail(4, 'context must not contain evidence_dag (use /evidence for full DAG)');
  }
  if (summary.nodes != null || summary.edges != null) {
    fail(4, 'evidence_summary must not contain nodes or edges');
  }
  console.log('Step 4 OK – context has evidence_summary, no full DAG');

  // --- Step 5: GET evidence (full DAG) ---
  const evidenceRes = await fetchJson('GET', `/v1/sessions/${sessionId}/evidence`);
  if (evidenceRes.status < 200 || evidenceRes.status >= 300) {
    fail(5, `GET /v1/sessions/:id/evidence returned ${evidenceRes.status}`);
  }
  const evidenceData = evidenceRes.data as Record<string, unknown>;
  const dag = evidenceData?.evidence_dag as Record<string, unknown> | undefined;
  if (!dag) fail(5, 'evidence response missing evidence_dag');
  const nodes = dag.nodes as unknown[] | undefined;
  const edges = dag.edges as unknown[] | undefined;
  if (!Array.isArray(nodes) || nodes.length < 3) {
    fail(5, `evidence_dag.nodes must have at least 3 entries, got ${nodes?.length ?? 0}`);
  }
  if (!Array.isArray(edges)) fail(5, 'evidence_dag missing edges');
  if (!Array.isArray(dag.roots)) fail(5, 'evidence_dag missing roots');
  if (!Array.isArray(dag.terminals)) fail(5, 'evidence_dag missing terminals');
  if (typeof dag.merkle_root !== 'string') fail(5, 'evidence_dag missing merkle_root');
  const eventTypes = new Set((nodes as Record<string, unknown>[]).map((n) => n.event_type as string));
  const expected = ['task_received', 'plan_created', 'submission_created'];
  for (const et of expected) {
    if (!eventTypes.has(et)) fail(5, `expected event_type "${et}" in nodes, got: ${[...eventTypes].join(', ')}`);
  }
  console.log('Step 5 OK – evidence has full DAG, nodes.length=%d', nodes.length);

  // --- Optional: score submission (no hard failure) ---
  if (dataHash && workflowId) {
    try {
      const scoreRes = await fetchJson('POST', '/workflows/score-submission', {
        studio_address: STUDIO_ADDRESS,
        epoch: 0,
        validator_address: AGENT_ADDRESS,
        data_hash: dataHash,
        worker_address: AGENT_ADDRESS,
        scores: [70, 80, 75, 85, 78],
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
        signer_address: AGENT_ADDRESS,
        mode: 'direct',
      });
      if (scoreRes.status >= 200 && scoreRes.status < 300) {
        console.log('Optional: score submission OK');
      } else {
        console.log('Optional: score submission skipped or failed (status %d)', scoreRes.status);
      }
    } catch (e) {
      console.log('Optional: score submission skipped (%s)', (e as Error).message);
    }
  } else {
    console.log('Optional: skipping score submission (no workflow_id/data_hash)');
  }

  console.log('');
  console.log('Full loop test passed');
  process.exit(0);
}

main().catch((err) => {
  const msg = (err as Error).message;
  if (msg === 'fetch failed' || msg.includes('ECONNREFUSED')) {
    console.error('Full loop test failed: Cannot connect to gateway. Is it running?', `GATEWAY_URL=${GATEWAY_URL}`);
  } else {
    console.error('Full loop test failed:', msg);
  }
  process.exit(1);
});
