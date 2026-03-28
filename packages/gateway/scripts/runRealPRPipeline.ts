#!/usr/bin/env -S npx tsx
/**
 * ChaosChain — Real PR → Full Pipeline
 *
 * End-to-end validation:
 *   GitHub PR → Evidence DAG → verifyWorkEvidence() → composeScoreVector()
 *   → submit workflow to Gateway → on-chain work registration
 *   → pending work visible via gateway API
 *
 * Usage:
 *   cd packages/gateway
 *   npx tsx scripts/runRealPRPipeline.ts [PR_URL]
 *
 *   PR_URL optional, e.g. https://github.com/openclaw/openclaw/pull/38743
 *   If omitted, uses PR_REPO + PR_NUMBER from env (or defaults).
 *
 *   Loads .env from packages/gateway so SIGNER_PRIVATE_KEY, RPC_URL, etc. work.
 *
 * Environment (or .env):
 *   SIGNER_PRIVATE_KEY   — wallet private key (required)
 *   RPC_URL              — Sepolia RPC endpoint
 *   GATEWAY_URL          — gateway URL (default: https://gateway.chaoscha.in)
 *   API_KEY              — API key for POST /workflows/* (required for live gateway)
 *   PR_REPO              — GitHub repo owner/repo (if no URL arg)
 *   PR_NUMBER            — PR number (if no URL arg)
 *   GITHUB_TOKEN         — optional, avoids rate limits
 */

import { config } from 'dotenv';
import { ethers, keccak256, AbiCoder, Wallet, JsonRpcProvider } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDKG } from '../src/services/dkg/index.js';
import type { EvidencePackage as GatewayEvidencePackage } from '../src/services/dkg/types.js';

// SDK imports for Phase 3 scoring pipeline
import {
  verifyWorkEvidence,
  composeScoreVectorWithDefaults,
  type EvidencePackage as SDKEvidencePackage,
  type AgencySignals,
} from '../../../../chaoschain-sdk-ts/src/evidence.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from packages/gateway so it works from repo root or gateway dir
config({ path: path.resolve(__dirname, '../.env') });

// =============================================================================
// CONFIG — load from env (dotenv loads packages/gateway/.env when cwd is gateway)
// =============================================================================

function parsePRUrl(url: string): { owner: string; repo: string; number: number } | null {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

const prUrlArg = process.argv[2];
const parsedFromUrl = prUrlArg ? parsePRUrl(prUrlArg) : null;

const PR_REPO = parsedFromUrl
  ? `${parsedFromUrl.owner}/${parsedFromUrl.repo}`
  : (process.env.PR_REPO ?? 'dabit3/react-native-ai');
const PR_NUMBER = parsedFromUrl
  ? parsedFromUrl.number
  : parseInt(process.env.PR_NUMBER ?? '40', 10);
const STUDIO_ADDRESS = process.env.STUDIO_ADDRESS ?? '0xFA0795fD5D7F58eCAa7Eae35Ad9cB8AED9424Dd0';
const GATEWAY_URL = process.env.GATEWAY_URL ?? 'https://gateway.chaoscha.in';
const API_KEY = process.env.API_KEY ?? '';
const RPC_URL =
  process.env.RPC_URL?.trim() ||
  process.env.SEPOLIA_RPC_URL?.trim() ||
  'https://rpc.sepolia.org';
const SIGNER_KEY = process.env.SIGNER_PRIVATE_KEY
  ?? process.env.DEPLOYER_PRIVATE_KEY
  ?? process.env.SEPOLIA_PRIVATE_KEY
  ?? '';

const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const SNAPSHOT_FILE = path.resolve(__dirname, '../demo-data/hidden/real-pr-snapshot.json');
const EPOCH = 0;
const STAKE = ethers.parseEther('0.00005');
const MIN_BALANCE = ethers.parseEther('0.001');

// =============================================================================
// ABI FRAGMENTS
// =============================================================================

const IDENTITY_ABI = [
  'function register(string agentURI) returns (uint256 agentId)',
  'function balanceOf(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
];

const STUDIO_ABI = [
  'function registerAgent(uint256 agentId, uint8 role) payable',
  'function getAgentId(address agent) view returns (uint256)',
  'function submitWork(bytes32 dataHash, bytes32 threadRoot, bytes32 evidenceRoot, bytes feedbackAuth)',
];

const ROLE_WORKER = 1;

// =============================================================================
// TYPES
// =============================================================================

interface PRCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  parents_in_pr: string[];
  files_changed: string[];
}

interface PRData {
  repo: string;
  number: number;
  title: string;
  author: string;
  merged: boolean;
  commits: PRCommit[];
  changed_files: number;
  source_url: string;
}

// =============================================================================
// GITHUB FETCH
// =============================================================================

async function fetchPRFromGitHub(owner: string, repo: string, num: number): Promise<PRData> {
  const headers: Record<string, string> = { 'User-Agent': 'ChaosChain-Pipeline' };
  if (process.env.GITHUB_TOKEN) headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;

  const [prRes, commitsRes, filesRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}`, { headers }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}/commits`, { headers }),
    fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${num}/files`, { headers }),
  ]);

  if (!prRes.ok) throw new Error(`GitHub API ${prRes.status}: ${await prRes.text()}`);
  const pr: any = await prRes.json();
  const commits: any[] = await commitsRes.json();
  const files: any[] = await filesRes.json();

  const prCommitShas = new Set(commits.map((c: any) => c.sha.slice(0, 7)));

  return {
    repo: `${owner}/${repo}`,
    number: num,
    title: pr.title,
    author: pr.user.login,
    merged: pr.merged ?? false,
    changed_files: files.length,
    commits: commits.map((c: any) => {
      const sha7 = c.sha.slice(0, 7);
      const parentShas = (c.parents ?? [])
        .map((p: any) => p.sha.slice(0, 7))
        .filter((s: string) => prCommitShas.has(s));
      return {
        sha: sha7,
        message: c.commit.message.split('\n')[0].slice(0, 80),
        author: c.commit.author?.name ?? pr.user.login,
        timestamp: c.commit.author?.date ?? new Date().toISOString(),
        parents_in_pr: parentShas,
        files_changed: files
          .filter((_f: any) => commits.some((cc: any) => cc.sha === c.sha))
          .map((f: any) => f.filename).slice(0, 20),
      };
    }),
    source_url: `https://github.com/${owner}/${repo}/pull/${num}`,
  };
}

function loadFallbackSnapshot(): PRData {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Snapshot not found at ${SNAPSHOT_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
  return {
    repo: raw.pr?.repo ?? `${raw.owner}/${raw.repoName}`,
    number: raw.pr?.number ?? raw.number,
    title: raw.pr?.title ?? raw.title,
    author: raw.pr?.author ?? raw.author,
    merged: raw.pr?.merged ?? true,
    changed_files: raw.pr?.changed_files ?? raw.files?.length ?? 0,
    commits: raw.commits.map((c: any) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      timestamp: c.timestamp,
      parents_in_pr: c.parents_in_pr ?? [],
      files_changed: c.files_changed ?? [],
    })),
    source_url: raw.source ?? `https://github.com/${raw.pr?.repo}/pull/${raw.pr?.number}`,
  };
}

// =============================================================================
// EVIDENCE BUILDING
// =============================================================================

function buildEvidencePackages(pr: PRData, agentAddress: string): GatewayEvidencePackage[] {
  const commitShaToTxId = new Map<string, string>();
  const packages: GatewayEvidencePackage[] = [];
  const baseTimestamp = Date.now();

  for (const [i, commit] of pr.commits.entries()) {
    const payload = JSON.stringify({
      sha: commit.sha,
      message: commit.message,
      files_changed: commit.files_changed,
      repo: pr.repo,
      pr_number: pr.number,
    });
    const payloadHash = keccak256(Buffer.from(payload));
    const txId = `demo_${payloadHash.slice(2, 46)}`;
    commitShaToTxId.set(commit.sha, txId);

    const parentIds = commit.parents_in_pr
      .map((sha) => commitShaToTxId.get(sha))
      .filter((id): id is string => id !== undefined);

    packages.push({
      arweave_tx_id: txId,
      author: agentAddress,
      timestamp: baseTimestamp + i * 1000,
      parent_ids: parentIds,
      payload_hash: payloadHash,
      artifact_ids: commit.files_changed,
      signature: '0xdemo_signature',
    });
  }

  return packages;
}

// =============================================================================
// ON-CHAIN REGISTRATION
// =============================================================================

async function waitForTx(tx: ethers.TransactionResponse, label: string): Promise<ethers.TransactionReceipt> {
  process.stdout.write(`  ⏳ ${label}...`);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Transaction failed: ${label} (${tx.hash})`);
  console.log(` ✓ ${tx.hash.slice(0, 14)}...`);
  return receipt;
}

async function ensureAgentRegistered(
  wallet: Wallet,
): Promise<{ agentId: bigint; alreadyRegistered: boolean }> {
  const studioContract = new ethers.Contract(STUDIO_ADDRESS, STUDIO_ABI, wallet);
  const existingId: bigint = await studioContract.getAgentId(wallet.address);

  if (existingId > 0n) {
    return { agentId: existingId, alreadyRegistered: true };
  }

  console.log('\n  On-chain agent registration:');
  const identityContract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, wallet);
  const uri = `chaoschain://engineering-agent/pipeline-test/${Date.now()}`;
  const regTx = await identityContract['register(string)'](uri);
  const regReceipt = await waitForTx(regTx, 'Register identity (IdentityRegistry)');

  let agentId: bigint | null = null;
  for (const log of regReceipt.logs) {
    if (log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.topics.length === 4) {
      agentId = BigInt(log.topics[3]);
      break;
    }
  }
  if (agentId === null) throw new Error('Failed to parse agentId from IdentityRegistry event');

  const studioRegTx = await studioContract.registerAgent(agentId, ROLE_WORKER, { value: STAKE });
  await waitForTx(studioRegTx, 'Register as WORKER in Studio');

  return { agentId, alreadyRegistered: false };
}

// =============================================================================
// GATEWAY API
// =============================================================================

async function gatewayPost(urlPath: string, body: Record<string, unknown>): Promise<any> {
  const url = `${GATEWAY_URL}${urlPath}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch {
    throw new Error(`Gateway returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`Gateway ${res.status}: ${json.error ?? json.message ?? text.slice(0, 200)}`);
  }
  return json;
}

async function gatewayGet(urlPath: string): Promise<any> {
  const url = `${GATEWAY_URL}${urlPath}`;
  const headers: Record<string, string> = {};
  if (API_KEY) headers['x-api-key'] = API_KEY;
  const res = await fetch(url, { headers });
  return res.json();
}

async function pollWorkflow(id: string, timeoutMs = 180_000): Promise<any> {
  const start = Date.now();
  let lastStep = '';
  while (Date.now() - start < timeoutMs) {
    const wf = await gatewayGet(`/workflows/${id}`);
    if (wf.state === 'COMPLETED') return wf;
    if (wf.state === 'FAILED') {
      throw new Error(`Workflow FAILED at step ${wf.step}: ${wf.error?.message ?? 'unknown'}`);
    }
    const stepInfo = `${wf.state}/${wf.step}`;
    if (stepInfo !== lastStep) {
      console.log(`    ${wf.step} (${wf.state})`);
      lastStep = stepInfo;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Workflow ${id} did not complete within ${timeoutMs / 1000}s`);
}

// =============================================================================
// SIGNAL FORMATTING
// =============================================================================

function fmtSignal(v: number | undefined): string {
  return v !== undefined ? v.toFixed(2) : '—';
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!SIGNER_KEY) {
    console.error('Missing SIGNER_PRIVATE_KEY.');
    console.error('');
    console.error('Either:');
    console.error('  1. Add SIGNER_PRIVATE_KEY to packages/gateway/.env and run from gateway dir:');
    console.error('     cd packages/gateway && npx tsx scripts/runRealPRPipeline.ts [PR_URL]');
    console.error('');
    console.error('  2. Or pass it inline:');
    console.error('     SIGNER_PRIVATE_KEY=0x... npx tsx scripts/runRealPRPipeline.ts https://github.com/openclaw/openclaw/pull/38743');
    console.error('');
    console.error('For live gateway also set: GATEWAY_URL=https://gateway.chaoscha.in API_KEY=cc_...');
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(SIGNER_KEY, provider);
  const signerAddress = wallet.address.toLowerCase();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ChaosChain — Real PR Pipeline');
  console.log('  GitHub PR → Evidence DAG → Signals → Score Vector → On-chain');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Gateway:  ${GATEWAY_URL}`);
  console.log(`  RPC:      ${RPC_URL.replace(/\/v2\/.*/, '/v2/...')}`);
  console.log(`  Signer:   ${wallet.address}`);
  console.log(`  Studio:   ${STUDIO_ADDRESS}`);

  // ── Pre-flight ────────────────────────────────────────────────────────────
  const balance = await provider.getBalance(wallet.address);
  console.log(`  Balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance < MIN_BALANCE) {
    console.error(`\n✗ Insufficient balance. Need at least ${ethers.formatEther(MIN_BALANCE)} ETH.`);
    process.exit(1);
  }

  try {
    const health = await gatewayGet('/health');
    console.log(`  Gateway:  ${health.status === 'ok' ? '✓ healthy' : '✗ ' + JSON.stringify(health)}`);
  } catch (err) {
    console.error(`\n✗ Cannot reach gateway at ${GATEWAY_URL}: ${(err as Error).message}`);
    process.exit(1);
  }

  const isLiveGateway = GATEWAY_URL.includes('gateway.chaoscha.in');
  if (isLiveGateway && !API_KEY) {
    console.error('\n✗ Live gateway (gateway.chaoscha.in) requires an API key for workflow submission.');
    console.error('  Add to packages/gateway/.env:');
    console.error('    API_KEY=cc_...');
    console.error('  Get a key: use POST /admin/keys with x-api-key: ADMIN_KEY, or ask @chaoschain on Telegram.');
    process.exit(1);
  }

  // ── Step 1–2: Fetch PR data ──────────────────────────────────────────────
  const [owner, repo] = PR_REPO.split('/');
  let pr: PRData;

  console.log(`\n── Step 1: Fetch PR ──`);
  console.log(`  ${owner}/${repo}#${PR_NUMBER}`);
  try {
    pr = await fetchPRFromGitHub(owner, repo, PR_NUMBER);
    console.log(`  ✓ ${pr.commits.length} commits, ${pr.changed_files} files changed`);
  } catch (err) {
    console.log(`  ✗ GitHub API: ${(err as Error).message}`);
    console.log('  → Using bundled snapshot');
    pr = loadFallbackSnapshot();
    console.log(`  ✓ ${pr.commits.length} commits (from snapshot)`);
  }

  console.log('');
  console.log(`  PR:      ${pr.repo}/pull/${pr.number}`);
  console.log(`  Title:   ${pr.title}`);
  console.log(`  Author:  ${pr.author}`);
  console.log(`  Merged:  ${pr.merged ? '✓' : '✗'}`);

  // ── Step 3: Build Evidence DAG ───────────────────────────────────────────
  console.log('\n── Step 2: Build Evidence DAG ──');
  const evidence = buildEvidencePackages(pr, signerAddress);

  console.log(`  ${evidence.length} evidence nodes:`);
  for (const e of evidence) {
    const tag = e.parent_ids.length === 0 ? 'ROOT' : 'CHILD';
    const parentInfo = e.parent_ids.length > 0
      ? ` → refs ${e.parent_ids.map(p => p.slice(0, 12) + '...').join(', ')}`
      : '';
    console.log(`    [${tag}] ${e.arweave_tx_id.slice(0, 20)}... (${e.artifact_ids.length} files)${parentInfo}`);
  }

  // ── Step 4: Validate & extract signals via SDK ───────────────────────────
  console.log('\n── Step 3: Validate & Extract Signals (SDK) ──');

  // Cast to SDK type (structurally identical)
  const sdkEvidence = evidence as unknown as SDKEvidencePackage[];
  const result = verifyWorkEvidence(sdkEvidence);

  if (!result.valid || !result.signals) {
    console.error('  ✗ Evidence graph validation failed');
    process.exit(1);
  }

  const signals: AgencySignals = result.signals;
  console.log('  ✓ Evidence graph valid');
  console.log('');
  console.log('  Signals:');
  console.log(`    initiative:    ${fmtSignal(signals.initiativeSignal)}`);
  console.log(`    collaboration: ${fmtSignal(signals.collaborationSignal)}`);
  console.log(`    reasoning:     ${fmtSignal(signals.reasoningSignal)}`);
  console.log(`    compliance:    ${fmtSignal(signals.complianceSignal)}`);
  console.log(`    efficiency:    ${fmtSignal(signals.efficiencySignal)}`);
  console.log('');
  console.log('  Observed features:');
  console.log(`    totalNodes:          ${signals.observed.totalNodes}`);
  console.log(`    rootCount:           ${signals.observed.rootCount}`);
  console.log(`    edgeCount:           ${signals.observed.edgeCount}`);
  console.log(`    maxDepth:            ${signals.observed.maxDepth}`);
  console.log(`    artifactCount:       ${signals.observed.artifactCount}`);
  console.log(`    terminalCount:       ${signals.observed.terminalCount}`);
  console.log(`    integrationNodes:    ${signals.observed.integrationNodeCount}`);
  if (signals.observed.uniqueAuthors !== undefined) {
    console.log(`    uniqueAuthors:       ${signals.observed.uniqueAuthors}`);
  }

  // ── Step 5: Compose score vector ─────────────────────────────────────────
  console.log('\n── Step 4: Compose Score Vector ──');
  const scoreVector = composeScoreVectorWithDefaults(signals);

  console.log(`  Score vector: [${scoreVector.join(', ')}]`);
  console.log(`    Initiative:    ${scoreVector[0]}`);
  console.log(`    Collaboration: ${scoreVector[1]}`);
  console.log(`    Reasoning:     ${scoreVector[2]}`);
  console.log(`    Compliance:    ${scoreVector[3]}`);
  console.log(`    Efficiency:    ${scoreVector[4]}`);

  // ── Step 6a: Compute DKG for gateway submission ──────────────────────────
  console.log('\n── Step 5: Compute DKG ──');
  const dkgResult = computeDKG(evidence);
  const { thread_root, evidence_root } = dkgResult;
  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint64', 'bytes32', 'bytes32'],
      [STUDIO_ADDRESS, EPOCH, thread_root, evidence_root],
    ),
  );
  console.log(`  thread_root:   ${thread_root.slice(0, 18)}...`);
  console.log(`  evidence_root: ${evidence_root.slice(0, 18)}...`);
  console.log(`  data_hash:     ${dataHash.slice(0, 18)}...`);

  // ── Step 6b: On-chain agent registration ─────────────────────────────────
  console.log('\n── Step 6: Agent Registration ──');
  const { agentId, alreadyRegistered } = await ensureAgentRegistered(wallet);
  if (alreadyRegistered) {
    console.log(`  ✓ Already registered (agentId: ${agentId})`);
  } else {
    console.log(`  ✓ Registered with agentId: ${agentId}`);
  }

  // ── Step 6c: Submit workflow to gateway ──────────────────────────────────
  console.log('\n── Step 7: Submit Workflow to Gateway ──');
  const evidenceContent = Buffer.from(JSON.stringify({
    pr: { repo: pr.repo, number: pr.number, title: pr.title, author: pr.author },
    commits: pr.commits,
    scoreVector,
  })).toString('base64');

  const workResult = await gatewayPost('/workflows/work-submission', {
    studio_address: STUDIO_ADDRESS,
    epoch: EPOCH,
    agent_address: signerAddress,
    data_hash: dataHash,
    dkg_evidence: evidence,
    evidence_content: evidenceContent,
    signer_address: signerAddress,
  });

  const workflowId = workResult.id;
  console.log(`  ✓ Workflow created: ${workflowId}`);
  console.log('  Polling for completion...');

  let workTxHash: string | undefined;
  let registerTxHash: string | undefined;

  try {
    const completed = await pollWorkflow(workflowId);
    console.log('  ✓ Workflow COMPLETED');
    workTxHash = completed.progress?.onchain_tx_hash;
    registerTxHash = completed.progress?.register_tx_hash;
  } catch (err) {
    console.log(`  ⚠ ${(err as Error).message}`);
  }

  // ── Step 8: Verify gateway API ───────────────────────────────────────────
  console.log('\n── Step 8: Verify Gateway API ──');
  const studioWork = await gatewayGet(`/v1/studio/${STUDIO_ADDRESS}/work`);
  const workItems = studioWork.data?.work ?? [];
  console.log(`  Work items for studio: ${workItems.length}`);

  const found = workItems.find((w: any) => w.work_id === dataHash);
  if (found) {
    console.log(`  ✓ Work item found: ${found.work_id.slice(0, 14)}... (epoch ${found.epoch})`);
  } else if (workItems.length > 0) {
    console.log('  Work items:');
    for (const item of workItems.slice(0, 5)) {
      console.log(`    - epoch ${item.epoch}: ${item.work_id?.slice(0, 14)}...`);
    }
  }

  // ── Step 9: Pipeline summary ─────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Pipeline Summary');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  PR: ${pr.repo}/pull/${pr.number}`);
  console.log(`  Title: ${pr.title}`);
  console.log(`  Author: ${pr.author}`);
  console.log('');
  console.log('  Signals:');
  console.log(`    initiative:    ${fmtSignal(signals.initiativeSignal)}`);
  console.log(`    collaboration: ${fmtSignal(signals.collaborationSignal)}`);
  console.log(`    reasoning:     ${fmtSignal(signals.reasoningSignal)}`);
  console.log(`    compliance:    ${fmtSignal(signals.complianceSignal)}`);
  console.log(`    efficiency:    ${fmtSignal(signals.efficiencySignal)}`);
  console.log('');
  console.log(`  Score vector: [${scoreVector.join(', ')}]`);
  console.log('');
  console.log(`  Workflow ID: ${workflowId}`);
  if (workTxHash) {
    console.log(`  Work TX: https://sepolia.etherscan.io/tx/${workTxHash}`);
  }
  if (registerTxHash) {
    console.log(`  Register TX: https://sepolia.etherscan.io/tx/${registerTxHash}`);
  }
  console.log('');
  console.log(`  Gateway query:`);
  console.log(`    GET ${GATEWAY_URL}/v1/studio/${STUDIO_ADDRESS}/work`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error(`\n✗ Failed: ${err.message}`);
  if (err.message.includes('401') || err.message.includes('UNAUTHORIZED')) {
    console.error('');
    console.error('  → Add API_KEY to packages/gateway/.env (a key registered on the gateway).');
    console.error('  → Get one: POST https://gateway.chaoscha.in/admin/keys with x-api-key: ADMIN_KEY');
    console.error('    or contact @chaoschain on Telegram.');
  }
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
