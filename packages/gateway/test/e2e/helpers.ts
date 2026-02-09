import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Gateway URL — exposed on host port 3333
export const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3333';

// Anvil RPC — exposed on host port 8546
export const RPC_URL = process.env.RPC_URL || 'http://localhost:8546';

// Anvil deterministic accounts (addresses only — keys live in e2e/.env.anvil)
export const DEPLOYER = {
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};

export const WORKERS = [
  { address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', agentId: 1 },
  { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', agentId: 2 },
  { address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', agentId: 3 },
];

export const VALIDATORS = [
  { address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', agentId: 4 },
  { address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', agentId: 5 },
];

// Unregistered account (Anvil account 6, never registered in studio)
export const UNREGISTERED = {
  address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9',
};

export function randomDataHash(): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`e2e-${Date.now()}-${Math.random()}`));
}

export function randomRoot(): string {
  return ethers.keccak256(ethers.toUtf8Bytes(`root-${Date.now()}-${Math.random()}`));
}

export function getAddresses(): Record<string, string> {
  const addressesPath = resolve(__dirname, '../../../../e2e/addresses.json');
  const raw = readFileSync(addressesPath, 'utf-8');
  return JSON.parse(raw);
}

// ─── On-Chain Verification ────────────────────────────────────────────

const STUDIO_PROXY_ABI = [
  'function getWorkSubmitter(bytes32 dataHash) external view returns (address submitter)',
  'function getScoreVectorsForWorker(bytes32 dataHash, address worker) external view returns (address[] validators, bytes[] scoreVectors)',
];

export interface OnChainVerifier {
  getWorkSubmitter(dataHash: string): Promise<string>;
  getScoreVectorsForWorker(
    dataHash: string,
    worker: string,
  ): Promise<{ validators: string[]; scoreVectors: string[] }>;
}

export function createOnChainVerifier(studioProxyAddress: string): OnChainVerifier {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(studioProxyAddress, STUDIO_PROXY_ABI, provider);

  return {
    async getWorkSubmitter(dataHash: string): Promise<string> {
      return contract.getWorkSubmitter(dataHash);
    },
    async getScoreVectorsForWorker(
      dataHash: string,
      worker: string,
    ): Promise<{ validators: string[]; scoreVectors: string[] }> {
      const [validators, scoreVectors] = await contract.getScoreVectorsForWorker(dataHash, worker);
      return { validators: [...validators], scoreVectors: [...scoreVectors] };
    },
  };
}

export interface WorkflowResponse {
  id: string;
  type: string;
  state: string;
  step: string;
  created_at: number;
  updated_at: number;
  progress: Record<string, unknown>;
  error?: { step: string; message: string; code: string };
}

export async function postWorkflow(
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: WorkflowResponse }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

export async function getWorkflow(id: string): Promise<WorkflowResponse> {
  const res = await fetch(`${GATEWAY_URL}/workflows/${id}`);
  return res.json();
}

export async function pollUntilTerminal(
  workflowId: string,
  maxWaitMs = 90_000,
  intervalMs = 2_000,
): Promise<WorkflowResponse> {
  const start = Date.now();
  const terminalStates = ['COMPLETED', 'FAILED', 'STALLED'];

  while (Date.now() - start < maxWaitMs) {
    const wf = await getWorkflow(workflowId);
    if (terminalStates.includes(wf.state)) {
      return wf;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Workflow ${workflowId} did not reach terminal state within ${maxWaitMs}ms`);
}
