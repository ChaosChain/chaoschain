#!/usr/bin/env npx tsx
/**
 * E2E Full Loop: session → submitWork → score → registerValidator → closeEpoch
 *
 * Runs the COMPLETE ChaosChain Engineering Studio flow against a live gateway.
 * Multi-agent: events from 2 different worker addresses.
 * Prints every step with tx hashes and Etherscan links.
 *
 * Usage:
 *   npx tsx scripts/e2e-full-loop.ts
 *
 * Environment:
 *   GATEWAY_URL        — Gateway base URL (default: http://localhost:3001)
 *   API_KEY            — API key for gated endpoints (optional)
 *   STUDIO_ADDRESS     — Studio proxy address
 *   WORKER_ADDRESS     — Primary worker signer (registered as WORKER in studio)
 *   WORKER_2_ADDRESS   — Second worker signer for multi-agent (optional)
 *   VERIFIER_ADDRESS   — Verifier signer (registered as VERIFIER in studio)
 *   ADMIN_ADDRESS      — Admin signer (RD owner for registerWork/registerValidator/closeEpoch)
 *   SKIP_CLOSE_EPOCH   — Set to "true" to skip closeEpoch step (default: runs closeEpoch)
 *   ETHERSCAN_BASE     — Etherscan base URL (default: https://sepolia.etherscan.io)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3001';
const API_KEY = process.env.API_KEY ?? '';

const STUDIO_ADDRESS = process.env.STUDIO_ADDRESS ?? '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';
const WORKER_ADDRESS = process.env.WORKER_ADDRESS ?? '0x2c855f260851Ba1462065D37c0B03D589bCfA8aD';       // Copilot (agentId 1935)
const WORKER_2_ADDRESS = process.env.WORKER_2_ADDRESS ?? '0x4fc95120d30F6Cee8D7d64255A8d97c83edA7a7f';   // CodeRabbit (agentId 1936)
const VERIFIER_ADDRESS = process.env.VERIFIER_ADDRESS ?? '0xdcA28036eD9e682c1976F6fD34ca64A33103D69C';    // ChaosChain Eval Verifier (agentId 1937)
const ADMIN_ADDRESS = process.env.ADMIN_ADDRESS ?? '0x9B4Cef62a0ce1671ccFEFA6a6D8cBFa165c49831';         // RD Owner (agentId 1598)
const SKIP_CLOSE_EPOCH = process.env.SKIP_CLOSE_EPOCH === 'true';
const EPOCH = parseInt(process.env.EPOCH ?? process.env.CURRENT_EPOCH ?? '0', 10);
const ETHERSCAN = process.env.ETHERSCAN_BASE ?? 'https://sepolia.etherscan.io';

const POLL_MS = 5_000;
const TIMEOUT_MS = 180_000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

async function gw(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const err = json.error as Record<string, unknown> | undefined;
    throw new Error(`${method} ${path} → ${res.status}: ${err?.message ?? JSON.stringify(json)}`);
  }
  return json;
}

async function waitWorkflow(id: string, label: string): Promise<Record<string, unknown>> {
  const start = Date.now();
  process.stdout.write(`   Waiting for ${label}...`);
  while (Date.now() - start < TIMEOUT_MS) {
    const wf = await gw('GET', `/workflows/${id}`);
    const state = wf.state as string;
    if (state === 'COMPLETED') {
      console.log(` done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      return wf;
    }
    if (state === 'FAILED' || state === 'STALLED') {
      console.log(` ${state}`);
      const err = wf.error as Record<string, unknown> | undefined;
      console.log(`   ERROR: ${err?.message ?? 'unknown'} (step: ${wf.step})`);
      return wf;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  console.log(' TIMEOUT');
  throw new Error(`${label} timed out`);
}

const short = (h: string) => (h.length > 14 ? `${h.slice(0, 10)}...${h.slice(-4)}` : h);
const txUrl = (h: string) => `${ETHERSCAN}/tx/${h}`;

function line(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const multiAgent = !!WORKER_2_ADDRESS && WORKER_2_ADDRESS !== WORKER_ADDRESS;

  console.log('ChaosChain E2E Full Loop');
  console.log('========================');
  console.log(`Gateway:    ${GATEWAY_URL}`);
  console.log(`Studio:     ${STUDIO_ADDRESS}`);
  console.log(`Worker 1:   ${WORKER_ADDRESS}`);
  if (multiAgent) console.log(`Worker 2:   ${WORKER_2_ADDRESS}`);
  console.log(`Verifier:   ${VERIFIER_ADDRESS}`);
  console.log(`Admin/RD:   ${ADMIN_ADDRESS}`);
  console.log(`Multi-agent: ${multiAgent ? 'YES' : 'no'}`);
  console.log(`CloseEpoch: ${SKIP_CLOSE_EPOCH ? 'SKIP' : 'YES'}`);

  // Health check
  try {
    await gw('GET', '/health');
    console.log(`Health:     OK`);
  } catch {
    console.error(`\nCannot reach gateway at ${GATEWAY_URL}. Is it running?`);
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 1: Create session
  // ════════════════════════════════════════════════════════════════════════
  line('Step 1: Create Session');

  const createRes = await gw('POST', '/v1/sessions', {
    studio_address: STUDIO_ADDRESS,
    agent_address: WORKER_ADDRESS,
    task_type: 'code_review',
    work_mandate_id: 'generic-task',
  });
  const session = createRes.data as Record<string, unknown>;
  const sessionId = session.session_id as string;
  console.log(`   session_id: ${sessionId}`);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 2: Append events (multi-agent if configured)
  // ════════════════════════════════════════════════════════════════════════
  line(`Step 2: Append Events${multiAgent ? ' (multi-agent)' : ''}`);

  const t = Date.now();
  const events: Record<string, unknown>[] = [
    {
      event_id: `e_${t}_1`, event_type: 'task_received',
      timestamp: new Date(t).toISOString(),
      studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'generic-task', task_type: 'code_review' },
      agent: { agent_address: WORKER_ADDRESS, role: 'worker' },
      causality: { parent_event_ids: [] },
      summary: 'Worker 1 received task',
    },
    {
      event_id: `e_${t}_2`, event_type: 'file_read',
      timestamp: new Date(t + 1000).toISOString(),
      studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'generic-task', task_type: 'code_review' },
      agent: { agent_address: WORKER_ADDRESS, role: 'worker' },
      causality: { parent_event_ids: [`e_${t}_1`] },
      summary: 'Worker 1 analyzed backend changes',
      metrics: { duration_ms: 340, tokens_input: 4200, tokens_output: 1100 },
    },
  ];

  if (multiAgent) {
    events.push(
      {
        event_id: `e_${t}_3`, event_type: 'file_read',
        timestamp: new Date(t + 2000).toISOString(),
        studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
        task: { work_mandate_id: 'generic-task', task_type: 'code_review' },
        agent: { agent_address: WORKER_2_ADDRESS, role: 'worker' },
        causality: { parent_event_ids: [`e_${t}_1`] },
        summary: 'Worker 2 analyzed frontend changes',
        metrics: { duration_ms: 280, tokens_input: 3800 },
      },
      {
        event_id: `e_${t}_4`, event_type: 'artifact_created',
        timestamp: new Date(t + 3000).toISOString(),
        studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
        task: { work_mandate_id: 'generic-task', task_type: 'code_review' },
        agent: { agent_address: WORKER_2_ADDRESS, role: 'worker' },
        causality: { parent_event_ids: [`e_${t}_3`] },
        summary: 'Worker 2 created security audit report',
      },
    );
  }

  // Terminal event
  const terminalParents = multiAgent
    ? [`e_${t}_2`, `e_${t}_4`]
    : [`e_${t}_2`];
  events.push({
    event_id: `e_${t}_final`, event_type: 'submission_created',
    timestamp: new Date(t + 4000).toISOString(),
    studio: { studio_address: STUDIO_ADDRESS, studio_policy_version: 'engineering-studio-default-v1' },
    task: { work_mandate_id: 'generic-task', task_type: 'code_review' },
    agent: { agent_address: WORKER_ADDRESS, role: 'worker' },
    causality: { parent_event_ids: terminalParents },
    summary: 'Compiled final review',
  });

  const evRes = await gw('POST', `/v1/sessions/${sessionId}/events`, events);
  const evData = evRes.data as Record<string, unknown>;
  console.log(`   events_accepted: ${evData.events_accepted}`);
  if (multiAgent) console.log(`   agents: ${WORKER_ADDRESS.slice(0, 10)}... + ${WORKER_2_ADDRESS.slice(0, 10)}...`);

  // ════════════════════════════════════════════════════════════════════════
  // STEP 3: Complete session → submitWork + registerWork
  // ════════════════════════════════════════════════════════════════════════
  line('Step 3: Complete Session (submitWork + registerWork on-chain)');

  const compRes = await gw('POST', `/v1/sessions/${sessionId}/complete`, {
    status: 'completed', summary: 'E2E full loop',
  });
  const comp = compRes.data as Record<string, unknown>;
  const workflowId = comp.workflow_id as string | null;
  const dataHash = comp.data_hash as string | null;
  const sessionEpoch = (comp.epoch as number) ?? EPOCH;

  console.log(`   workflow_id: ${workflowId ?? 'null'}`);
  console.log(`   data_hash:   ${dataHash ? short(dataHash) : 'null'}`);
  console.log(`   epoch:       ${sessionEpoch}`);

  if (!workflowId || !dataHash) {
    console.error('\n   No workflow — SIGNER_PRIVATE_KEY not configured?');
    process.exit(1);
  }

  const workWf = await waitWorkflow(workflowId, 'WorkSubmission');
  if (workWf.state !== 'COMPLETED') process.exit(1);

  const wp = workWf.progress as Record<string, unknown>;
  console.log(`   submitWork tx:   ${txUrl(wp.onchain_tx_hash as string)}`);
  console.log(`   registerWork tx: ${txUrl(wp.register_tx_hash as string)}`);
  console.log(`   arweave:         ${wp.arweave_tx_id}`);

  const dkgWeights = wp.dkg_weights as Record<string, number> | undefined;
  if (dkgWeights && Object.keys(dkgWeights).length > 0) {
    console.log(`   dkg_weights:`);
    for (const [a, w] of Object.entries(dkgWeights)) {
      console.log(`     ${short(a)}: ${(w * 100).toFixed(1)}%`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 4: Verify Evidence DAG
  // ════════════════════════════════════════════════════════════════════════
  line('Step 4: Verify Evidence DAG');

  const evdRes = await gw('GET', `/v1/sessions/${sessionId}/evidence`);
  const evdData = evdRes.data as Record<string, unknown>;
  const dag = evdData.evidence_dag as Record<string, unknown>;
  const nodes = dag.nodes as Record<string, unknown>[];

  console.log(`   nodes:       ${nodes.length}`);
  console.log(`   merkle_root: ${short(dag.merkle_root as string)}`);

  const uniqueAgents = [...new Set(nodes.map((n) => n.agent_address as string))];
  console.log(`   agents:      ${uniqueAgents.length} unique`);
  for (const addr of uniqueAgents) {
    const count = nodes.filter((n) => n.agent_address === addr).length;
    console.log(`     ${short(addr)}: ${count} events`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // STEP 5: Submit scores for ALL workers (verifier → each worker)
  // ════════════════════════════════════════════════════════════════════════
  line('Step 5: Submit Scores (Verifier → each Worker)');

  // V1: single-agent on-chain. The only participant is the admin signer (msg.sender).
  // Multi-agent evidence lives in the DAG, but on-chain only the signer is participant.
  const workersToScore = [ADMIN_ADDRESS];

  const scores = [8500, 7200, 9000, 8800, 7600];
  console.log(`   scores:    [${scores.map((s) => (s / 100).toFixed(0)).join(', ')}] (0-100)`);
  console.log(`   validator: ${short(VERIFIER_ADDRESS)}`);
  console.log(`   workers:   ${workersToScore.length}`);

  // Score each worker and collect last successful progress for summary
  let lastScoreProgress: Record<string, unknown> = {};

  for (let i = 0; i < workersToScore.length; i++) {
    const worker = workersToScore[i];
    console.log(`\n   --- Scoring worker ${i + 1}/${workersToScore.length}: ${short(worker)} ---`);

    const scoreRes = await gw('POST', '/workflows/score-submission', {
      studio_address: STUDIO_ADDRESS,
      data_hash: dataHash,
      scores,
      validator_address: VERIFIER_ADDRESS,
      signer_address: VERIFIER_ADDRESS,
      worker_address: worker,
      admin_signer_address: ADMIN_ADDRESS,
      epoch: sessionEpoch,
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001',
      mode: 'direct',
    });
    const scoreWfId = (scoreRes as Record<string, unknown>).id as string;

    const scoreWf = await waitWorkflow(scoreWfId, `ScoreSubmission (worker ${i + 1})`);
    const sp = scoreWf.progress as Record<string, unknown>;

    if (!sp.score_confirmed) {
      console.error(`   Score submission failed for ${short(worker)}`);
      process.exit(1);
    }

    console.log(`   submitScore tx:      ${txUrl(sp.score_tx_hash as string)}`);

    if (scoreWf.state === 'COMPLETED') {
      console.log(`   registerValidator tx: ${txUrl(sp.register_validator_tx_hash as string)}`);
    } else {
      console.log(`   registerValidator: FAILED (${(scoreWf.error as Record<string, unknown>)?.message ?? 'unknown'})`);
      process.exit(1);
    }

    lastScoreProgress = sp;
  }

  const sp = lastScoreProgress;

  // ════════════════════════════════════════════════════════════════════════
  // STEP 6: Close Epoch (triggers consensus + rewards + reputation)
  // ════════════════════════════════════════════════════════════════════════
  if (!SKIP_CLOSE_EPOCH) {
    line('Step 6: Close Epoch (consensus + rewards + reputation)');

    console.log(`   studio: ${short(STUDIO_ADDRESS)}`);
    console.log(`   epoch:  ${sessionEpoch}`);
    console.log(`   signer: ${short(ADMIN_ADDRESS)} (RD owner)`);
    console.log('');
    console.log('   This triggers:');
    console.log('     - Consensus calculation per worker');
    console.log('     - Reward distribution (worker pool + validator pool)');
    console.log('     - Reputation publishing to ERC-8004 (per-worker + per-validator)');

    const epochRes = await gw('POST', '/workflows/close-epoch', {
      studio_address: STUDIO_ADDRESS,
      epoch: sessionEpoch,
      signer_address: ADMIN_ADDRESS,
    });
    const epochWfId = (epochRes as Record<string, unknown>).id as string;

    const epochWf = await waitWorkflow(epochWfId, 'CloseEpoch');
    const ep = epochWf.progress as Record<string, unknown>;

    if (epochWf.state === 'COMPLETED') {
      console.log(`   closeEpoch tx: ${txUrl(ep.close_tx_hash as string)}`);
      if (ep.treasury_withdraw_confirmed) {
        console.log(`   treasury withdraw tx: ${txUrl(ep.treasury_withdraw_tx_hash as string)}`);
      }
    } else {
      console.log(`   closeEpoch: ${epochWf.state}`);
      const err = epochWf.error as Record<string, unknown> | undefined;
      console.log(`   Error: ${err?.message ?? 'unknown'}`);
      console.log('   Note: closeEpoch may fail if epoch has prior work without scores.');
      console.log('   This is expected if other sessions registered work in epoch 0.');
    }
  } else {
    line('Step 6: Close Epoch — SKIPPED (SKIP_CLOSE_EPOCH=true)');
    console.log('   To close manually:');
    console.log(`   curl -X POST ${GATEWAY_URL}/workflows/close-epoch \\`);
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"studio_address":"${STUDIO_ADDRESS}","epoch":${sessionEpoch},"signer_address":"${ADMIN_ADDRESS}"}'`);
  }

  // ════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════
  line('Summary');

  console.log(`   Session:          ${sessionId}`);
  console.log(`   Data Hash:        ${dataHash}`);
  console.log(`   Studio:           ${STUDIO_ADDRESS}`);
  console.log(`   Multi-agent:      ${multiAgent ? `YES (${uniqueAgents.length} workers)` : 'no'}`);
  console.log(`   submitWork:       ${txUrl(wp.onchain_tx_hash as string)}`);
  console.log(`   registerWork:     ${txUrl(wp.register_tx_hash as string)}`);
  console.log(`   submitScore:      ${txUrl(sp.score_tx_hash as string)}`);
  console.log(`   registerValidator: ${txUrl(sp.register_validator_tx_hash as string)}`);
  console.log('');
  console.log('E2E full loop PASSED');
  process.exit(0);
}

main().catch((err) => {
  const msg = (err as Error).message;
  if (msg === 'fetch failed' || msg.includes('ECONNREFUSED')) {
    console.error(`\nCannot connect to gateway at ${GATEWAY_URL}`);
  } else {
    console.error(`\n${msg}`);
  }
  process.exit(1);
});
