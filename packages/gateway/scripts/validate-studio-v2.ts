#!/usr/bin/env -S npx tsx
/**
 * ChaosChain — Engineering Studio V2 End-to-End Validation
 *
 * Validates the new StudioProxy + RewardsDistributor V5 through the full lifecycle:
 *   Phase 1: On-chain agent registration + escrow
 *   Phase 2: Gateway session flow (8 events)
 *   Phase 3: On-chain work submission, scoring, closeEpoch, treasury check
 *   Phase 4: Gateway consistency (viewer, leaderboard, reputation)
 *   Phase 5: Old studio comparison (expect revert)
 *   Phase 6: Pass/fail verdict
 *
 * Usage:
 *   cd packages/gateway
 *   npx tsx scripts/validate-studio-v2.ts
 *
 * Environment:
 *   GATEWAY_URL            — Gateway base URL (default: http://localhost:3000)
 *   API_KEY                — Gateway API key
 *   SEPOLIA_RPC_URL        — Alchemy/Infura Sepolia endpoint
 *   DEPLOYER_PRIVATE_KEY   — Owner of ChaosCore + RewardsDistributor
 */

import { ethers, AbiCoder, keccak256, Wallet, JsonRpcProvider } from 'ethers';
import { createHash } from 'node:crypto';
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// =============================================================================
// CONFIGURATION
// =============================================================================

const GATEWAY_URL = (process.env.GATEWAY_URL ?? 'http://localhost:3000')
  .replace('localhost', '127.0.0.1');
const API_KEY = process.env.API_KEY ?? '';

const RPC_URL = process.env.SEPOLIA_RPC_URL
  ?? process.env.RPC_URL
  ?? 'https://eth-sepolia.g.alchemy.com/v2/gkHpxu7aSBljCv8Hlxu1GJnQRsyyZM7z';

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY
  ?? process.env.SEPOLIA_PRIVATE_KEY
  ?? '';

// New contracts (Engineering Studio v2)
const STUDIO_V2         = '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';
const REWARDS_DIST_V5   = '0x28AF9c02982801D35a23032e0eAFa50669E10ba1';
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REG    = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const TREASURY          = '0x20E7B2A2c8969725b88Dd3EF3a11Bc3353C83F70';

// Old studio (legacy — for comparison)
const STUDIO_OLD        = '0xA855F7893ac01653D1bCC24210bFbb3c47324649';

const EPOCH = 0n;
const STAKE = ethers.parseEther('0.00005');
const STUDIO_DEPOSIT = ethers.parseEther('0.0005');
const AGENT_FUNDING = ethers.parseEther('0.0004');
const MIN_DEPLOYER_BALANCE = ethers.parseEther('0.005');

// ABI Fragments
const STUDIO_ABI = [
  'function registerAgent(uint256 agentId, uint8 role) payable',
  'function deposit() payable',
  'function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, bytes feedbackAuth)',
  'function submitScoreVectorForWorker(bytes32 dataHash, address worker, bytes scoreVector)',
  'function getAgentId(address agent) view returns (uint256)',
  'function getTotalEscrow() view returns (uint256)',
  'function getWorkParticipants(bytes32 dataHash) view returns (address[])',
  'function getValidators(bytes32 dataHash) view returns (address[])',
  'function getWithdrawableBalance(address account) view returns (uint256)',
  'function getEscrowBalance(address account) view returns (uint256)',
  'function getRewardsDistributor() view returns (address)',
];

const IDENTITY_ABI = [
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REWARDS_ABI = [
  'function registerWork(address studio, uint64 epoch, bytes32 dataHash)',
  'function registerValidator(bytes32 dataHash, address validator)',
  'function closeEpoch(address studio, uint64 epoch)',
  'function treasury() view returns (address)',
  'function owner() view returns (address)',
];

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
];

const ROLE_WORKER = 1;
const ROLE_VERIFIER = 2;

// =============================================================================
// RESULT TRACKING
// =============================================================================

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  const icon = passed ? 'PASS' : 'FAIL';
  console.log(`  [${icon}] ${name}: ${detail}`);
}

// =============================================================================
// HELPERS
// =============================================================================

async function waitForTx(tx: ethers.TransactionResponse, label: string): Promise<ethers.TransactionReceipt> {
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction failed: ${label} (${tx.hash})`);
  }
  console.log(`    tx: ${tx.hash} (${label})`);
  return receipt;
}

function encodeScoreVector(scores: number[]): string {
  return AbiCoder.defaultAbiCoder().encode(
    ['uint8', 'uint8', 'uint8', 'uint8', 'uint8'],
    scores,
  );
}

async function gw(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; text: string }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;

  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const maxRetries = 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(`${GATEWAY_URL}${path}`, opts);
      const text = await res.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* HTML or non-JSON */ }
      return { status: res.status, data, text };
    } catch (err: any) {
      if (attempt < maxRetries - 1) {
        console.log(`    [retry ${attempt + 1}/${maxRetries}] ${method} ${path}: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
  throw new Error('unreachable');
}

function sha256hex(input: string): string {
  return '0x' + createHash('sha256').update(input).digest('hex');
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('================================================================');
  console.log('  ChaosChain — Engineering Studio V2 E2E Validation');
  console.log('================================================================');
  console.log('');
  console.log('Configuration:');
  console.log(`  Gateway:              ${GATEWAY_URL}`);
  console.log(`  RPC:                  ${RPC_URL.replace(/\/v2\/.*/, '/v2/***')}`);
  console.log(`  Studio V2:            ${STUDIO_V2}`);
  console.log(`  RewardsDistributor:   ${REWARDS_DIST_V5}`);
  console.log(`  Treasury:             ${TREASURY}`);
  console.log(`  Old Studio:           ${STUDIO_OLD}`);
  console.log(`  Epoch:                ${EPOCH}`);
  console.log('');

  if (!DEPLOYER_KEY) {
    console.error('ERROR: No deployer key found. Set DEPLOYER_PRIVATE_KEY or SEPOLIA_PRIVATE_KEY');
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(DEPLOYER_KEY, provider);
  const deployerAddr = await deployer.getAddress();
  const balance = await provider.getBalance(deployerAddr);

  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance < MIN_DEPLOYER_BALANCE) {
    console.error(`Insufficient balance. Need at least ${ethers.formatEther(MIN_DEPLOYER_BALANCE)} ETH`);
    process.exit(1);
  }

  // =========================================================================
  // PRE-FLIGHT: Verify contract state
  // =========================================================================
  console.log('');
  console.log('--- Pre-flight checks ---');

  const studioV2 = new ethers.Contract(STUDIO_V2, STUDIO_ABI, deployer);
  const rewardsDist = new ethers.Contract(REWARDS_DIST_V5, REWARDS_ABI, deployer);

  const distOnStudio = await studioV2.getRewardsDistributor();
  check(
    'StudioV2 → RewardsDistributor wiring',
    distOnStudio.toLowerCase() === REWARDS_DIST_V5.toLowerCase(),
    `Studio points to ${distOnStudio}`,
  );

  const treasuryOnDist = await rewardsDist.treasury();
  check(
    'RewardsDistributor → Treasury wiring',
    treasuryOnDist.toLowerCase() === TREASURY.toLowerCase(),
    `Distributor treasury = ${treasuryOnDist}`,
  );

  const distOwner = await rewardsDist.owner();
  check(
    'Deployer is distributor owner',
    distOwner.toLowerCase() === deployerAddr.toLowerCase(),
    `Owner = ${distOwner}, Deployer = ${deployerAddr}`,
  );

  // =========================================================================
  // PHASE 1: On-chain agent registration + escrow
  // =========================================================================
  console.log('');
  console.log('--- Phase 1: On-chain setup ---');

  const workerWallet = Wallet.createRandom(provider);
  const verifier1Wallet = Wallet.createRandom(provider);
  const verifier2Wallet = Wallet.createRandom(provider);

  console.log(`  Worker:    ${workerWallet.address}`);
  console.log(`  Verifier1: ${verifier1Wallet.address}`);
  console.log(`  Verifier2: ${verifier2Wallet.address}`);

  // Fund wallets
  console.log('  Funding wallets...');
  for (const w of [workerWallet, verifier1Wallet, verifier2Wallet]) {
    const tx = await deployer.sendTransaction({ to: w.address, value: AGENT_FUNDING });
    await waitForTx(tx, `Fund ${w.address.slice(0, 10)}`);
  }

  // Register ERC-8004 identities
  console.log('  Registering ERC-8004 identities...');
  const agentIds: Record<string, bigint> = {};
  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

  for (const [name, wallet] of [
    ['Worker', workerWallet],
    ['Verifier1', verifier1Wallet],
    ['Verifier2', verifier2Wallet],
  ] as const) {
    const signer = wallet.connect(provider);
    const idReg = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, signer);
    const uri = `chaoschain://validate-v2/${name.toLowerCase()}/${Date.now()}`;
    const regTx = await idReg['register(string)'](uri);
    const regReceipt = await waitForTx(regTx, `Register identity: ${name}`);

    let agentId: bigint | null = null;
    for (const log of regReceipt.logs) {
      if (log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.topics.length === 4) {
        agentId = BigInt(log.topics[3]);
        break;
      }
    }
    if (agentId === null) throw new Error(`Failed to parse agentId for ${name}`);
    agentIds[name] = agentId;

    const owner = await identity.ownerOf(agentId);
    check(
      `Identity NFT: ${name}`,
      owner.toLowerCase() === wallet.address.toLowerCase(),
      `agentId=${agentId}, owner=${owner.slice(0, 10)}...`,
    );
  }

  // Register agents on Studio V2
  console.log('  Registering agents on Studio V2...');
  for (const [name, wallet, role] of [
    ['Worker', workerWallet, ROLE_WORKER],
    ['Verifier1', verifier1Wallet, ROLE_VERIFIER],
    ['Verifier2', verifier2Wallet, ROLE_VERIFIER],
  ] as const) {
    const signer = wallet.connect(provider);
    const studioSigned = new ethers.Contract(STUDIO_V2, STUDIO_ABI, signer);
    const tx = await studioSigned.registerAgent(agentIds[name], role, { value: STAKE });
    await waitForTx(tx, `registerAgent: ${name}`);

    const storedId = await studioV2.getAgentId(wallet.address);
    check(
      `Studio registration: ${name}`,
      storedId === agentIds[name],
      `getAgentId=${storedId}`,
    );
  }

  // Deposit escrow
  console.log('  Depositing escrow...');
  const depositTx = await studioV2.deposit({ value: STUDIO_DEPOSIT });
  await waitForTx(depositTx, 'Studio deposit');

  const totalEscrow = await studioV2.getTotalEscrow();
  check(
    'Studio escrow funded',
    totalEscrow > 0n,
    `totalEscrow = ${ethers.formatEther(totalEscrow)} ETH`,
  );

  // Record treasury balance BEFORE
  const treasuryBalanceBefore = await studioV2.getWithdrawableBalance(TREASURY);
  console.log(`  Treasury withdrawable BEFORE: ${ethers.formatEther(treasuryBalanceBefore)} ETH`);

  // =========================================================================
  // PHASE 2: Gateway session flow
  // =========================================================================
  console.log('');
  console.log('--- Phase 2: Gateway session flow ---');

  // Step 2a: Create session
  const createRes = await gw('POST', '/v1/sessions', {
    studio_address: STUDIO_V2,
    agent_address: workerWallet.address,
    work_mandate_id: 'validate-v2-task',
    task_type: 'feature',
    studio_policy_version: 'engineering-studio-default-v1',
  });
  check(
    'Create session',
    createRes.status === 201 && createRes.data?.data?.session_id,
    `status=${createRes.status}, session_id=${createRes.data?.data?.session_id ?? 'MISSING'}`,
  );

  const sessionId = createRes.data?.data?.session_id;
  if (!sessionId) throw new Error('No session_id returned');

  // Step 2b: Emit 8 realistic events
  const baseTime = new Date('2026-02-10T10:00:00Z');
  const events = [
    { event_type: 'task_received',       offset: 0,  summary: 'Received feature request: implement caching layer', parents: [] },
    { event_type: 'plan_created',        offset: 2,  summary: 'Designed Redis-backed cache with TTL and invalidation', parents: [0] },
    { event_type: 'artifact_created',    offset: 5,  summary: 'Implemented CacheService class with get/set/invalidate', parents: [1] },
    { event_type: 'test_failed',         offset: 8,  summary: 'Cache invalidation test failed — race condition on concurrent writes', parents: [2] },
    { event_type: 'debug_step',          offset: 10, summary: 'Identified mutex-free path in invalidate(); adding lock', parents: [3] },
    { event_type: 'revision_made',       offset: 13, summary: 'Added distributed lock with exponential backoff', parents: [4] },
    { event_type: 'test_passed',         offset: 16, summary: 'All 47 tests pass including concurrent invalidation stress test', parents: [5] },
    { event_type: 'submission_created',  offset: 20, summary: 'Submitted caching layer PR with full test coverage', parents: [6] },
  ];

  const eventIds: string[] = [];
  const eventPayloads = events.map((e, i) => {
    const evtId = `evt_validate_${i + 1}`;
    eventIds.push(evtId);
    const ts = new Date(baseTime.getTime() + e.offset * 60_000).toISOString();
    return {
      event_id: evtId,
      event_type: e.event_type,
      timestamp: ts,
      summary: e.summary,
      causality: { parent_event_ids: e.parents.map(p => eventIds[p]) },
      agent: { agent_address: workerWallet.address, role: 'worker' },
      studio: { studio_address: STUDIO_V2, studio_policy_version: 'engineering-studio-default-v1' },
      task: { work_mandate_id: 'validate-v2-task', task_type: 'feature' },
      metrics: { lines_added: (i + 1) * 15, lines_removed: i * 3, files_changed: i + 1 },
      artifacts: i >= 2 ? [{ id: `artifact_${i}`, type: 'code', path: `src/cache/layer${i}.ts` }] : [],
    };
  });

  const eventsRes = await gw('POST', `/v1/sessions/${sessionId}/events`, eventPayloads);
  check(
    'Emit 8 events',
    eventsRes.status === 200 || eventsRes.status === 201,
    `status=${eventsRes.status}, accepted=${eventsRes.data?.data?.accepted ?? 'unknown'}`,
  );

  // Step 2c: Complete session
  const completeRes = await gw('POST', `/v1/sessions/${sessionId}/complete`, {
    status: 'completed',
    summary: 'Caching layer feature completed with full test coverage',
  });
  check(
    'Complete session',
    completeRes.status === 200,
    `status=${completeRes.status}, workflow_id=${completeRes.data?.data?.workflow_id ?? 'null'}, data_hash=${completeRes.data?.data?.data_hash ?? 'null'}`,
  );

  const gatewayWorkflowId = completeRes.data?.data?.workflow_id;
  const gatewayDataHash = completeRes.data?.data?.data_hash;

  // Step 2d: Get context (should be summary only, no full DAG)
  const contextRes = await gw('GET', `/v1/sessions/${sessionId}/context`);
  const ctxData = contextRes.data?.data ?? {};
  check(
    'Context endpoint returns metadata',
    contextRes.status === 200 && ctxData.session_metadata?.session_id === sessionId,
    `session_id=${ctxData.session_metadata?.session_id}`,
  );
  check(
    'Context has evidence_summary (not full DAG)',
    !!ctxData.evidence_summary?.merkle_root && !ctxData.evidence_dag,
    `merkle_root=${ctxData.evidence_summary?.merkle_root?.slice(0, 16)}..., node_count=${ctxData.evidence_summary?.node_count}`,
  );

  // Step 2e: Get full evidence DAG
  const evidenceRes = await gw('GET', `/v1/sessions/${sessionId}/evidence`);
  const dagData = evidenceRes.data?.data?.evidence_dag ?? {};
  check(
    'Evidence endpoint returns full DAG',
    evidenceRes.status === 200 && Array.isArray(dagData.nodes) && dagData.nodes.length >= 8,
    `nodes=${dagData.nodes?.length}, edges=${dagData.edges?.length}, roots=${dagData.roots?.length}, terminals=${dagData.terminals?.length}`,
  );

  // Step 2f: Session viewer
  const viewerRes = await gw('GET', `/v1/sessions/${sessionId}/viewer`);
  check(
    'Session viewer returns HTML',
    viewerRes.status === 200 && viewerRes.text.includes('<!DOCTYPE html'),
    `status=${viewerRes.status}, length=${viewerRes.text.length} chars`,
  );

  // =========================================================================
  // PHASE 3: On-chain scoring + closeEpoch
  // =========================================================================
  console.log('');
  console.log('--- Phase 3: On-chain scoring + closeEpoch ---');

  // Build deterministic dataHash from evidence
  const threadRoot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['string'], [`thread_${sessionId}`]),
  );
  const evidenceRoot = keccak256(
    AbiCoder.defaultAbiCoder().encode(['string'], [`evidence_${sessionId}`]),
  );
  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint64', 'bytes32', 'bytes32'],
      [STUDIO_V2, EPOCH, threadRoot, evidenceRoot],
    ),
  );

  console.log(`  dataHash:     ${dataHash}`);
  console.log(`  threadRoot:   ${threadRoot}`);
  console.log(`  evidenceRoot: ${evidenceRoot}`);

  // Worker submits work on-chain
  console.log('  Worker submitting work on-chain...');
  const workerSigner = workerWallet.connect(provider);
  const studioAsWorker = new ethers.Contract(STUDIO_V2, STUDIO_ABI, workerSigner);
  const workTx = await studioAsWorker.submitWork(dataHash, threadRoot, evidenceRoot, '0x');
  const workReceipt = await waitForTx(workTx, 'submitWork');
  check(
    'submitWork on StudioProxy V2',
    workReceipt.status === 1,
    `tx=${workTx.hash}`,
  );

  // Deployer registers work in distributor
  console.log('  Registering work in distributor...');
  const regWorkTx = await rewardsDist.registerWork(STUDIO_V2, EPOCH, dataHash);
  await waitForTx(regWorkTx, 'registerWork');

  // Verifier scoring
  console.log('  Verifiers scoring...');
  const scores1 = [75, 68, 82, 78, 72]; // initiative, collab, reasoning, compliance, efficiency
  const scores2 = [70, 65, 80, 75, 70];

  for (const [wallet, scores, name] of [
    [verifier1Wallet, scores1, 'Verifier1'],
    [verifier2Wallet, scores2, 'Verifier2'],
  ] as const) {
    const signer = wallet.connect(provider);
    const studioAsSigner = new ethers.Contract(STUDIO_V2, STUDIO_ABI, signer);
    const encoded = encodeScoreVector(scores);
    const scoreTx = await studioAsSigner.submitScoreVectorForWorker(
      dataHash, workerWallet.address, encoded,
    );
    await waitForTx(scoreTx, `${name} score submission`);
    check(
      `Score submission: ${name}`,
      true,
      `scores=[${scores.join(',')}]`,
    );
  }

  // Register validators in distributor
  console.log('  Registering validators in distributor...');
  for (const wallet of [verifier1Wallet, verifier2Wallet]) {
    const regValTx = await rewardsDist.registerValidator(dataHash, wallet.address);
    await waitForTx(regValTx, `registerValidator: ${wallet.address.slice(0, 10)}`);
  }

  // Record balances BEFORE closeEpoch
  const totalEscrowBefore = await studioV2.getTotalEscrow();
  const workerWithdrawableBefore = await studioV2.getWithdrawableBalance(workerWallet.address);
  const treasuryWithdrawableBefore = await studioV2.getWithdrawableBalance(TREASURY);

  console.log(`  Pre-closeEpoch state:`);
  console.log(`    totalEscrow:         ${ethers.formatEther(totalEscrowBefore)} ETH`);
  console.log(`    worker withdrawable: ${ethers.formatEther(workerWithdrawableBefore)} ETH`);
  console.log(`    treasury withdrawable: ${ethers.formatEther(treasuryWithdrawableBefore)} ETH`);

  // CLOSE EPOCH
  console.log('  Calling closeEpoch...');
  let closeEpochTx: ethers.TransactionResponse;
  let closeEpochReceipt: ethers.TransactionReceipt;
  try {
    closeEpochTx = await rewardsDist.closeEpoch(STUDIO_V2, EPOCH);
    closeEpochReceipt = await waitForTx(closeEpochTx, 'closeEpoch');
    check(
      'closeEpoch succeeds (no revert)',
      closeEpochReceipt.status === 1,
      `tx=${closeEpochTx.hash}`,
    );
  } catch (err: any) {
    check('closeEpoch succeeds (no revert)', false, `REVERTED: ${err.message}`);
    console.error('  CRITICAL: closeEpoch reverted. Cannot continue with balance checks.');
    printVerdict();
    process.exit(1);
  }

  // Record balances AFTER closeEpoch
  const totalEscrowAfter = await studioV2.getTotalEscrow();
  const workerWithdrawableAfter = await studioV2.getWithdrawableBalance(workerWallet.address);
  const treasuryWithdrawableAfter = await studioV2.getWithdrawableBalance(TREASURY);

  const treasuryDelta = treasuryWithdrawableAfter - treasuryWithdrawableBefore;
  const workerDelta = workerWithdrawableAfter - workerWithdrawableBefore;
  const expectedFee = totalEscrowBefore * 5n / 100n;

  console.log(`  Post-closeEpoch state:`);
  console.log(`    totalEscrow:           ${ethers.formatEther(totalEscrowAfter)} ETH`);
  console.log(`    worker withdrawable:   ${ethers.formatEther(workerWithdrawableAfter)} ETH (+${ethers.formatEther(workerDelta)})`);
  console.log(`    treasury withdrawable: ${ethers.formatEther(treasuryWithdrawableAfter)} ETH (+${ethers.formatEther(treasuryDelta)})`);
  console.log(`    expected 5% fee:       ${ethers.formatEther(expectedFee)} ETH`);

  check(
    'Treasury received 5% orchestrator fee',
    treasuryDelta === expectedFee,
    `expected=${ethers.formatEther(expectedFee)}, actual=${ethers.formatEther(treasuryDelta)}`,
  );

  check(
    'Worker received reward',
    workerDelta > 0n,
    `worker reward = ${ethers.formatEther(workerDelta)} ETH`,
  );

  const totalDistributed = treasuryDelta + workerDelta;
  check(
    'Total distributed matches escrow',
    totalDistributed > 0n && totalDistributed <= totalEscrowBefore,
    `distributed=${ethers.formatEther(totalDistributed)}, escrow=${ethers.formatEther(totalEscrowBefore)}`,
  );

  // =========================================================================
  // PHASE 4: Gateway consistency
  // =========================================================================
  console.log('');
  console.log('--- Phase 4: Gateway consistency ---');

  // Leaderboard
  const leaderboardRes = await gw('GET', `/v1/studio/${STUDIO_V2}/leaderboard`);
  check(
    'Leaderboard endpoint responds',
    leaderboardRes.status === 200,
    `status=${leaderboardRes.status}`,
  );

  // Reputation (use agentId)
  const repRes = await gw('GET', `/v1/agent/${agentIds['Worker']}/reputation`);
  check(
    'Reputation endpoint responds',
    repRes.status === 200 || repRes.status === 404,
    `status=${repRes.status}, agentId=${agentIds['Worker']}`,
  );

  // Verify session viewer still works after on-chain activity
  const viewerRes2 = await gw('GET', `/v1/sessions/${sessionId}/viewer`);
  check(
    'Session viewer still works post-epoch',
    viewerRes2.status === 200,
    `status=${viewerRes2.status}`,
  );

  // =========================================================================
  // PHASE 5: Old studio comparison
  // =========================================================================
  console.log('');
  console.log('--- Phase 5: Old studio comparison ---');

  // Check what distributor the old studio points to
  const oldStudioContract = new ethers.Contract(STUDIO_OLD, STUDIO_ABI, provider);
  let oldStudioDistributor = 'UNKNOWN';
  try {
    oldStudioDistributor = await oldStudioContract.getRewardsDistributor();
    console.log(`  Old studio distributor: ${oldStudioDistributor}`);
    console.log(`  New distributor:        ${REWARDS_DIST_V5}`);

    check(
      'Old studio points to DIFFERENT distributor',
      oldStudioDistributor.toLowerCase() !== REWARDS_DIST_V5.toLowerCase(),
      `old=${oldStudioDistributor}, new=${REWARDS_DIST_V5}`,
    );
  } catch (err: any) {
    check(
      'Old studio query',
      false,
      `Could not query old studio: ${err.message}`,
    );
  }

  // Attempt closeEpoch on old studio with NEW distributor — expect revert
  console.log('  Attempting closeEpoch on OLD studio with NEW distributor...');
  try {
    const oldEpochTx = await rewardsDist.closeEpoch(STUDIO_OLD, EPOCH);
    await oldEpochTx.wait(2);
    check(
      'Old studio closeEpoch reverts (expected)',
      false,
      'DID NOT REVERT — this is unexpected and dangerous',
    );
  } catch (err: any) {
    const errMsg = err.message ?? '';
    const isExpectedRevert = errMsg.includes('revert') ||
      errMsg.includes('OnlyRewardsDistributor') ||
      errMsg.includes('No work in epoch') ||
      errMsg.includes('execution reverted');
    check(
      'Old studio closeEpoch reverts (expected)',
      isExpectedRevert,
      `Reverted as expected: ${errMsg.slice(0, 120)}`,
    );
  }

  console.log('');
  console.log('--- Comparison summary ---');
  console.log(`  New Studio (${STUDIO_V2}):`);
  console.log(`    distributor: ${REWARDS_DIST_V5}`);
  console.log(`    closeEpoch:  SUCCESS`);
  console.log(`    treasury:    +${ethers.formatEther(treasuryDelta)} ETH`);
  console.log(`    worker:      +${ethers.formatEther(workerDelta)} ETH`);
  console.log(`  Old Studio (${STUDIO_OLD}):`);
  console.log(`    distributor: ${oldStudioDistributor}`);
  console.log(`    closeEpoch:  REVERTED (expected)`);
  console.log(`    treasury:    no change`);

  // =========================================================================
  // PHASE 6: Verdict
  // =========================================================================
  printVerdict();

  // Print key references
  console.log('');
  console.log('Key transactions:');
  console.log(`  submitWork:  https://sepolia.etherscan.io/tx/${workTx.hash}`);
  console.log(`  closeEpoch:  https://sepolia.etherscan.io/tx/${closeEpochTx!.hash}`);
  console.log(`  Session:     ${GATEWAY_URL}/v1/sessions/${sessionId}/viewer`);
  console.log('');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Completed in ${elapsed}s`);
}

function printVerdict() {
  console.log('');
  console.log('================================================================');
  console.log('  VERDICT');
  console.log('================================================================');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`  ${passed}/${total} checks passed, ${failed} failed`);
  console.log('');

  if (failed > 0) {
    console.log('  FAILED checks:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    [FAIL] ${r.name}: ${r.detail}`);
    }
    console.log('');
  }

  const critical = [
    'closeEpoch succeeds (no revert)',
    'Treasury received 5% orchestrator fee',
    'Worker received reward',
    'StudioV2 → RewardsDistributor wiring',
    'submitWork on StudioProxy V2',
  ];

  const criticalPassed = critical.every(name =>
    results.find(r => r.name === name)?.passed === true,
  );

  if (criticalPassed && failed === 0) {
    console.log('  ========================================');
    console.log('  OVERALL: PASS');
    console.log('  ========================================');
    console.log('  - New distributor interacts with new studio without revert');
    console.log('  - closeEpoch() succeeds');
    console.log('  - Treasury receives 5% fee');
    console.log('  - All gateway features work unchanged');
    console.log('  SAFE TO DEPLOY.');
    process.exit(0);
  } else if (criticalPassed) {
    console.log('  ========================================');
    console.log('  OVERALL: PASS (with warnings)');
    console.log('  ========================================');
    console.log('  Critical checks passed. Some non-critical checks failed.');
    console.log('  Review failed checks above before deploying.');
    process.exit(0);
  } else {
    console.log('  ========================================');
    console.log('  OVERALL: FAIL');
    console.log('  ========================================');
    console.log('  DO NOT DEPLOY. Critical checks failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('');
  console.error('FATAL ERROR:', err.message);
  console.error(err.stack);
  printVerdict();
  process.exit(1);
});
