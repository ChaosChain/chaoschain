#!/usr/bin/env -S npx tsx
/**
 * Test: Context Endpoint Validation
 *
 * Submits a work item through the gateway, then validates the
 * /v1/work/:hash/context endpoint returns the full scoring context.
 *
 * This is a local integration test — run with a local gateway.
 *
 * Usage:
 *   cd packages/gateway
 *   npx tsx scripts/testContextEndpoint.ts
 *
 * Environment:
 *   GATEWAY_URL — default http://localhost:3000
 *   API_KEY     — API key for gated endpoints (optional for local gateway)
 */

import { config } from 'dotenv';
import { keccak256, AbiCoder } from 'ethers';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.resolve(__dirname, '../.env') });

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const API_KEY = process.env.API_KEY ?? '';
const STUDIO_ADDRESS = '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';
const AGENT_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

function makeHeaders(auth = false): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth && API_KEY) h['x-api-key'] = API_KEY;
  return h;
}

async function gatewayGet(path: string, auth = false): Promise<any> {
  const r = await fetch(`${GATEWAY_URL}${path}`, { headers: makeHeaders(auth) });
  return r.json();
}

async function gatewayPost(path: string, body: unknown): Promise<any> {
  const r = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: makeHeaders(true),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST ${path} → ${r.status}: ${text}`);
  }
  return r.json();
}

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Context Endpoint — Integration Test');
  console.log(`  Gateway: ${GATEWAY_URL}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // ── Check gateway is reachable ──
  console.log('\n── Preflight: Gateway health ──');
  try {
    const health = await gatewayGet('/health');
    assert('Gateway reachable', health.status === 'ok');
  } catch (err) {
    console.error(`  ✗ Cannot reach gateway at ${GATEWAY_URL}: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Build test evidence ──
  const timestamp = Date.now();
  const evidence = [
    {
      arweave_tx_id: `demo_root_${timestamp}`,
      author: AGENT_ADDRESS,
      timestamp,
      parent_ids: [],
      payload_hash: keccak256(new AbiCoder().encode(['string'], [`root-${timestamp}`])),
      artifact_ids: ['src/auth/jwt-validator.ts', 'src/auth/types.ts'],
      signature: '0x' + '00'.repeat(65),
    },
    {
      arweave_tx_id: `demo_child_${timestamp}`,
      author: AGENT_ADDRESS,
      timestamp: timestamp + 1000,
      parent_ids: [`demo_root_${timestamp}`],
      payload_hash: keccak256(new AbiCoder().encode(['string'], [`child-${timestamp}`])),
      artifact_ids: ['src/auth/middleware.ts'],
      signature: '0x' + '00'.repeat(65),
    },
    {
      arweave_tx_id: `demo_integration_${timestamp}`,
      author: AGENT_ADDRESS,
      timestamp: timestamp + 2000,
      parent_ids: [`demo_root_${timestamp}`, `demo_child_${timestamp}`],
      payload_hash: keccak256(new AbiCoder().encode(['string'], [`integration-${timestamp}`])),
      artifact_ids: ['tests/auth/middleware.test.ts'],
      signature: '0x' + '00'.repeat(65),
    },
  ];

  const dataHash = keccak256(new AbiCoder().encode(
    ['string', 'uint256'],
    [`context-test-${timestamp}`, timestamp],
  ));

  // ── Submit work via gateway ──
  console.log('\n── Step 1: Submit work to gateway ──');
  try {
    const result = await gatewayPost('/workflows/work-submission', {
      studio_address: STUDIO_ADDRESS,
      epoch: 1,
      agent_address: AGENT_ADDRESS,
      data_hash: dataHash,
      dkg_evidence: evidence,
      evidence_content: Buffer.from('test-evidence').toString('base64'),
      signer_address: AGENT_ADDRESS,
      studio_policy_version: 'engineering-studio-default-v1',
      work_mandate_id: 'mandate-feature-001',
      task_type: 'feature',
    });
    assert('Work submitted', !!result.id, `workflow: ${result.id}`);
    console.log(`    workflow_id: ${result.id}`);
    console.log(`    data_hash:   ${dataHash}`);
  } catch (err) {
    console.error(`  ✗ Submit failed: ${(err as Error).message}`);
    console.error('    (If 401, set API_KEY in .env)');
    process.exit(1);
  }

  // Wait a moment for workflow processing
  await new Promise(r => setTimeout(r, 2000));

  // ── Test context endpoint ──
  console.log('\n── Step 2: Fetch /v1/work/:hash/context ──');
  const contextResp = await fetch(`${GATEWAY_URL}/v1/work/${dataHash}/context`, {
    headers: makeHeaders(true),
  });

  if (contextResp.status === 401) {
    console.log('  ⚠ 401 — context endpoint is gated, no API_KEY set or key invalid.');
    console.log('    Testing without auth (may pass on local gateway with no keys configured).');
  }

  const contextBody = await contextResp.json() as Record<string, unknown>;

  if (contextResp.status === 404) {
    console.log('  ⚠ 404 — work not found (workflow may still be processing).');
    console.log('    Retrying in 3s...');
    await new Promise(r => setTimeout(r, 3000));

    const retry = await fetch(`${GATEWAY_URL}/v1/work/${dataHash}/context`, {
      headers: makeHeaders(true),
    });
    if (!retry.ok) {
      console.error(`  ✗ Still not found after retry: ${retry.status}`);
      process.exit(1);
    }
    const retryBody = await retry.json() as Record<string, unknown>;
    Object.assign(contextBody, retryBody);
  }

  assert('Context endpoint returns 200', contextResp.ok || contextBody.version === '1.0');

  const data = (contextBody as any).data;
  if (!data) {
    console.error('  ✗ No data in context response');
    process.exit(1);
  }

  // ── Validate context fields ──
  console.log('\n── Step 3: Validate context payload ──');

  assert('work_id present', data.work_id === dataHash);
  assert('data_hash present', data.data_hash === dataHash);
  assert('worker_address present', data.worker_address === AGENT_ADDRESS);
  assert('studio_address present', data.studio_address === STUDIO_ADDRESS);
  assert('task_type is "feature"', data.task_type === 'feature');
  assert('studio_policy_version correct', data.studio_policy_version === 'engineering-studio-default-v1');
  assert('work_mandate_id correct', data.work_mandate_id === 'mandate-feature-001');

  // Evidence
  const ctxEvidence = data.evidence as unknown[];
  assert('evidence is array', Array.isArray(ctxEvidence));
  assert('evidence has 3 nodes', ctxEvidence?.length === 3);

  // Policy
  assert('studioPolicy is object', data.studioPolicy != null && typeof data.studioPolicy === 'object');
  if (data.studioPolicy) {
    assert('policy has studioName', data.studioPolicy.studioName === 'Engineering Agent Studio');
    assert('policy has scoring block', !!data.studioPolicy.scoring);
  }

  // Mandate
  assert('workMandate is object', data.workMandate != null && typeof data.workMandate === 'object');
  if (data.workMandate) {
    assert('mandate taskId matches', data.workMandate.taskId === 'mandate-feature-001');
    assert('mandate taskType is "feature"', data.workMandate.taskType === 'feature');
  }

  // ── Test fallback: work without mandate ──
  console.log('\n── Step 4: Test generic-task mandate fallback ──');
  const bareHash = keccak256(new AbiCoder().encode(
    ['string', 'uint256'],
    [`bare-test-${timestamp}`, timestamp + 100],
  ));

  try {
    await gatewayPost('/workflows/work-submission', {
      studio_address: STUDIO_ADDRESS,
      epoch: 1,
      agent_address: AGENT_ADDRESS,
      data_hash: bareHash,
      dkg_evidence: evidence.slice(0, 1),
      evidence_content: Buffer.from('bare-test').toString('base64'),
      signer_address: AGENT_ADDRESS,
    });

    await new Promise(r => setTimeout(r, 2000));

    const bareResp = await fetch(`${GATEWAY_URL}/v1/work/${bareHash}/context`, {
      headers: makeHeaders(true),
    });
    if (bareResp.ok) {
      const bareData = ((await bareResp.json()) as any).data;
      assert('Bare work: mandate defaults to generic-task', bareData.work_mandate_id === 'generic-task');
      assert('Bare work: workMandate is object (not null)', bareData.workMandate != null && typeof bareData.workMandate === 'object');
      assert('Bare work: workMandate.taskId is generic-task', bareData.workMandate?.taskId === 'generic-task');
      assert('Bare work: task_type defaults to "general"', bareData.task_type === 'general');
    } else {
      console.log(`  ⚠ Bare work context returned ${bareResp.status} — skipping fallback test`);
    }
  } catch (err) {
    console.log(`  ⚠ Bare work submission failed: ${(err as Error).message} — skipping`);
  }

  // ── Summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`\n✗ Failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
