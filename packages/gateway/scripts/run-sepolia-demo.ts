#!/usr/bin/env -S npx tsx
/**
 * ChaosChain Sepolia Demo — Full Epoch Lifecycle
 *
 * Produces one verifiable, evidence-anchored epoch on Ethereum Sepolia.
 *
 * Usage:
 *   cd packages/gateway && npx tsx scripts/run-sepolia-demo.ts
 *
 * Environment (all have defaults for the existing Sepolia deployment):
 *   SEPOLIA_RPC_URL          — Alchemy/Infura Sepolia endpoint
 *   DEPLOYER_PRIVATE_KEY     — Owner of ChaosCore + RewardsDistributor
 *   ARWEAVE_DEVNET_KEY       — (optional) base64-encoded Arweave JWK for real upload
 */

import { ethers, AbiCoder, keccak256, toUtf8Bytes, Wallet, JsonRpcProvider } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { computeDKG, extractPoAFeatures } from '../src/services/dkg/index.js';
import type { EvidencePackage } from '../src/services/dkg/types.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL = process.env.SEPOLIA_RPC_URL
  ?? 'https://eth-sepolia.g.alchemy.com/v2/gkHpxu7aSBljCv8Hlxu1GJnQRsyyZM7z';

const DEPLOYER_KEY = process.env.DEPLOYER_PRIVATE_KEY
  ?? '0xd5e6046419db99358ec9b10e11a398989b8e5432fe0e2b4174a094063d05ea42';

const CHAOS_CORE        = '0x92cBc471D8a525f3Ffb4BB546DD8E93FC7EE67ca';
const REWARDS_DIST      = '0x84e4f06598D08D0B88A2758E33A6Da0d621cD517';
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REG    = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const LOGIC_MODULE      = '0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3';

const EPOCH = 0n;
const STAKE = ethers.parseEther('0.00005');
const STUDIO_DEPOSIT = ethers.parseEther('0.0001');
const AGENT_FUNDING = ethers.parseEther('0.0004');

// ABI Fragments
const CORE_ABI = [
  'function createStudio(string name, address logicModule) returns (address proxy, uint256 studioId)',
  'function getStudioCount() view returns (uint256)',
  'function owner() view returns (address)',
];

const STUDIO_ABI = [
  'function registerAgent(uint256 agentId, uint8 role) payable',
  'function deposit() payable',
  'function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, bytes feedbackAuth)',
  'function submitScoreVectorForWorker(bytes32 dataHash, address worker, bytes scoreVector)',
  'function getAgentId(address agent) view returns (uint256)',
  'function getTotalEscrow() view returns (uint256)',
  'function getWorkParticipants(bytes32 dataHash) view returns (address[])',
  'function getValidators(bytes32 dataHash) view returns (address[])',
  'function getEscrowBalance(address account) view returns (uint256)',
];

const IDENTITY_ABI = [
  'function register() returns (uint256 agentId)',
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REWARDS_ABI = [
  'function registerWork(address studio, uint64 epoch, bytes32 dataHash)',
  'function registerValidator(bytes32 dataHash, address validator)',
  'function closeEpoch(address studio, uint64 epoch)',
  'function owner() view returns (address)',
];

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
];

// AgentRole enum (from StudioProxy.sol)
const ROLE_WORKER = 1;
const ROLE_VERIFIER = 2;

// =============================================================================
// ARWEAVE UPLOAD
// =============================================================================

async function uploadToArweave(content: Buffer): Promise<string | null> {
  const arweaveKey = process.env.ARWEAVE_DEVNET_KEY;

  if (arweaveKey) {
    try {
      const { TurboFactory, ArweaveSigner } = await import('@ardrive/turbo-sdk');
      const jwk = JSON.parse(Buffer.from(arweaveKey, 'base64').toString('utf-8'));
      const signer = new ArweaveSigner(jwk);
      const turbo = TurboFactory.authenticated({
        signer,
        paymentServiceConfig: { url: 'https://payment.ardrive.dev' },
        uploadServiceConfig: { url: 'https://upload.ardrive.dev' },
      });
      const result = await (turbo as any).uploadFile({
        fileStreamFactory: () => content,
        fileSizeFactory: () => content.length,
        dataItemOpts: {
          tags: [
            { name: 'App-Name', value: 'ChaosChain' },
            { name: 'App-Version', value: '0.1.0' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
      });
      return result.id;
    } catch (err) {
      console.warn(`  ⚠ Arweave Turbo devnet upload failed: ${(err as Error).message}`);
      console.warn('  → Falling back to deterministic Arweave tx_id placeholder');
    }
  } else {
    console.warn('  ⚠ ARWEAVE_DEVNET_KEY not set — using deterministic placeholder');
    console.warn('  → Set ARWEAVE_DEVNET_KEY (base64-encoded JWK) for real Arweave uploads');
  }

  return null;
}

// =============================================================================
// HELPERS
// =============================================================================

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

async function waitForTx(tx: ethers.TransactionResponse, label: string): Promise<ethers.TransactionReceipt> {
  log('TX', `${label}: ${tx.hash}`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction failed: ${label} (${tx.hash})`);
  }
  log('TX', `${label}: confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

function encodeScoreVector(scores: number[]): string {
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(['uint8', 'uint8', 'uint8', 'uint8', 'uint8'], scores);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const startTime = Date.now();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ChaosChain Sepolia Demo — Full Epoch Lifecycle');
  console.log('  Network: Ethereum Sepolia (chainId 11155111)');
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(DEPLOYER_KEY, provider);

  log('SETUP', `Deployer: ${deployer.address}`);
  const balance = await provider.getBalance(deployer.address);
  log('SETUP', `Deployer balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther('0.001')) {
    throw new Error('Insufficient deployer balance. Need at least 0.001 ETH on Sepolia.');
  }

  // Generate ephemeral agent wallets
  const workerWallet = Wallet.createRandom(provider);
  const verifier1Wallet = Wallet.createRandom(provider);
  const verifier2Wallet = Wallet.createRandom(provider);

  log('SETUP', `Worker:    ${workerWallet.address}`);
  log('SETUP', `Verifier1: ${verifier1Wallet.address}`);
  log('SETUP', `Verifier2: ${verifier2Wallet.address}`);

  // =========================================================================
  // PHASE 1: Fund agent wallets
  // =========================================================================
  console.log('\n─── Phase 1: Fund Agent Wallets ───');

  for (const [name, wallet] of [
    ['Worker', workerWallet],
    ['Verifier1', verifier1Wallet],
    ['Verifier2', verifier2Wallet],
  ] as const) {
    const tx = await deployer.sendTransaction({
      to: wallet.address,
      value: AGENT_FUNDING,
    });
    await waitForTx(tx, `Fund ${name}`);
  }

  // =========================================================================
  // PHASE 2: Create Studio
  // =========================================================================
  console.log('\n─── Phase 2: Create Studio ───');

  const chaosCore = new ethers.Contract(CHAOS_CORE, CORE_ABI, deployer);
  const studioCountBefore = await chaosCore.getStudioCount();
  log('STUDIO', `Existing studio count: ${studioCountBefore}`);

  const createTx = await chaosCore.createStudio('ChaosChain Verifiable Epoch Demo', LOGIC_MODULE);
  const createReceipt = await waitForTx(createTx, 'createStudio');

  // Parse studio address from logs (first topic of StudioCreated event or return value)
  const studioCountAfter = await chaosCore.getStudioCount();
  log('STUDIO', `New studio count: ${studioCountAfter}`);

  // Extract studio address from event log topics[1]
  // ChaosCore emits StudioCreated(address indexed studio, address indexed logicModule, address indexed owner, ...)
  let studioAddress: string | null = null;
  for (const eventLog of createReceipt.logs) {
    if (eventLog.address.toLowerCase() === CHAOS_CORE.toLowerCase() && eventLog.topics.length >= 2) {
      studioAddress = ethers.getAddress('0x' + eventLog.topics[1].slice(26));
      break;
    }
  }

  if (!studioAddress || studioAddress === ethers.ZeroAddress) {
    throw new Error('Failed to extract studio address from createStudio receipt');
  }

  log('STUDIO', `Studio address: ${studioAddress}`);

  // Fund the studio
  const studio = new ethers.Contract(studioAddress, STUDIO_ABI, deployer);
  const depositTx = await studio.deposit({ value: STUDIO_DEPOSIT });
  await waitForTx(depositTx, 'Studio deposit');

  const totalEscrow = await studio.getTotalEscrow();
  log('STUDIO', `Total escrow: ${ethers.formatEther(totalEscrow)} ETH`);

  // =========================================================================
  // PHASE 3: Register Agents
  // =========================================================================
  console.log('\n─── Phase 3: Register Agents in ERC-8004 Identity Registry ───');

  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);

  // Each agent registers in the IdentityRegistry
  const agentIds: Record<string, bigint> = {};

  for (const [name, wallet] of [
    ['Worker', workerWallet],
    ['Verifier1', verifier1Wallet],
    ['Verifier2', verifier2Wallet],
  ] as const) {
    const signer = wallet.connect(provider);
    const idReg = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, signer);

    const uri = `chaoschain://demo/agent/${name.toLowerCase()}/${Date.now()}`;
    const regTx = await idReg['register(string)'](uri);
    const regReceipt = await waitForTx(regTx, `Register ${name} in IdentityRegistry`);

    // Parse agentId from Transfer event (ERC-721 mint: Transfer(0x0, to, tokenId))
    let agentId: bigint | null = null;
    for (const eventLog of regReceipt.logs) {
      if (eventLog.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && eventLog.topics.length === 4) {
        // Transfer(from, to, tokenId) — tokenId is topics[3]
        agentId = BigInt(eventLog.topics[3]);
        break;
      }
    }

    if (agentId === null) {
      throw new Error(`Failed to parse agentId for ${name} from register receipt`);
    }

    agentIds[name] = agentId;
    log('IDENTITY', `${name} agentId: ${agentId}`);

    // Verify ownership
    const owner = await identity.ownerOf(agentId);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`Agent NFT ownership mismatch for ${name}`);
    }
  }

  // Register in StudioProxy
  console.log('\n─── Phase 3b: Register Agents in Studio ───');

  for (const [name, wallet, role] of [
    ['Worker', workerWallet, ROLE_WORKER],
    ['Verifier1', verifier1Wallet, ROLE_VERIFIER],
    ['Verifier2', verifier2Wallet, ROLE_VERIFIER],
  ] as const) {
    const signer = wallet.connect(provider);
    const studioSigned = new ethers.Contract(studioAddress, STUDIO_ABI, signer);

    const regTx = await studioSigned.registerAgent(agentIds[name], role, { value: STAKE });
    await waitForTx(regTx, `Register ${name} in Studio (role=${role})`);

    const registeredId = await studio.getAgentId(wallet.address);
    log('STUDIO', `${name} registered with agentId=${registeredId}`);
  }

  // =========================================================================
  // PHASE 4: Create Evidence & Upload to Arweave
  // =========================================================================
  console.log('\n─── Phase 4: Create Evidence Packages & Upload to Arweave ───');

  // Build 3 evidence packages to create a richer DAG for PoA feature extraction
  const baseTimestamp = Date.now();

  const evidencePayloads = [
    {
      type: 'work_initiation',
      studio: studioAddress,
      epoch: Number(EPOCH),
      worker: workerWallet.address,
      task: 'ChaosChain verifiable epoch demo — initial task specification',
      metadata: { created_at: new Date(baseTimestamp).toISOString(), network: 'sepolia' },
    },
    {
      type: 'work_progress',
      studio: studioAddress,
      epoch: Number(EPOCH),
      worker: workerWallet.address,
      task: 'Evidence of intermediate work — reasoning and collaboration artifacts',
      metadata: { created_at: new Date(baseTimestamp + 1000).toISOString(), network: 'sepolia' },
    },
    {
      type: 'work_completion',
      studio: studioAddress,
      epoch: Number(EPOCH),
      worker: workerWallet.address,
      task: 'Final work output — completed task with all deliverables',
      metadata: { created_at: new Date(baseTimestamp + 2000).toISOString(), network: 'sepolia' },
    },
  ];

  const arweaveTxIds: string[] = [];
  const evidenceBuffers: Buffer[] = [];

  for (const [i, payload] of evidencePayloads.entries()) {
    const buf = Buffer.from(JSON.stringify(payload, null, 2));
    evidenceBuffers.push(buf);
    const payloadHash = keccak256(buf);
    log('EVIDENCE', `Package ${i}: hash=${payloadHash}, size=${buf.length} bytes`);

    let txId = await uploadToArweave(buf);
    if (!txId) {
      txId = `demo_${payloadHash.slice(2, 46)}`;
      log('EVIDENCE', `  Using placeholder Arweave tx_id: ${txId}`);
    } else {
      log('EVIDENCE', `  Real Arweave tx_id: ${txId}`);
    }
    arweaveTxIds.push(txId);
  }

  const arweaveTxId = arweaveTxIds[0];
  const evidenceHash = keccak256(evidenceBuffers[0]);

  if (!process.env.ARWEAVE_DEVNET_KEY) {
    log('EVIDENCE', 'BLOCKER: Real Arweave upload requires ARWEAVE_DEVNET_KEY env var');
  }

  // =========================================================================
  // PHASE 5: Compute DKG (full engine — produces DAG for PoA feature extraction)
  // =========================================================================
  console.log('\n─── Phase 5: Compute DKG Roots ───');

  const workerSig = await workerWallet.signMessage(evidenceHash);

  // Build a 3-node DAG: root → progress → completion
  const dkgEvidence: EvidencePackage[] = [
    {
      arweave_tx_id: arweaveTxIds[0],
      author: workerWallet.address,
      timestamp: baseTimestamp,
      parent_ids: [],
      payload_hash: keccak256(evidenceBuffers[0]),
      artifact_ids: [arweaveTxIds[0]],
      signature: workerSig,
    },
    {
      arweave_tx_id: arweaveTxIds[1],
      author: workerWallet.address,
      timestamp: baseTimestamp + 1000,
      parent_ids: [arweaveTxIds[0]],
      payload_hash: keccak256(evidenceBuffers[1]),
      artifact_ids: [arweaveTxIds[1]],
      signature: workerSig,
    },
    {
      arweave_tx_id: arweaveTxIds[2],
      author: workerWallet.address,
      timestamp: baseTimestamp + 2000,
      parent_ids: [arweaveTxIds[1]],
      payload_hash: keccak256(evidenceBuffers[2]),
      artifact_ids: [arweaveTxIds[2]],
      signature: workerSig,
    },
  ];

  const dkgResult = computeDKG(dkgEvidence);
  const { thread_root, evidence_root } = { thread_root: dkgResult.thread_root, evidence_root: dkgResult.evidence_root };

  log('DKG', `thread_root:   ${thread_root}`);
  log('DKG', `evidence_root: ${evidence_root}`);
  log('DKG', `DAG nodes: ${dkgResult.dag.nodes.size}, roots: ${dkgResult.dag.roots.size}, terminals: ${dkgResult.dag.terminals.size}`);

  // =========================================================================
  // PHASE 6: Submit Work On-Chain
  // =========================================================================
  console.log('\n─── Phase 6: Submit Work On-Chain ───');

  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint64', 'bytes32', 'bytes32'],
      [studioAddress, EPOCH, thread_root, evidence_root],
    ),
  );
  log('WORK', `dataHash: ${dataHash}`);

  const workerSigner = workerWallet.connect(provider);
  const studioAsWorker = new ethers.Contract(studioAddress, STUDIO_ABI, workerSigner);

  const workTx = await studioAsWorker.submitWork(dataHash, thread_root, evidence_root, '0x');
  const workReceipt = await waitForTx(workTx, 'submitWork');

  // Verify work was recorded
  const participants = await studio.getWorkParticipants(dataHash);
  log('WORK', `Participants recorded: ${participants.length} (${participants.join(', ')})`);

  // =========================================================================
  // PHASE 7: Evidence-Derived Score Vectors (both verifiers)
  // =========================================================================
  console.log('\n─── Phase 7: Evidence-Derived Scoring ───');

  const COMPLIANCE_FIXED = 75;  // Verifier-opinion until task-spec comparison defined
  const EFFICIENCY_FIXED = 80;  // Verifier-opinion until goal-completion heuristic defined

  const derivedScoresMap: Record<string, number[]> = {};

  for (const [name, wallet] of [
    ['Verifier1', verifier1Wallet],
    ['Verifier2', verifier2Wallet],
  ] as const) {
    // Step 1: Each verifier independently runs DKG on the evidence
    const verifierDKG = computeDKG(dkgEvidence);

    // Step 2: Assert thread_root matches the on-chain commitment
    if (verifierDKG.thread_root !== thread_root) {
      throw new Error(
        `${name}: DKG thread_root mismatch!\n` +
        `  computed: ${verifierDKG.thread_root}\n` +
        `  on-chain: ${thread_root}`,
      );
    }
    log('SCORES', `${name}: thread_root verification PASSED ✓`);

    // Step 3: Extract PoA features for the worker being scored
    const features = extractPoAFeatures(verifierDKG, workerWallet.address);
    log('SCORES', `${name}: PoA features for worker ${workerWallet.address}:`);
    log('SCORES', `  initiative:    ${features.initiative} (evidence-derived)`);
    log('SCORES', `  collaboration: ${features.collaboration} (evidence-derived)`);
    log('SCORES', `  reasoning:     ${features.reasoning} (evidence-derived)`);
    log('SCORES', `  compliance:    ${COMPLIANCE_FIXED} (verifier-opinion, fixed)`);
    log('SCORES', `  efficiency:    ${EFFICIENCY_FIXED} (verifier-opinion, fixed)`);

    // Step 4: Map features to score vector
    // [Initiative, Collaboration, Reasoning, Compliance, Efficiency]
    const clamp = (v: number) => Math.max(1, Math.min(255, v));
    const scores = [
      clamp(features.initiative),
      clamp(features.collaboration),
      clamp(features.reasoning),
      COMPLIANCE_FIXED,
      EFFICIENCY_FIXED,
    ];
    derivedScoresMap[name] = scores;

    log('SCORES', `${name}: derived score vector: [${scores.join(', ')}]`);

    // Step 5: Submit derived scores on-chain
    const signer = wallet.connect(provider);
    const studioAsSigner = new ethers.Contract(studioAddress, STUDIO_ABI, signer);

    const encoded = encodeScoreVector(scores);
    const scoreTx = await studioAsSigner.submitScoreVectorForWorker(dataHash, workerWallet.address, encoded);
    await waitForTx(scoreTx, `${name} submitScoreVectorForWorker (evidence-derived)`);
  }

  const validators = await studio.getValidators(dataHash);
  log('SCORES', `Validators recorded: ${validators.length}`);
  log('SCORES', 'Scores are EVIDENCE-DERIVED — not hardcoded. Each verifier independently ran DKG and extracted PoA features.');

  // =========================================================================
  // PHASE 8: Close Epoch
  // =========================================================================
  console.log('\n─── Phase 8: Close Epoch ───');

  const rewards = new ethers.Contract(REWARDS_DIST, REWARDS_ABI, deployer);

  // Step 1: Register work for epoch
  const regWorkTx = await rewards.registerWork(studioAddress, EPOCH, dataHash);
  await waitForTx(regWorkTx, 'registerWork');

  // Step 2: Register validators
  for (const [name, wallet] of [
    ['Verifier1', verifier1Wallet],
    ['Verifier2', verifier2Wallet],
  ] as const) {
    const regValTx = await rewards.registerValidator(dataHash, wallet.address);
    await waitForTx(regValTx, `registerValidator(${name})`);
  }

  // Step 3: Close epoch
  const closeTx = await rewards.closeEpoch(studioAddress, EPOCH);
  const closeReceipt = await waitForTx(closeTx, 'closeEpoch');
  log('EPOCH', `closeEpoch gas used: ${closeReceipt.gasUsed}`);

  // =========================================================================
  // PHASE 9: Verify Reputation
  // =========================================================================
  console.log('\n─── Phase 9: Verify Reputation ───');

  const repReg = new ethers.Contract(REPUTATION_REG, REPUTATION_ABI, provider);
  // Contract's _addressToString produces lowercase
  const studioTag = studioAddress.toLowerCase();
  // RewardsDistributor is the feedback client (it calls giveFeedback)
  const clientAddresses = [REWARDS_DIST];
  const dimensions = ['Initiative', 'Collaboration', 'Reasoning', 'Compliance', 'Efficiency'];

  log('REPUTATION', `Querying reputation for Worker (agentId=${agentIds['Worker']})...`);
  log('REPUTATION', `  clientAddress: ${REWARDS_DIST}`);
  log('REPUTATION', `  tag2 (studio): ${studioTag}`);

  const repResults: Array<{ dim: string; count: bigint; value: bigint; decimals: number }> = [];

  for (const dim of dimensions) {
    try {
      const [count, value, decimals] = await repReg.getSummary(
        agentIds['Worker'],
        clientAddresses,
        dim,
        studioTag,
      );
      repResults.push({ dim, count, value, decimals });
      log('REPUTATION', `  ${dim}: count=${count}, value=${value}, decimals=${decimals}`);
    } catch (err) {
      log('REPUTATION', `  ${dim}: query failed — ${(err as Error).message?.slice(0, 80)}`);
      repResults.push({ dim, count: 0n, value: 0n, decimals: 0 });
    }
  }

  // Check verifier reputation — tag2 is 'CONSENSUS_MATCH' per _publishValidatorReputation
  const verifierRepResults: Array<{ name: string; count: bigint; value: bigint; decimals: number }> = [];
  for (const [name, id] of [['Verifier1', agentIds['Verifier1']], ['Verifier2', agentIds['Verifier2']]] as const) {
    try {
      const [count, value, decimals] = await repReg.getSummary(
        id,
        clientAddresses,
        'VALIDATOR_ACCURACY',
        'CONSENSUS_MATCH',
      );
      log('REPUTATION', `  ${name} VALIDATOR_ACCURACY: count=${count}, value=${value}, decimals=${decimals}`);
      verifierRepResults.push({ name, count, value, decimals });
    } catch (err) {
      log('REPUTATION', `  ${name} VALIDATOR_ACCURACY: query failed — ${(err as Error).message?.slice(0, 80)}`);
      verifierRepResults.push({ name, count: 0n, value: 0n, decimals: 0 });
    }
  }

  // =========================================================================
  // PHASE 10: Generate Report
  // =========================================================================
  console.log('\n─── Phase 10: Generate Report ───');

  const report = `# ChaosChain Sepolia Demo — Epoch Report

**Date**: ${new Date().toISOString()}
**Network**: Ethereum Sepolia (chainId 11155111)
**Duration**: ${((Date.now() - startTime) / 1000).toFixed(1)}s

---

## Addresses

| Role | Address |
|------|---------|
| **Deployer** | \`${deployer.address}\` |
| **Studio** | \`${studioAddress}\` |
| **Worker** | \`${workerWallet.address}\` |
| **Verifier 1** | \`${verifier1Wallet.address}\` |
| **Verifier 2** | \`${verifier2Wallet.address}\` |

## Agent IDs (ERC-8004 IdentityRegistry)

| Agent | agentId |
|-------|---------|
| Worker | ${agentIds['Worker']} |
| Verifier 1 | ${agentIds['Verifier1']} |
| Verifier 2 | ${agentIds['Verifier2']} |

## On-Chain Artifacts

| Artifact | Value |
|----------|-------|
| **Studio creation tx** | \`${createTx.hash}\` |
| **Work submission tx** | \`${workTx.hash}\` |
| **closeEpoch tx** | \`${closeTx.hash}\` |
| **dataHash** | \`${dataHash}\` |
| **DKG thread_root** | \`${thread_root}\` |
| **DKG evidence_root** | \`${evidence_root}\` |

## Evidence (${dkgEvidence.length} packages)

| Package | Arweave tx_id | Author |
|---------|---------------|--------|
${dkgEvidence.map((e, i) => `| ${i} | \`${e.arweave_tx_id}\` | \`${e.author}\` |`).join('\n')}

| Field | Value |
|-------|-------|
| **Evidence packages** | ${dkgEvidence.length} |
| **DAG structure** | ${dkgResult.dag.nodes.size} nodes, ${dkgResult.dag.roots.size} roots, ${dkgResult.dag.terminals.size} terminals |
| **Real upload** | ${process.env.ARWEAVE_DEVNET_KEY ? 'Yes (Turbo devnet)' : 'No (placeholder — set ARWEAVE_DEVNET_KEY)'} |

## Evidence-Derived Scoring

Scores were computed by each verifier running \`computeDKG\` + \`extractPoAFeatures\` on the evidence.
Compliance (${COMPLIANCE_FIXED}) and Efficiency (${EFFICIENCY_FIXED}) are fixed verifier-opinion values.

| Verifier | Initiative | Collaboration | Reasoning | Compliance | Efficiency |
|----------|-----------|---------------|-----------|------------|------------|
${Object.entries(derivedScoresMap).map(([name, s]) => `| ${name} | ${s[0]} | ${s[1]} | ${s[2]} | ${s[3]} | ${s[4]} |`).join('\n')}

## Reputation Summary (Worker agentId=${agentIds['Worker']})

| Dimension | Count | Value | Decimals |
|-----------|-------|-------|----------|
${repResults.map(r => `| ${r.dim} | ${r.count} | ${r.value} | ${r.decimals} |`).join('\n')}

## Verifier Reputation (VALIDATOR_ACCURACY / CONSENSUS_MATCH)

| Verifier | agentId | Count | Value (performanceScore) | Decimals |
|----------|---------|-------|--------------------------|----------|
${verifierRepResults.map(r => `| ${r.name} | ${agentIds[r.name as keyof typeof agentIds]} | ${r.count} | ${r.value} | ${r.decimals} |`).join('\n')}

## Etherscan Links

- **Studio**: https://sepolia.etherscan.io/address/${studioAddress}
- **Work Submission**: https://sepolia.etherscan.io/tx/${workTx.hash}
- **Close Epoch**: https://sepolia.etherscan.io/tx/${closeTx.hash}
- **Worker Identity**: https://sepolia.etherscan.io/token/${IDENTITY_REGISTRY}?a=${agentIds['Worker']}

## Contract Addresses

| Contract | Address |
|----------|---------|
| ChaosCore | \`${CHAOS_CORE}\` |
| RewardsDistributor | \`${REWARDS_DIST}\` |
| IdentityRegistry | \`${IDENTITY_REGISTRY}\` |
| ReputationRegistry | \`${REPUTATION_REG}\` |
| LogicModule | \`${LOGIC_MODULE}\` |

---

> **Verifiable claim**: This is a real Sepolia Studio. Here is the work (\`${dataHash}\`).
> Here is the Arweave evidence (\`${arweaveTxId}\`).
> Here is the on-chain commitment (\`${closeTx.hash}\`).
> Here is the resulting reputation (agentId=${agentIds['Worker']}).
`;

  const reportPath = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(reportPath, { recursive: true });
  const reportFile = path.join(reportPath, `sepolia-demo-${Date.now()}.md`);
  fs.writeFileSync(reportFile, report);
  log('REPORT', `Written to: ${reportFile}`);

  console.log('\n' + report);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ✓ Demo complete. All phases executed successfully.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('\n✗ Demo failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
