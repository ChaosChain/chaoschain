/**
 * System Test Harness
 * 
 * Provides infrastructure for end-to-end system tests across:
 * - Local Ethereum chain (Anvil)
 * - Deployed contracts (mocks + ChaosChain)
 * - Gateway instance
 * - SDK clients (simulated via GatewayClient)
 * 
 * INVARIANTS UNDER TEST:
 * 1. Contracts are authoritative
 * 2. Gateway execution matches on-chain semantics
 * 3. SDK reflects Gateway + chain truth only
 */

import { ethers, Wallet, Contract, Provider, JsonRpcProvider, parseEther, keccak256, toUtf8Bytes, AbiCoder } from 'ethers';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

export interface TestContracts {
  identityRegistry: Contract;
  reputationRegistry: Contract;
  chaosCore: Contract;
  studioFactory: Contract;
  rewardsDistributor: Contract;
}

export interface TestWallets {
  deployer: Wallet;
  client: Wallet;
  worker1: Wallet;
  worker2: Wallet;
  validator1: Wallet;
  validator2: Wallet;
}

export interface TestStudio {
  address: string;
  name: string;
  epoch: number;
}

export interface SystemTestContext {
  provider: JsonRpcProvider;
  contracts: TestContracts;
  wallets: TestWallets;
  studio: TestStudio | null;
  chainId: number;
}

// ============================================================================
// Mock ERC-8004 Contracts (minimal implementation for testing)
// ============================================================================

const MOCK_IDENTITY_REGISTRY_BYTECODE = `
  // Minimal mock - stores agent IDs
  // registerAgent(string name, string domain) returns (uint256 agentId)
  // getAgentId(address) returns (uint256)
`;

const MOCK_IDENTITY_REGISTRY_ABI = [
  {
    "inputs": [{"name": "name", "type": "string"}, {"name": "domain", "type": "string"}],
    "name": "registerAgent",
    "outputs": [{"name": "agentId", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "agent", "type": "address"}],
    "name": "getAgentId",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "agentId", "type": "uint256"}, {"name": "key", "type": "string"}],
    "name": "getMetadata",
    "outputs": [{"name": "", "type": "string"}],
    "stateMutability": "view",
    "type": "function"
  }
];

const MOCK_REPUTATION_REGISTRY_ABI = [
  {
    "inputs": [
      {"name": "fromId", "type": "uint256"},
      {"name": "toId", "type": "uint256"},
      {"name": "score", "type": "uint64"},
      {"name": "feedbackUri", "type": "string"},
      {"name": "tag1", "type": "string"},
      {"name": "tag2", "type": "string"},
      {"name": "endpoint", "type": "string"}
    ],
    "name": "giveFeedback",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// ============================================================================
// Studio Proxy ABI (minimal for testing)
// ============================================================================

const STUDIO_PROXY_ABI = [
  {
    "inputs": [
      {"name": "dataHash", "type": "bytes32"},
      {"name": "threadRoot", "type": "bytes32"},
      {"name": "evidenceRoot", "type": "bytes32"}
    ],
    "name": "submitWork",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "dataHash", "type": "bytes32"},
      {"name": "threadRoot", "type": "bytes32"},
      {"name": "evidenceRoot", "type": "bytes32"},
      {"name": "participants", "type": "address[]"},
      {"name": "weights", "type": "uint16[]"},
      {"name": "evidenceCid", "type": "string"}
    ],
    "name": "submitWorkMultiAgent",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "commitment", "type": "bytes32"}],
    "name": "commitScore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "dataHash", "type": "bytes32"},
      {"name": "scores", "type": "uint16[]"},
      {"name": "salt", "type": "bytes32"}
    ],
    "name": "revealScore",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "currentEpoch",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{"name": "epoch", "type": "uint256"}],
    "name": "isEpochClosed",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "epoch", "type": "uint256"},
      {"name": "dataHash", "type": "bytes32"}
    ],
    "name": "workSubmissionExists",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "epoch", "type": "uint256"},
      {"name": "validator", "type": "address"}
    ],
    "name": "commitExists",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {"name": "epoch", "type": "uint256"},
      {"name": "validator", "type": "address"}
    ],
    "name": "revealExists",
    "outputs": [{"name": "", "type": "bool"}],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "closeEpoch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "worker", "type": "address"}],
    "name": "registerWorker",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "validator", "type": "address"}],
    "name": "registerValidator",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "fundStudio",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
];

// ============================================================================
// Mock Contract Factory (in-memory for testing)
// ============================================================================

/**
 * Creates a mock Identity Registry for testing.
 * Real contracts would be deployed via Foundry.
 */
export class MockIdentityRegistry {
  private agents: Map<string, number> = new Map();
  private nextAgentId = 1;
  private metadata: Map<string, Map<string, string>> = new Map();

  registerAgent(address: string, _name: string, _domain: string): number {
    const addr = address.toLowerCase();
    if (!this.agents.has(addr)) {
      this.agents.set(addr, this.nextAgentId++);
      this.metadata.set(addr, new Map());
    }
    return this.agents.get(addr)!;
  }

  getAgentId(address: string): number {
    return this.agents.get(address.toLowerCase()) || 0;
  }

  setMetadata(address: string, key: string, value: string): void {
    const addr = address.toLowerCase();
    if (!this.metadata.has(addr)) {
      this.metadata.set(addr, new Map());
    }
    this.metadata.get(addr)!.set(key, value);
  }

  getMetadata(address: string, key: string): string {
    return this.metadata.get(address.toLowerCase())?.get(key) || '';
  }
}

/**
 * Creates a mock Reputation Registry for testing.
 */
export class MockReputationRegistry {
  private feedback: Array<{
    fromId: number;
    toId: number;
    score: number;
    uri: string;
    tag1: string;
    tag2: string;
    endpoint: string;
  }> = [];

  giveFeedback(
    fromId: number,
    toId: number,
    score: number,
    uri: string,
    tag1: string,
    tag2: string,
    endpoint: string
  ): void {
    this.feedback.push({ fromId, toId, score, uri, tag1, tag2, endpoint });
  }

  getAllFeedback() {
    return [...this.feedback];
  }
}

// ============================================================================
// Mock Studio (In-Memory State Machine)
// ============================================================================

export class MockStudio {
  public address: string;
  public name: string;
  public currentEpoch: number = 1;
  public balance: bigint = 0n;
  
  private workers: Set<string> = new Set();
  private validators: Set<string> = new Set();
  private workSubmissions: Map<string, Map<string, boolean>> = new Map(); // epoch -> dataHash -> exists
  private scoreCommits: Map<string, Map<string, string>> = new Map(); // epoch -> validator -> commitment
  private scoreReveals: Map<string, Map<string, number[]>> = new Map(); // epoch -> validator -> scores
  private closedEpochs: Set<number> = new Set();

  constructor(address: string, name: string) {
    this.address = address;
    this.name = name;
  }

  registerWorker(worker: string): void {
    this.workers.add(worker.toLowerCase());
  }

  registerValidator(validator: string): void {
    this.validators.add(validator.toLowerCase());
  }

  fundStudio(amount: bigint): void {
    this.balance += amount;
  }

  submitWork(dataHash: string, _threadRoot: string, _evidenceRoot: string, from: string): void {
    if (!this.workers.has(from.toLowerCase())) {
      throw new Error('Not a registered worker');
    }
    if (this.closedEpochs.has(this.currentEpoch)) {
      throw new Error('Epoch already closed');
    }
    
    const epochKey = this.currentEpoch.toString();
    if (!this.workSubmissions.has(epochKey)) {
      this.workSubmissions.set(epochKey, new Map());
    }
    
    if (this.workSubmissions.get(epochKey)!.has(dataHash)) {
      throw new Error('Work already submitted');
    }
    
    this.workSubmissions.get(epochKey)!.set(dataHash, true);
  }

  workSubmissionExists(epoch: number, dataHash: string): boolean {
    return this.workSubmissions.get(epoch.toString())?.has(dataHash) || false;
  }

  commitScore(commitment: string, from: string): void {
    if (!this.validators.has(from.toLowerCase())) {
      throw new Error('Not a registered validator');
    }
    if (this.closedEpochs.has(this.currentEpoch)) {
      throw new Error('Epoch already closed');
    }
    
    const epochKey = this.currentEpoch.toString();
    if (!this.scoreCommits.has(epochKey)) {
      this.scoreCommits.set(epochKey, new Map());
    }
    
    if (this.scoreCommits.get(epochKey)!.has(from.toLowerCase())) {
      throw new Error('Already committed');
    }
    
    this.scoreCommits.get(epochKey)!.set(from.toLowerCase(), commitment);
  }

  commitExists(epoch: number, validator: string): boolean {
    return this.scoreCommits.get(epoch.toString())?.has(validator.toLowerCase()) || false;
  }

  revealScore(dataHash: string, scores: number[], salt: string, from: string): void {
    if (!this.validators.has(from.toLowerCase())) {
      throw new Error('Not a registered validator');
    }
    
    const epochKey = this.currentEpoch.toString();
    const commitment = this.scoreCommits.get(epochKey)?.get(from.toLowerCase());
    if (!commitment) {
      throw new Error('No commitment found');
    }
    
    // Verify commitment (simplified - real contract would hash properly)
    const expectedCommitment = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ['bytes32', 'uint16[]', 'bytes32'],
        [dataHash, scores, salt]
      )
    );
    
    if (commitment !== expectedCommitment) {
      throw new Error('Invalid commitment');
    }
    
    if (!this.scoreReveals.has(epochKey)) {
      this.scoreReveals.set(epochKey, new Map());
    }
    this.scoreReveals.get(epochKey)!.set(from.toLowerCase(), scores);
  }

  revealExists(epoch: number, validator: string): boolean {
    return this.scoreReveals.get(epoch.toString())?.has(validator.toLowerCase()) || false;
  }

  closeEpoch(): void {
    if (this.closedEpochs.has(this.currentEpoch)) {
      throw new Error('Epoch already closed');
    }
    
    // Check preconditions
    const epochKey = this.currentEpoch.toString();
    const hasWork = this.workSubmissions.has(epochKey) && this.workSubmissions.get(epochKey)!.size > 0;
    const hasScores = this.scoreReveals.has(epochKey) && this.scoreReveals.get(epochKey)!.size > 0;
    
    if (!hasWork) {
      throw new Error('No work submissions');
    }
    if (!hasScores) {
      throw new Error('No score reveals');
    }
    
    this.closedEpochs.add(this.currentEpoch);
    this.currentEpoch++;
  }

  isEpochClosed(epoch: number): boolean {
    return this.closedEpochs.has(epoch);
  }
}

// ============================================================================
// Test Wallet Generator
// ============================================================================

export function generateTestWallets(provider: Provider): TestWallets {
  // Use deterministic private keys for reproducible tests
  const seeds = {
    deployer: '0x' + '1'.repeat(64),
    client: '0x' + '2'.repeat(64),
    worker1: '0x' + '3'.repeat(64),
    worker2: '0x' + '4'.repeat(64),
    validator1: '0x' + '5'.repeat(64),
    validator2: '0x' + '6'.repeat(64),
  };

  return {
    deployer: new Wallet(seeds.deployer, provider),
    client: new Wallet(seeds.client, provider),
    worker1: new Wallet(seeds.worker1, provider),
    worker2: new Wallet(seeds.worker2, provider),
    validator1: new Wallet(seeds.validator1, provider),
    validator2: new Wallet(seeds.validator2, provider),
  };
}

// ============================================================================
// Test Data Generators
// ============================================================================

export function generateDataHash(content: string): string {
  return keccak256(toUtf8Bytes(content));
}

export function generateThreadRoot(messages: string[]): string {
  return keccak256(toUtf8Bytes(messages.join('|')));
}

export function generateEvidenceRoot(evidence: string): string {
  return keccak256(toUtf8Bytes(evidence));
}

export function generateDkgEvidence(
  author: string,
  messages: string[] = ['msg'],
): Array<{ arweave_tx_id: string; author: string; timestamp: number; parent_ids: string[]; payload_hash: string; artifact_ids: string[]; signature: string }> {
  return messages.map((msg, i) => ({
    arweave_tx_id: `ar-${keccak256(toUtf8Bytes(msg + author + i)).slice(2, 18)}`,
    author,
    timestamp: 1000 + i,
    parent_ids: i > 0 ? [`ar-${keccak256(toUtf8Bytes(messages[i - 1] + author + (i - 1))).slice(2, 18)}`] : [],
    payload_hash: keccak256(toUtf8Bytes(msg)),
    artifact_ids: [],
    signature: '0x' + '00'.repeat(65),
  }));
}

export function generateSalt(): string {
  return '0x' + [...Array(64)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
}

export function generateScores(): number[] {
  // 5 dimensions, each 0-10000 (basis points)
  return [
    Math.floor(Math.random() * 2000) + 7000, // Quality: 70-90%
    Math.floor(Math.random() * 2000) + 6000, // Initiative: 60-80%
    Math.floor(Math.random() * 2000) + 7500, // Collaboration: 75-95%
    Math.floor(Math.random() * 2000) + 5500, // Reasoning: 55-75%
    Math.floor(Math.random() * 2000) + 8000, // Compliance: 80-100%
  ];
}

export function computeScoreCommitment(dataHash: string, scores: number[], salt: string): string {
  return keccak256(
    AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint16[]', 'bytes32'],
      [dataHash, scores, salt]
    )
  );
}

// ============================================================================
// Simulated Gateway Client (for SDK simulation)
// ============================================================================

export interface SimulatedWorkflow {
  id: string;
  type: 'WorkSubmission' | 'ScoreSubmission' | 'CloseEpoch';
  state: 'CREATED' | 'RUNNING' | 'STALLED' | 'COMPLETED' | 'FAILED';
  step: string;
  input: Record<string, unknown>;
  progress: Record<string, unknown>;
  error?: { step: string; message: string; code?: string };
  signer: string;
}

/**
 * Simulates Gateway behavior for system testing.
 * In real tests, this would connect to a running Gateway instance.
 */
export class SimulatedGateway {
  private workflows: Map<string, SimulatedWorkflow> = new Map();
  private studio: MockStudio;
  public crashSimulation: boolean = false;
  public failureInjection: { step: string; type: 'STALLED' | 'FAILED' } | null = null;

  constructor(studio: MockStudio) {
    this.studio = studio;
  }

  // Create workflows
  createWorkSubmission(input: {
    studio_address: string;
    epoch: number;
    agent_address: string;
    data_hash: string;
    dkg_evidence: Array<{ arweave_tx_id: string; author: string; timestamp: number; parent_ids: string[]; payload_hash: string; artifact_ids: string[]; signature: string }>;
    signer_address: string;
  }): SimulatedWorkflow {
    const workflow: SimulatedWorkflow = {
      id: uuidv4(),
      type: 'WorkSubmission',
      state: 'CREATED',
      step: 'COMPUTE_DKG',
      input,
      progress: {},
      signer: input.signer_address,
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  createScoreSubmission(input: {
    studio_address: string;
    epoch: number;
    validator_address: string;
    data_hash: string;
    scores: number[];
    salt: string;
    signer_address: string;
  }): SimulatedWorkflow {
    const workflow: SimulatedWorkflow = {
      id: uuidv4(),
      type: 'ScoreSubmission',
      state: 'CREATED',
      step: 'COMMIT_SCORE',
      input,
      progress: {},
      signer: input.signer_address,
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  createCloseEpoch(input: {
    studio_address: string;
    epoch: number;
    signer_address: string;
  }): SimulatedWorkflow {
    const workflow: SimulatedWorkflow = {
      id: uuidv4(),
      type: 'CloseEpoch',
      state: 'CREATED',
      step: 'CHECK_PRECONDITIONS',
      input,
      progress: {},
      signer: input.signer_address,
    };
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  getWorkflow(id: string): SimulatedWorkflow | undefined {
    return this.workflows.get(id);
  }

  // Execute workflow steps
  async executeWorkflow(id: string): Promise<SimulatedWorkflow> {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);

    workflow.state = 'RUNNING';

    try {
      switch (workflow.type) {
        case 'WorkSubmission':
          await this.executeWorkSubmission(workflow);
          break;
        case 'ScoreSubmission':
          await this.executeScoreSubmission(workflow);
          break;
        case 'CloseEpoch':
          await this.executeCloseEpoch(workflow);
          break;
      }
    } catch (error) {
      const isContractRevert = error instanceof Error && 
        (error.message.includes('revert') || error.message.includes('Not a registered') ||
         error.message.includes('already') || error.message.includes('No ') ||
         error.message.includes('Already') || error.message.includes('Invalid commitment'));
      
      if (isContractRevert) {
        workflow.state = 'FAILED';
        workflow.error = {
          step: workflow.step,
          message: error instanceof Error ? error.message : String(error),
          code: 'REVERT',
        };
      } else {
        workflow.state = 'STALLED';
        workflow.error = {
          step: workflow.step,
          message: error instanceof Error ? error.message : String(error),
          code: 'INFRA',
        };
      }
    }

    return workflow;
  }

  private async executeWorkSubmission(workflow: SimulatedWorkflow): Promise<void> {
    const input = workflow.input as {
      agent_address: string;
      data_hash: string;
      dkg_evidence: Array<{ arweave_tx_id: string }>;
    };

    // Step 0: Compute DKG (simulated)
    workflow.step = 'COMPUTE_DKG';
    if (this.shouldFail('COMPUTE_DKG')) return;
    const mockThreadRoot = keccak256(toUtf8Bytes('thread-' + workflow.id));
    const mockEvidenceRoot = keccak256(toUtf8Bytes('evidence-' + workflow.id));
    workflow.progress = {
      ...workflow.progress,
      dkg_thread_root: mockThreadRoot,
      dkg_evidence_root: mockEvidenceRoot,
      dkg_weights: { [input.agent_address]: 1.0 },
    };

    // Step 1: Store evidence
    workflow.step = 'STORE_EVIDENCE';
    if (this.shouldFail('STORE_EVIDENCE')) return;
    if (this.crashSimulation) throw new Error('Gateway crashed');
    workflow.progress = { ...workflow.progress, arweave_tx_id: 'ar-' + uuidv4().slice(0, 8) };

    // Step 2: Await evidence confirm
    workflow.step = 'AWAIT_EVIDENCE_CONFIRM';
    if (this.shouldFail('AWAIT_EVIDENCE_CONFIRM')) return;
    workflow.progress = { ...workflow.progress, arweave_confirmed: true };

    // Step 3: Submit on-chain (uses DKG-computed roots from progress)
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    if (this.shouldFail('SUBMIT_WORK_ONCHAIN')) return;
    
    this.studio.submitWork(
      input.data_hash,
      mockThreadRoot,
      mockEvidenceRoot,
      input.agent_address
    );
    
    workflow.progress = { ...workflow.progress, onchain_tx_hash: '0x' + uuidv4().replace(/-/g, '') };

    // Step 4: Await tx confirm
    workflow.step = 'AWAIT_TX_CONFIRM';
    if (this.shouldFail('AWAIT_TX_CONFIRM')) return;
    workflow.progress = { ...workflow.progress, onchain_confirmed: true, onchain_block: 12345 };

    // Complete
    workflow.step = 'COMPLETED';
    workflow.state = 'COMPLETED';
  }

  private async executeScoreSubmission(workflow: SimulatedWorkflow): Promise<void> {
    const input = workflow.input as {
      validator_address: string;
      data_hash: string;
      scores: number[];
      salt: string;
    };

    // Step 1: Commit score
    workflow.step = 'COMMIT_SCORE';
    if (this.shouldFail('COMMIT_SCORE')) return;
    
    const commitment = computeScoreCommitment(input.data_hash, input.scores, input.salt);
    this.studio.commitScore(commitment, input.validator_address);
    
    workflow.progress = { ...workflow.progress, commit_tx_hash: '0x' + uuidv4().replace(/-/g, '') };

    // Step 2: Await commit confirm
    workflow.step = 'AWAIT_COMMIT_CONFIRM';
    if (this.shouldFail('AWAIT_COMMIT_CONFIRM')) return;

    // Step 3: Reveal score
    workflow.step = 'REVEAL_SCORE';
    if (this.shouldFail('REVEAL_SCORE')) return;
    
    this.studio.revealScore(input.data_hash, input.scores, input.salt, input.validator_address);
    
    workflow.progress = { ...workflow.progress, reveal_tx_hash: '0x' + uuidv4().replace(/-/g, '') };

    // Step 4: Await reveal confirm
    workflow.step = 'AWAIT_REVEAL_CONFIRM';
    if (this.shouldFail('AWAIT_REVEAL_CONFIRM')) return;
    workflow.progress = { ...workflow.progress, onchain_confirmed: true };

    // Complete
    workflow.step = 'COMPLETED';
    workflow.state = 'COMPLETED';
  }

  private async executeCloseEpoch(workflow: SimulatedWorkflow): Promise<void> {
    const input = workflow.input as { epoch: number };

    // Step 1: Check preconditions
    workflow.step = 'CHECK_PRECONDITIONS';
    if (this.shouldFail('CHECK_PRECONDITIONS')) return;
    
    if (this.studio.isEpochClosed(input.epoch)) {
      throw new Error('Epoch already closed');
    }

    // Step 2: Submit close epoch
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    if (this.shouldFail('SUBMIT_CLOSE_EPOCH')) return;
    
    this.studio.closeEpoch();
    
    workflow.progress = { ...workflow.progress, onchain_tx_hash: '0x' + uuidv4().replace(/-/g, '') };

    // Step 3: Await tx confirm
    workflow.step = 'AWAIT_TX_CONFIRM';
    if (this.shouldFail('AWAIT_TX_CONFIRM')) return;
    workflow.progress = { ...workflow.progress, onchain_confirmed: true, onchain_block: 12346 };

    // Complete
    workflow.step = 'COMPLETED';
    workflow.state = 'COMPLETED';
  }

  private shouldFail(step: string): boolean {
    if (this.failureInjection && this.failureInjection.step === step) {
      const workflow = [...this.workflows.values()].find(w => w.step === step && w.state === 'RUNNING');
      if (workflow) {
        workflow.state = this.failureInjection.type;
        workflow.error = {
          step,
          message: `Injected ${this.failureInjection.type} at ${step}`,
          code: this.failureInjection.type === 'FAILED' ? 'REVERT' : 'INFRA',
        };
        return true;
      }
    }
    return false;
  }

  // Resume stalled workflow
  async resumeWorkflow(id: string): Promise<SimulatedWorkflow> {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new Error(`Workflow ${id} not found`);
    if (workflow.state !== 'STALLED') throw new Error('Can only resume STALLED workflows');

    // Clear failure injection and crash simulation
    this.failureInjection = null;
    this.crashSimulation = false;
    
    workflow.state = 'RUNNING';
    return this.executeWorkflow(id);
  }
}

// ============================================================================
// SDK Client Simulator
// ============================================================================

export class SDKClientSimulator {
  private gateway: SimulatedGateway;
  private clientId: string;

  constructor(gateway: SimulatedGateway, clientId: string) {
    this.gateway = gateway;
    this.clientId = clientId;
  }

  get id(): string {
    return this.clientId;
  }

  async submitWork(params: {
    studio_address: string;
    epoch: number;
    agent_address: string;
    data_hash: string;
    dkg_evidence: Array<{ arweave_tx_id: string; author: string; timestamp: number; parent_ids: string[]; payload_hash: string; artifact_ids: string[]; signature: string }>;
    signer_address: string;
  }): Promise<SimulatedWorkflow> {
    const workflow = this.gateway.createWorkSubmission(params);
    return this.gateway.executeWorkflow(workflow.id);
  }

  async submitScore(params: {
    studio_address: string;
    epoch: number;
    validator_address: string;
    data_hash: string;
    scores: number[];
    salt: string;
    signer_address: string;
  }): Promise<SimulatedWorkflow> {
    const workflow = this.gateway.createScoreSubmission(params);
    return this.gateway.executeWorkflow(workflow.id);
  }

  async closeEpoch(params: {
    studio_address: string;
    epoch: number;
    signer_address: string;
  }): Promise<SimulatedWorkflow> {
    const workflow = this.gateway.createCloseEpoch(params);
    return this.gateway.executeWorkflow(workflow.id);
  }

  getWorkflow(id: string): SimulatedWorkflow | undefined {
    return this.gateway.getWorkflow(id);
  }
}

// ============================================================================
// Test Context Factory
// ============================================================================

export function createTestContext(): {
  studio: MockStudio;
  gateway: SimulatedGateway;
  identityRegistry: MockIdentityRegistry;
  reputationRegistry: MockReputationRegistry;
  wallets: {
    client: string;
    worker1: string;
    worker2: string;
    validator1: string;
    validator2: string;
  };
} {
  const studio = new MockStudio('0x' + '0'.repeat(40), 'TestStudio');
  const gateway = new SimulatedGateway(studio);
  const identityRegistry = new MockIdentityRegistry();
  const reputationRegistry = new MockReputationRegistry();

  const wallets = {
    client: '0x' + '1'.repeat(40),
    worker1: '0x' + '2'.repeat(40),
    worker2: '0x' + '3'.repeat(40),
    validator1: '0x' + '4'.repeat(40),
    validator2: '0x' + '5'.repeat(40),
  };

  // Register workers and validators
  studio.registerWorker(wallets.worker1);
  studio.registerWorker(wallets.worker2);
  studio.registerValidator(wallets.validator1);
  studio.registerValidator(wallets.validator2);

  // Register identities
  identityRegistry.registerAgent(wallets.worker1, 'Worker1', 'worker1.test');
  identityRegistry.registerAgent(wallets.worker2, 'Worker2', 'worker2.test');
  identityRegistry.registerAgent(wallets.validator1, 'Validator1', 'validator1.test');
  identityRegistry.registerAgent(wallets.validator2, 'Validator2', 'validator2.test');

  return {
    studio,
    gateway,
    identityRegistry,
    reputationRegistry,
    wallets,
  };
}
