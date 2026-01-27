#!/usr/bin/env tsx
/**
 * Gateway Smoke Test
 * 
 * Verifies local Gateway is running and all workflow endpoints are reachable.
 * 
 * Usage:
 *   npm run smoke-test
 *   
 * Or with custom Gateway URL:
 *   GATEWAY_URL=http://localhost:3000 npm run smoke-test
 */

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://localhost:3000';

// Test data (using valid addresses but fake hashes - workflows will fail but endpoints work)
const TEST_STUDIO = '0x0000000000000000000000000000000000000001';
const TEST_AGENT = '0x0000000000000000000000000000000000000002';
const TEST_SIGNER = '0x0000000000000000000000000000000000000003';
const TEST_DATA_HASH = '0x' + '00'.repeat(32);
const TEST_THREAD_ROOT = '0x' + '11'.repeat(32);
const TEST_EVIDENCE_ROOT = '0x' + '22'.repeat(32);
const TEST_SALT = '0x' + '33'.repeat(32);

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true, message: 'OK' });
    console.log(`✅ ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message, details: error });
    console.log(`❌ ${name}: ${message}`);
  }
}

async function fetchJSON(path: string, options?: RequestInit): Promise<unknown> {
  const url = `${GATEWAY_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  
  const body = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = { raw: body };
  }
  
  if (!response.ok && response.status !== 400) {
    // 400 is expected for workflows with test data (validation passes, chain fails)
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  }
  
  return { status: response.status, body: json };
}

// =============================================================================
// TESTS
// =============================================================================

async function main(): Promise<void> {
  console.log(`\n🔍 Gateway Smoke Test`);
  console.log(`   URL: ${GATEWAY_URL}\n`);

  // ---------------------------------------------------------------------------
  // 1. Health Check
  // ---------------------------------------------------------------------------
  await test('GET /health', async () => {
    const result = await fetchJSON('/health') as { status: number; body: { status: string } };
    if (result.status !== 200) throw new Error(`Expected 200, got ${result.status}`);
    if (result.body.status !== 'ok') throw new Error(`Expected status=ok, got ${result.body.status}`);
  });

  // ---------------------------------------------------------------------------
  // 2. WorkSubmission endpoint
  // ---------------------------------------------------------------------------
  await test('POST /workflows/work-submission (endpoint reachable)', async () => {
    const result = await fetchJSON('/workflows/work-submission', {
      method: 'POST',
      body: JSON.stringify({
        studio_address: TEST_STUDIO,
        epoch: 1,
        agent_address: TEST_AGENT,
        data_hash: TEST_DATA_HASH,
        thread_root: TEST_THREAD_ROOT,
        evidence_root: TEST_EVIDENCE_ROOT,
        evidence_content: Buffer.from('test evidence').toString('base64'),
        signer_address: TEST_SIGNER,
      }),
    }) as { status: number; body: { id?: string; error?: string } };
    
    // 201 = created, 400/500 = endpoint exists but failed downstream (expected with test data)
    if (result.status === 201) {
      if (!result.body.id) throw new Error('Missing workflow ID in response');
      console.log(`   Created workflow: ${result.body.id}`);
    } else {
      // Endpoint is reachable, workflow may fail due to test data
      console.log(`   Endpoint reachable (status=${result.status})`);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. ScoreSubmission endpoint
  // ---------------------------------------------------------------------------
  await test('POST /workflows/score-submission (endpoint reachable)', async () => {
    const result = await fetchJSON('/workflows/score-submission', {
      method: 'POST',
      body: JSON.stringify({
        studio_address: TEST_STUDIO,
        epoch: 1,
        validator_address: TEST_AGENT,
        data_hash: TEST_DATA_HASH,
        scores: [8000, 7500, 9000, 6500, 8500], // 5 dimensions
        salt: TEST_SALT,
        signer_address: TEST_SIGNER,
      }),
    }) as { status: number; body: { id?: string; error?: string } };
    
    if (result.status === 201) {
      if (!result.body.id) throw new Error('Missing workflow ID in response');
      console.log(`   Created workflow: ${result.body.id}`);
    } else {
      console.log(`   Endpoint reachable (status=${result.status})`);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. CloseEpoch endpoint
  // ---------------------------------------------------------------------------
  await test('POST /workflows/close-epoch (endpoint reachable)', async () => {
    const result = await fetchJSON('/workflows/close-epoch', {
      method: 'POST',
      body: JSON.stringify({
        studio_address: TEST_STUDIO,
        epoch: 1,
        signer_address: TEST_SIGNER,
      }),
    }) as { status: number; body: { id?: string; error?: string } };
    
    if (result.status === 201) {
      if (!result.body.id) throw new Error('Missing workflow ID in response');
      console.log(`   Created workflow: ${result.body.id}`);
    } else {
      console.log(`   Endpoint reachable (status=${result.status})`);
    }
  });

  // ---------------------------------------------------------------------------
  // 5. GET /workflows endpoint
  // ---------------------------------------------------------------------------
  await test('GET /workflows?state=active', async () => {
    const result = await fetchJSON('/workflows?state=active') as { 
      status: number; 
      body: { workflows?: unknown[]; count?: number; error?: string } 
    };
    
    if (result.status !== 200) throw new Error(`Expected 200, got ${result.status}`);
    if (!Array.isArray(result.body.workflows)) throw new Error('Expected workflows array');
    console.log(`   Found ${result.body.count ?? result.body.workflows.length} active workflows`);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  console.log(`\n📊 Results: ${passed}/${results.length} passed`);
  
  if (failed > 0) {
    console.log(`\n❌ Failed tests:`);
    for (const r of results.filter(r => !r.passed)) {
      console.log(`   - ${r.name}: ${r.message}`);
    }
    process.exit(1);
  } else {
    console.log(`\n✅ All smoke tests passed!`);
    console.log(`\n📝 Next steps:`);
    console.log(`   1. Set up real RPC URL and signer in .env`);
    console.log(`   2. Create a real workflow with valid studio/agent addresses`);
    console.log(`   3. Monitor workflow progress via GET /workflows/:id`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
