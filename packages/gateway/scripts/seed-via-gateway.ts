#!/usr/bin/env -S npx tsx
/**
 * ChaosChain — Real PR → Full Gateway Pipeline
 *
 * End-to-end: fetches a real GitHub PR, registers the agent on-chain,
 * submits work through the gateway's workflow API, and verifies the result.
 *
 * Usage:
 *   cd packages/gateway
 *   GATEWAY_URL=http://127.0.0.1:3000 \
 *   npx tsx scripts/seed-via-gateway.ts https://github.com/owner/repo/pull/123
 *
 * Environment:
 *   GATEWAY_URL        — gateway base URL (default: https://gateway.chaoscha.in)
 *   API_KEY            — API key for POST /workflows/* endpoints
 *   SIGNER_PRIVATE_KEY — wallet private key (same key the gateway uses)
 *   RPC_URL            — Sepolia RPC endpoint
 */

import { ethers, keccak256, AbiCoder, Wallet, JsonRpcProvider } from 'ethers';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeDKG, extractPoAFeatures } from '../src/services/dkg/index.js';
import type { EvidencePackage } from '../src/services/dkg/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CONFIG
// =============================================================================

const GATEWAY_URL = process.env.GATEWAY_URL ?? 'https://gateway.chaoscha.in';
const API_KEY = process.env.API_KEY ?? '';
const RPC_URL = process.env.RPC_URL
  ?? process.env.SEPOLIA_RPC_URL
  ?? 'https://eth-sepolia.g.alchemy.com/v2/gkHpxu7aSBljCv8Hlxu1GJnQRsyyZM7z';
const SIGNER_KEY = process.env.SIGNER_PRIVATE_KEY
  ?? process.env.DEPLOYER_PRIVATE_KEY
  ?? process.env.SEPOLIA_PRIVATE_KEY
  ?? '';

const STUDIO_ADDRESS = '0xA855F7893ac01653D1bCC24210bFbb3c47324649';
const IDENTITY_REGISTRY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
const SNAPSHOT_FILE = path.resolve(__dirname, '../demo-data/real-pr-snapshot.json');

const EPOCH = 0;
const STAKE = ethers.parseEther('0.00005');
const MIN_BALANCE = ethers.parseEther('0.001');

// =============================================================================
// ABI FRAGMENTS
// =============================================================================

const IDENTITY_ABI = [
  'function register(string agentURI) returns (uint256 agentId)',
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
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

function parsePRUrl(url: string): { owner: string; repo: string; number: number } {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) throw new Error(`Invalid PR URL: ${url}`);
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

async function fetchPRFromGitHub(owner: string, repo: string, num: number): Promise<PRData> {
  const headers: Record<string, string> = { 'User-Agent': 'ChaosChain-Gateway' };
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
        files_changed: files.filter((f: any) =>
          commits.some((cc: any) => cc.sha === c.sha)
        ).map((f: any) => f.filename).slice(0, 20),
      };
    }),
    source_url: `https://github.com/${owner}/${repo}/pull/${num}`,
  };
}

function loadFallbackSnapshot(): PRData {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`No PR URL provided and snapshot not found at ${SNAPSHOT_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8'));
  return {
    repo: raw.repo ?? `${raw.owner}/${raw.repoName}`,
    number: raw.number,
    title: raw.title,
    author: raw.author,
    merged: raw.merged ?? true,
    changed_files: raw.changed_files ?? raw.commits.reduce((n: number, c: any) => n + (c.files_changed?.length ?? 0), 0),
    commits: raw.commits.map((c: any) => ({
      sha: c.sha,
      message: c.message,
      author: c.author,
      timestamp: c.timestamp,
      parents_in_pr: c.parents_in_pr,
      files_changed: c.files_changed ?? [],
    })),
    source_url: raw.source,
  };
}

// =============================================================================
// EVIDENCE BUILDING
// =============================================================================

function buildEvidencePackages(pr: PRData, agentAddress: string): EvidencePackage[] {
  const commitShaToTxId = new Map<string, string>();
  const packages: EvidencePackage[] = [];
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
  provider: JsonRpcProvider,
): Promise<{ agentId: bigint; alreadyRegistered: boolean }> {
  const studioContract = new ethers.Contract(STUDIO_ADDRESS, STUDIO_ABI, wallet);
  const existingId: bigint = await studioContract.getAgentId(wallet.address);

  if (existingId > 0n) {
    return { agentId: existingId, alreadyRegistered: true };
  }

  // Step 1: Register in IdentityRegistry
  console.log('\n  On-chain agent registration:');
  const identityContract = new ethers.Contract(IDENTITY_REGISTRY, IDENTITY_ABI, wallet);
  const uri = `chaoschain://engineering-agent/gateway-signer/${Date.now()}`;
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

  // Step 2: Register in Studio as WORKER with stake
  const studioWithSigner = new ethers.Contract(STUDIO_ADDRESS, STUDIO_ABI, wallet);
  const studioRegTx = await studioWithSigner.registerAgent(agentId, ROLE_WORKER, { value: STAKE });
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
  try {
    json = JSON.parse(text);
  } catch {
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
      console.log(`  📍 ${wf.step} (${wf.state})`);
      lastStep = stepInfo;
    }

    if (wf.state === 'STALLED') {
      console.log(`     Stall reason: ${wf.error?.message ?? 'unknown'}`);
    }

    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Workflow ${id} did not complete within ${timeoutMs / 1000}s`);
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  if (!SIGNER_KEY) {
    console.error('Missing SIGNER_PRIVATE_KEY env var.');
    console.error('Usage:');
    console.error('  SIGNER_PRIVATE_KEY=0x... GATEWAY_URL=http://127.0.0.1:3000 \\');
    console.error('  npx tsx scripts/seed-via-gateway.ts https://github.com/owner/repo/pull/123');
    process.exit(1);
  }

  // ─── Connect to chain ────────────────────────────────────────────────────
  const provider = new JsonRpcProvider(RPC_URL);
  const wallet = new Wallet(SIGNER_KEY, provider);
  const signerAddress = wallet.address.toLowerCase();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ChaosChain — Full Pipeline: Real PR → Gateway → On-chain');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Gateway:  ${GATEWAY_URL}`);
  console.log(`RPC:      ${RPC_URL.replace(/\/v2\/.*/, '/v2/...')}`);
  console.log(`Signer:   ${wallet.address}`);
  console.log(`Studio:   ${STUDIO_ADDRESS}`);

  // ─── Pre-flight checks ──────────────────────────────────────────────────
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);

  if (balance < MIN_BALANCE) {
    console.error(`\n✗ Insufficient balance. Need at least ${ethers.formatEther(MIN_BALANCE)} ETH.`);
    process.exit(1);
  }

  try {
    const health = await gatewayGet('/health');
    console.log(`Gateway:  ${health.status === 'ok' ? '✓ healthy' : '✗ ' + JSON.stringify(health)}`);
  } catch (err) {
    console.error(`\n✗ Cannot reach gateway at ${GATEWAY_URL}: ${(err as Error).message}`);
    process.exit(1);
  }

  // ─── Fetch PR ──────────────────────────────────────────────────────────
  const urlArg = process.argv[2];
  let pr: PRData;

  if (urlArg) {
    const { owner, repo, number } = parsePRUrl(urlArg);
    console.log(`\nFetching PR: ${owner}/${repo}#${number}...`);
    try {
      pr = await fetchPRFromGitHub(owner, repo, number);
      console.log(`  ✓ ${pr.commits.length} commits, ${pr.changed_files} files`);
    } catch (err) {
      console.log(`  ✗ GitHub API failed: ${(err as Error).message}`);
      console.log('  → Using bundled snapshot');
      pr = loadFallbackSnapshot();
    }
  } else {
    console.log('\nNo PR URL provided — using bundled snapshot.');
    pr = loadFallbackSnapshot();
  }

  // ─── Print commit graph ────────────────────────────────────────────────
  console.log(`\nPR:      ${pr.repo}/pull/${pr.number}`);
  console.log(`Title:   ${pr.title}`);
  console.log(`Author:  ${pr.author}`);
  console.log(`Commits: ${pr.commits.length} | Files: ${pr.changed_files}`);
  console.log('');
  console.log('Commit Graph:');
  for (const c of pr.commits) {
    const tag = c.parents_in_pr.length === 0 ? 'ROOT' : 'INTEGRATION';
    const refs = c.parents_in_pr.length > 0 ? ` (refs: ${c.parents_in_pr.join(', ')})` : '';
    console.log(`  [${tag}] ${c.sha} — ${c.message}${refs}`);
  }

  // ─── Build evidence + DKG ──────────────────────────────────────────────
  const evidence = buildEvidencePackages(pr, signerAddress);
  const dkgResult = computeDKG(evidence);
  const { thread_root, evidence_root } = dkgResult;
  const dataHash = keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['address', 'uint64', 'bytes32', 'bytes32'],
      [STUDIO_ADDRESS, EPOCH, thread_root, evidence_root],
    ),
  );

  console.log(`\nDKG: thread_root=${thread_root.slice(0, 18)}... evidence_root=${evidence_root.slice(0, 18)}...`);

  // ─── Phase 1: On-chain agent registration ──────────────────────────────
  console.log('\n── Phase 1: Agent Registration ──');
  const { agentId, alreadyRegistered } = await ensureAgentRegistered(wallet, provider);
  if (alreadyRegistered) {
    console.log(`  ✓ Agent already registered (agentId: ${agentId})`);
  } else {
    console.log(`  ✓ Agent registered with agentId: ${agentId}`);
  }

  // ─── Phase 2: Submit work through gateway ──────────────────────────────
  console.log('\n── Phase 2: Gateway Workflow Submission ──');
  const evidenceContent = Buffer.from(JSON.stringify({
    pr: { repo: pr.repo, number: pr.number, title: pr.title, author: pr.author },
    commits: pr.commits,
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

  console.log(`  ✓ Workflow created: ${workResult.id}`);
  console.log('  Polling for completion...');

  try {
    const completed = await pollWorkflow(workResult.id);
    console.log(`  ✓ Workflow COMPLETED`);

    if (completed.progress?.onchain_tx_hash) {
      console.log(`\n  Work TX:     https://sepolia.etherscan.io/tx/${completed.progress.onchain_tx_hash}`);
    }
    if (completed.progress?.register_tx_hash) {
      console.log(`  Register TX: https://sepolia.etherscan.io/tx/${completed.progress.register_tx_hash}`);
    }
  } catch (err) {
    console.log(`  ⚠ ${(err as Error).message}`);
  }

  // ─── Phase 3: Verify public API ──────────────────────────────────────
  console.log('\n── Phase 3: Verify Public API ──');
  const studioWork = await gatewayGet(`/v1/studio/${STUDIO_ADDRESS}/work`);
  const workItems = studioWork.data?.work ?? [];
  console.log(`  Work items for studio: ${workItems.length}`);

  if (workItems.length > 0) {
    for (const item of workItems) {
      console.log(`    - epoch ${item.epoch}: ${item.work_id?.slice(0, 14)}... (agent ${item.agent_id})`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VA teams can now query:');
  console.log(`  GET ${GATEWAY_URL}/v1/studio/${STUDIO_ADDRESS}/work`);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error(`\n✗ Failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
