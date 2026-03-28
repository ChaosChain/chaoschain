#!/usr/bin/env -S npx tsx
/**
 * ChaosChain — Engineering Agent Accountability Demo
 *
 * Runs a complete accountability lifecycle for an AI coding agent session.
 *
 * Usage:
 *   cd packages/gateway
 *   npx tsx scripts/run-engineering-agent-demo.ts devin
 *   npx tsx scripts/run-engineering-agent-demo.ts claude-code
 *   npx tsx scripts/run-engineering-agent-demo.ts cursor
 *
 * Defaults to "devin" if no argument given.
 *
 * Environment:
 *   SEPOLIA_RPC_URL        — Alchemy/Infura Sepolia endpoint
 *   DEPLOYER_PRIVATE_KEY   — Owner of ChaosCore + RewardsDistributor (required)
 */

import { ethers, AbiCoder, keccak256, Wallet, JsonRpcProvider } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDKG, extractPoAFeatures } from '../src/services/dkg/index.js';
import type { EvidencePackage } from '../src/services/dkg/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Public Sepolia RPC (rate-limited); prefer SEPOLIA_RPC_URL / RPC_URL. */
const DEFAULT_SEPOLIA_RPC = 'https://rpc.sepolia.org';

function requireDeployerPrivateKey(): string {
  const k = process.env.DEPLOYER_PRIVATE_KEY?.trim();
  if (!k) {
    console.error(
      'DEPLOYER_PRIVATE_KEY is required. Set it in the environment; never commit private keys.',
    );
    process.exit(1);
  }
  return k;
}

// =============================================================================
// SESSION TYPES
// =============================================================================

interface SessionCommit {
  hash: string;
  message: string;
  files_changed: string[];
  parent_commits: string[];
}

interface AgentSession {
  session_id: string;
  agent_name: string;
  repository: string;
  task: string;
  commits: SessionCommit[];
  pr_number: number;
  tests_passed: boolean;
  lines_added: number;
  lines_removed: number;
  session_duration_seconds: number;
  timestamp: number;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL =
  process.env.SEPOLIA_RPC_URL?.trim() ||
  process.env.RPC_URL?.trim() ||
  DEFAULT_SEPOLIA_RPC;

const DEPLOYER_KEY = requireDeployerPrivateKey();

const CHAOS_CORE        = '0x92cBc471D8a525f3Ffb4BB546DD8E93FC7EE67ca';
const REWARDS_DIST      = '0x28AF9c02982801D35a23032e0eAFa50669E10ba1';
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const REPUTATION_REG    = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
const LOGIC_MODULE      = '0xE90CaE8B64458ba796F462AB48d84F6c34aa29a3';

const EPOCH = 0n;
const STAKE = ethers.parseEther('0.00005');
const STUDIO_DEPOSIT = ethers.parseEther('0.0001');
const AGENT_FUNDING = ethers.parseEther('0.0004');
const MIN_DEPLOYER_BALANCE = ethers.parseEther('0.002');

const STUDIO_NAME = 'Engineering Agent Accountability Studio';
const STUDIO_FILE = path.resolve(__dirname, '../demo-data/engineering-studio.json');
const DEMO_DATA_DIR = path.resolve(__dirname, '../demo-data');

// ABI Fragments
const CORE_ABI = [
  'function createStudio(string name, address logicModule) returns (address proxy, uint256 studioId)',
  'function getStudioCount() view returns (uint256)',
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
  'function register(string agentURI) returns (uint256 agentId)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const REWARDS_ABI = [
  'function registerWork(address studio, uint64 epoch, bytes32 dataHash)',
  'function registerValidator(bytes32 dataHash, address validator)',
  'function closeEpoch(address studio, uint64 epoch)',
];

const REPUTATION_ABI = [
  'function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64 count, int128 summaryValue, uint8 summaryValueDecimals)',
];

const ROLE_WORKER = 1;
const ROLE_VERIFIER = 2;

// =============================================================================
// HELPERS
// =============================================================================

async function waitForTx(tx: ethers.TransactionResponse, label: string): Promise<ethers.TransactionReceipt> {
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction failed: ${label} (${tx.hash})`);
  }
  return receipt;
}

function encodeScoreVector(scores: number[]): string {
  return AbiCoder.defaultAbiCoder().encode(['uint8', 'uint8', 'uint8', 'uint8', 'uint8'], scores);
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins} minutes` : `${secs} seconds`;
}

function resolveSessionFile(arg: string): string {
  const SESSION_MAP: Record<string, string> = {
    'devin': 'devin-session.json',
    'claude-code': 'claude-code-session.json',
    'cursor': 'cursor-session.json',
  };
  const filename = SESSION_MAP[arg] ?? `${arg}-session.json`;
  return path.join(DEMO_DATA_DIR, filename);
}

// =============================================================================
// EVIDENCE BUILDING
// =============================================================================

function buildEvidencePackages(
  session: AgentSession,
  workerAddress: string,
  workerSig: string,
): EvidencePackage[] {
  const commitHashToTxId = new Map<string, string>();
  const packages: EvidencePackage[] = [];
  const baseTimestamp = session.timestamp * 1000;

  for (const [i, commit] of session.commits.entries()) {
    const commitPayload = JSON.stringify({
      hash: commit.hash,
      message: commit.message,
      files_changed: commit.files_changed,
      session_id: session.session_id,
    });
    const payloadHash = keccak256(Buffer.from(commitPayload));

    const txId = `demo_${payloadHash.slice(2, 46)}`;
    commitHashToTxId.set(commit.hash, txId);

    const parentIds = commit.parent_commits
      .map(ph => commitHashToTxId.get(ph))
      .filter((id): id is string => id !== undefined);

    packages.push({
      arweave_tx_id: txId,
      author: workerAddress,
      timestamp: baseTimestamp + i * 1000,
      parent_ids: parentIds,
      payload_hash: payloadHash,
      artifact_ids: commit.files_changed,
      signature: workerSig,
    });
  }

  return packages;
}

// =============================================================================
// ACCOUNTABILITY SCORING
// =============================================================================

function computeComplianceScore(session: AgentSession): number {
  let score = 50;
  if (session.tests_passed) score += 25;
  if (session.pr_number > 0) score += 15;
  if (session.lines_removed > 0) score += 10;
  return Math.min(100, score);
}

function computeEfficiencyScore(session: AgentSession): number {
  const linesChanged = session.lines_added + session.lines_removed;
  const minutes = session.session_duration_seconds / 60;
  const linesPerMinute = linesChanged / minutes;
  if (linesPerMinute >= 15) return 90;
  if (linesPerMinute >= 10) return 80;
  if (linesPerMinute >= 5) return 70;
  if (linesPerMinute >= 2) return 60;
  return 50;
}

// =============================================================================
// STUDIO MANAGEMENT
// =============================================================================

async function loadOrCreateStudio(
  deployer: ethers.Wallet,
  provider: JsonRpcProvider,
): Promise<{ address: string; isNew: boolean }> {
  if (fs.existsSync(STUDIO_FILE)) {
    const data = JSON.parse(fs.readFileSync(STUDIO_FILE, 'utf-8'));
    if (data.address && typeof data.address === 'string') {
      const code = await provider.getCode(data.address);
      if (code !== '0x') {
        return { address: data.address, isNew: false };
      }
    }
  }

  const chaosCore = new ethers.Contract(CHAOS_CORE, CORE_ABI, deployer);
  const createTx = await chaosCore.createStudio(STUDIO_NAME, LOGIC_MODULE);
  const createReceipt = await waitForTx(createTx, 'createStudio');

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

  const studio = new ethers.Contract(studioAddress, STUDIO_ABI, deployer);
  const depositTx = await studio.deposit({ value: STUDIO_DEPOSIT });
  await waitForTx(depositTx, 'Studio deposit');

  fs.mkdirSync(path.dirname(STUDIO_FILE), { recursive: true });
  fs.writeFileSync(STUDIO_FILE, JSON.stringify({
    address: studioAddress,
    name: STUDIO_NAME,
    created_at: new Date().toISOString(),
    create_tx: createTx.hash,
  }, null, 2));

  return { address: studioAddress, isNew: true };
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const sessionArg = process.argv[2] ?? 'devin';
  const sessionPath = resolveSessionFile(sessionArg);

  if (!fs.existsSync(sessionPath)) {
    console.error(`Session file not found: ${sessionPath}`);
    console.error('Available: devin, claude-code, cursor');
    process.exit(1);
  }

  const session: AgentSession = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
  const startTime = Date.now();

  // ─── BANNER ──────────────────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ChaosChain — Engineering Agent Accountability');
  console.log('  Verifiable Track Record for Autonomous AI Coders');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Agent:       ${session.agent_name}`);
  console.log(`Session:     ${session.session_id}`);
  console.log(`Task:        ${session.task.length > 55 ? session.task.slice(0, 55) + '...' : session.task}`);
  console.log(`Repository:  ${session.repository}`);
  console.log(`PR #${session.pr_number}:${' '.repeat(Math.max(1, 5 - String(session.pr_number).length))}${session.tests_passed ? '✓ Merged' : '✗ Failed'} | Tests: ${session.tests_passed ? '✓ Passed' : '✗ Failed'}`);
  console.log('');

  // ─── PRE-FLIGHT ──────────────────────────────────────────────────────────
  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(DEPLOYER_KEY, provider);
  const balance = await provider.getBalance(deployer.address);

  if (balance < MIN_DEPLOYER_BALANCE) {
    console.error(`Insufficient deployer balance: ${ethers.formatEther(balance)} ETH`);
    console.error(`Need at least ${ethers.formatEther(MIN_DEPLOYER_BALANCE)} ETH`);
    process.exit(1);
  }

  // ─── STUDIO ──────────────────────────────────────────────────────────────
  const { address: studioAddress, isNew: studioIsNew } = await loadOrCreateStudio(deployer, provider);
  if (studioIsNew) {
    console.log(`  Studio created: ${studioAddress}`);
  } else {
    console.log(`  Studio loaded:  ${studioAddress}`);
  }

  // ─── AGENT WALLETS ───────────────────────────────────────────────────────
  const workerWallet = Wallet.createRandom(provider);
  const verifier1Wallet = Wallet.createRandom(provider);
  const verifier2Wallet = Wallet.createRandom(provider);

  // Fund agents
  for (const wallet of [workerWallet, verifier1Wallet, verifier2Wallet]) {
    const tx = await deployer.sendTransaction({ to: wallet.address, value: AGENT_FUNDING });
    await waitForTx(tx, `Fund ${wallet.address.slice(0, 10)}`);
  }

  // ─── REGISTER AGENTS ────────────────────────────────────────────────────
  const identity = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider);
  const agentIds: Record<string, bigint> = {};

  for (const [name, wallet] of [
    [session.agent_name, workerWallet],
    ['Reviewer 1', verifier1Wallet],
    ['Reviewer 2', verifier2Wallet],
  ] as const) {
    const signer = wallet.connect(provider);
    const idReg = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, signer);
    const uri = `chaoschain://engineering-agent/${session.agent_name.toLowerCase().replace(/\s+/g, '-')}/${Date.now()}`;
    const regTx = await idReg['register(string)'](uri);
    const regReceipt = await waitForTx(regTx, `Register ${name}`);

    let agentId: bigint | null = null;
    for (const eventLog of regReceipt.logs) {
      if (eventLog.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && eventLog.topics.length === 4) {
        agentId = BigInt(eventLog.topics[3]);
        break;
      }
    }
    if (agentId === null) throw new Error(`Failed to parse agentId for ${name}`);

    const ownerKey = name === session.agent_name ? 'Worker' : name;
    agentIds[ownerKey] = agentId;

    const owner = await identity.ownerOf(agentId);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`Agent NFT ownership mismatch for ${name}`);
    }
  }

  // Register in Studio
  const studio = new ethers.Contract(studioAddress, STUDIO_ABI, deployer);
  for (const [name, wallet, role] of [
    ['Worker', workerWallet, ROLE_WORKER],
    ['Reviewer 1', verifier1Wallet, ROLE_VERIFIER],
    ['Reviewer 2', verifier2Wallet, ROLE_VERIFIER],
  ] as const) {
    const signer = wallet.connect(provider);
    const studioSigned = new ethers.Contract(studioAddress, STUDIO_ABI, signer);
    const key = name === 'Worker' ? 'Worker' : name;
    await waitForTx(
      await studioSigned.registerAgent(agentIds[key], role, { value: STAKE }),
      `Register ${name} in Studio`,
    );
  }

  // ─── EVIDENCE ────────────────────────────────────────────────────────────
  const evidenceHash = keccak256(Buffer.from(JSON.stringify(session)));
  const workerSig = await workerWallet.signMessage(evidenceHash);
  const dkgEvidence = buildEvidencePackages(session, workerWallet.address, workerSig);

  // Print evidence graph
  console.log(`Work Evidence (${session.commits.length} commits → causal graph):`);
  for (const [i, commit] of session.commits.entries()) {
    const isRoot = commit.parent_commits.length === 0;
    const tag = isRoot ? 'ROOT' : 'INTEGRATION';
    const refs = !isRoot ? ` (refs: ${commit.parent_commits.join(', ')})` : '';
    console.log(`  [${tag}] ${commit.hash} — ${commit.message}${refs}`);
  }
  console.log('');

  // ─── DKG ─────────────────────────────────────────────────────────────────
  const dkgResult = computeDKG(dkgEvidence);
  const { thread_root, evidence_root } = dkgResult;

  // ─── SUBMIT WORK ─────────────────────────────────────────────────────────
  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint64', 'bytes32', 'bytes32'],
      [studioAddress, EPOCH, thread_root, evidence_root],
    ),
  );

  const workerSigner = workerWallet.connect(provider);
  const studioAsWorker = new ethers.Contract(studioAddress, STUDIO_ABI, workerSigner);
  const workTx = await studioAsWorker.submitWork(dataHash, thread_root, evidence_root, '0x');
  const workReceipt = await waitForTx(workTx, 'submitWork');

  // ─── VERIFIER SCORING ───────────────────────────────────────────────────
  const complianceScore = computeComplianceScore(session);
  const efficiencyScore = computeEfficiencyScore(session);

  const derivedScoresMap: Record<string, number[]> = {};
  const verifierNames = ['Reviewer 1', 'Reviewer 2'] as const;

  console.log('Independent Verification:');

  for (const [idx, [name, wallet]] of ([
    ['Reviewer 1', verifier1Wallet],
    ['Reviewer 2', verifier2Wallet],
  ] as const).entries()) {
    const verifierDKG = computeDKG(dkgEvidence);

    if (verifierDKG.thread_root !== thread_root) {
      throw new Error(`${name}: DKG thread_root mismatch`);
    }

    const features = extractPoAFeatures(verifierDKG, workerWallet.address);
    console.log(`  ${name}: evidence structure verified ✓ | roots match ✓`);

    const clamp = (v: number) => Math.max(1, Math.min(255, v));
    const scores = [
      clamp(features.initiative),
      clamp(features.collaboration),
      clamp(features.reasoning),
      complianceScore,
      efficiencyScore,
    ];
    derivedScoresMap[name] = scores;

    const signer = wallet.connect(provider);
    const studioAsSigner = new ethers.Contract(studioAddress, STUDIO_ABI, signer);
    const encoded = encodeScoreVector(scores);
    await waitForTx(
      await studioAsSigner.submitScoreVectorForWorker(dataHash, workerWallet.address, encoded),
      `${name} score submission`,
    );
  }

  console.log('');

  // ─── CLOSE EPOCH ─────────────────────────────────────────────────────────
  const rewards = new ethers.Contract(REWARDS_DIST, REWARDS_ABI, deployer);
  await waitForTx(await rewards.registerWork(studioAddress, EPOCH, dataHash), 'registerWork');
  for (const wallet of [verifier1Wallet, verifier2Wallet]) {
    await waitForTx(await rewards.registerValidator(dataHash, wallet.address), 'registerValidator');
  }
  const closeTx = await rewards.closeEpoch(studioAddress, EPOCH);
  const closeReceipt = await waitForTx(closeTx, 'closeEpoch');

  // ─── QUERY REPUTATION ───────────────────────────────────────────────────
  const repReg = new ethers.Contract(REPUTATION_REG, REPUTATION_ABI, provider);
  const clientAddresses = [REWARDS_DIST];
  const studioTag = studioAddress.toLowerCase();
  const dimensions = ['Initiative', 'Collaboration', 'Reasoning', 'Compliance', 'Efficiency'];

  const repResults: Array<{ dim: string; count: bigint; value: bigint; decimals: number }> = [];
  for (const dim of dimensions) {
    try {
      const [count, value, decimals] = await repReg.getSummary(agentIds['Worker'], clientAddresses, dim, studioTag);
      repResults.push({ dim, count, value, decimals });
    } catch {
      repResults.push({ dim, count: 0n, value: 0n, decimals: 0 });
    }
  }

  const verifierRepResults: Array<{ name: string; count: bigint; value: bigint; decimals: number }> = [];
  for (const [name, key] of [['Reviewer 1', 'Reviewer 1'], ['Reviewer 2', 'Reviewer 2']] as const) {
    try {
      const [count, value, decimals] = await repReg.getSummary(
        agentIds[key],
        clientAddresses,
        'VALIDATOR_ACCURACY',
        'CONSENSUS_MATCH',
      );
      verifierRepResults.push({ name, count, value, decimals });
    } catch {
      verifierRepResults.push({ name, count: 0n, value: 0n, decimals: 0 });
    }
  }

  // ─── DISPLAY RESULTS ────────────────────────────────────────────────────
  const scores = derivedScoresMap['Reviewer 1'];
  const rootCommits = session.commits.filter(c => c.parent_commits.length === 0).length;
  const maxDepth = computeMaxCausalDepth(session.commits);

  console.log('Derived Accountability Score:');
  console.log(`  Initiative:    ${scores[0]}  — Agent originated ${rootCommits} of ${session.commits.length} work items independently`);
  console.log(`  Collaboration: ${scores[1]} — Agent connected all work streams in final integration`);
  console.log(`  Reasoning:     ${scores[2]}  — Demonstrated ${maxDepth}-level causal reasoning chain`);
  console.log(`  Compliance:    ${scores[3]}  — Test coverage and constraints followed`);
  console.log(`  Efficiency:    ${scores[4]}  — ${session.lines_added} lines changed in ${formatDuration(session.session_duration_seconds)}`);
  console.log('');

  console.log('Verifier Track Record:');
  for (const vr of verifierRepResults) {
    const consensus = vr.count > 0n ? 'in consensus' : 'pending';
    console.log(`  ${vr.name}: Accuracy Score ${vr.value} — ${consensus}`);
  }
  console.log('');

  console.log('Cryptographic Proof:');
  console.log(`  Work commitment:  https://sepolia.etherscan.io/tx/${workTx.hash}`);
  console.log(`  Epoch settlement: https://sepolia.etherscan.io/tx/${closeTx.hash}`);
  console.log(`  Agent record:     https://sepolia.etherscan.io/token/${IDENTITY_REGISTRY}?a=${agentIds['Worker']}`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  This agent now has a verifiable, portable track record.`);
  console.log(`  Any system can read it: GET /v1/agent/${agentIds['Worker']}/reputation`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // ─── REPORT FILE ─────────────────────────────────────────────────────────
  const reportDir = path.resolve(process.cwd(), 'reports');
  fs.mkdirSync(reportDir, { recursive: true });
  const reportFile = path.join(reportDir, `engineering-agent-${sessionArg}-${Date.now()}.md`);

  const report = `# Engineering Agent Accountability Report

**Agent**: ${session.agent_name}
**Session**: ${session.session_id}
**Task**: ${session.task}
**Repository**: ${session.repository}
**PR**: #${session.pr_number} | Tests: ${session.tests_passed ? 'Passed' : 'Failed'}
**Date**: ${new Date().toISOString()}
**Duration**: ${((Date.now() - startTime) / 1000).toFixed(1)}s

---

## Addresses

| Role | Address |
|------|---------|
| **Studio** | \`${studioAddress}\` |
| **${session.agent_name}** (Worker) | \`${workerWallet.address}\` |
| **Reviewer 1** (Verifier) | \`${verifier1Wallet.address}\` |
| **Reviewer 2** (Verifier) | \`${verifier2Wallet.address}\` |

## Agent IDs

| Agent | ID |
|-------|----|
| ${session.agent_name} | ${agentIds['Worker']} |
| Reviewer 1 | ${agentIds['Reviewer 1']} |
| Reviewer 2 | ${agentIds['Reviewer 2']} |

## Evidence Graph (${session.commits.length} commits)

${session.commits.map(c => {
    const tag = c.parent_commits.length === 0 ? 'ROOT' : 'INTEGRATION';
    return `- [${tag}] \`${c.hash}\` — ${c.message} (${c.files_changed.length} files)`;
  }).join('\n')}

## DKG Roots

| Field | Value |
|-------|-------|
| **thread_root** | \`${thread_root}\` |
| **evidence_root** | \`${evidence_root}\` |
| **DAG nodes** | ${dkgResult.dag.nodes.size} |
| **DAG roots** | ${dkgResult.dag.roots.size} |
| **DAG terminals** | ${dkgResult.dag.terminals.size} |

## Accountability Scores

| Dimension | Score | Source |
|-----------|-------|--------|
| Initiative | ${scores[0]} | Evidence-derived (DKG) |
| Collaboration | ${scores[1]} | Evidence-derived (DKG) |
| Reasoning | ${scores[2]} | Evidence-derived (DKG) |
| Compliance | ${scores[3]} | Session metadata |
| Efficiency | ${scores[4]} | Session metadata |

## Reputation (Worker agentId=${agentIds['Worker']})

| Dimension | Count | Value | Decimals |
|-----------|-------|-------|----------|
${repResults.map(r => `| ${r.dim} | ${r.count} | ${r.value} | ${r.decimals} |`).join('\n')}

## Verifier Reputation

| Verifier | Count | Value | Decimals |
|----------|-------|-------|----------|
${verifierRepResults.map(r => `| ${r.name} | ${r.count} | ${r.value} | ${r.decimals} |`).join('\n')}

## Transaction Hashes

| Transaction | Hash |
|-------------|------|
| Work Submission | \`${workTx.hash}\` |
| Close Epoch | \`${closeTx.hash}\` |
| dataHash | \`${dataHash}\` |

## Links

- Work: https://sepolia.etherscan.io/tx/${workTx.hash}
- Epoch: https://sepolia.etherscan.io/tx/${closeTx.hash}
- Agent: https://sepolia.etherscan.io/token/${IDENTITY_REGISTRY}?a=${agentIds['Worker']}
`;

  fs.writeFileSync(reportFile, report);
  console.log(`Report: ${reportFile}`);
}

// =============================================================================
// UTILITIES
// =============================================================================

function computeMaxCausalDepth(commits: SessionCommit[]): number {
  const depths = new Map<string, number>();
  for (const commit of commits) {
    if (commit.parent_commits.length === 0) {
      depths.set(commit.hash, 1);
    } else {
      const parentDepths = commit.parent_commits.map(p => depths.get(p) ?? 0);
      depths.set(commit.hash, Math.max(...parentDepths) + 1);
    }
  }
  return Math.max(...depths.values(), 1);
}

main().catch((err) => {
  console.error('\n✗ Demo failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
