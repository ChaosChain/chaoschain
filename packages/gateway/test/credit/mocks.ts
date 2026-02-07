/**
 * Mock implementations for Credit Executor stress testing
 * 
 * Provides controllable mocks for:
 * - 4Mica client (BLS certificate generation)
 * - Circle Gateway client (cross-chain transfers)
 * - Event generation
 */

import { BLSCertificate, NetworkId } from '../../src/services/credit/types.js';
import { 
  ExecutionPersistence, 
  CertificateBackup, 
  CreditEventEmitter,
  InMemoryPersistence,
} from '../../src/services/credit/persistence.js';
import {
  ExecutionRecord,
  ExecutionState,
  CreditIntent,
  CreditSettledEvent,
  CreditDefaultedEvent,
} from '../../src/services/credit/execution-state.js';

// ═══════════════════════════════════════════════════════════════════════════
// MOCK 4MICA CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export interface MockFourMicaConfig {
  /** Delay before responding (ms) */
  responseDelayMs?: number;
  /** Should fail on first N attempts */
  failFirstAttempts?: number;
  /** Error type to throw */
  errorType?: 'network' | 'rate_limit' | 'unauthorized' | 'custom';
  /** Custom error message */
  customError?: string;
}

export class MockFourMicaClient {
  private config: MockFourMicaConfig;
  private callCount = 0;
  private certificates: Map<string, BLSCertificate> = new Map();
  
  constructor(config: MockFourMicaConfig = {}) {
    this.config = {
      responseDelayMs: 10,
      failFirstAttempts: 0,
      ...config,
    };
  }
  
  /**
   * Request BLS certificate (mock)
   */
  async requestCreditGuarantee(
    recipientAddress: string,
    amount: bigint,
    network: NetworkId,
  ): Promise<BLSCertificate> {
    this.callCount++;
    
    // Simulate delay
    if (this.config.responseDelayMs) {
      await new Promise(r => setTimeout(r, this.config.responseDelayMs));
    }
    
    // Fail first N attempts
    if (this.callCount <= (this.config.failFirstAttempts || 0)) {
      throw this.createError();
    }
    
    // Generate deterministic certificate
    const cert: BLSCertificate = {
      claims: `0xclaims_${recipientAddress}_${amount.toString()}_${network}`,
      signature: `0xsig_${Date.now()}_${Math.random().toString(36)}`,
    };
    
    // Store for later retrieval
    const key = `${recipientAddress}_${amount.toString()}`;
    this.certificates.set(key, cert);
    
    return cert;
  }
  
  private createError(): Error {
    switch (this.config.errorType) {
      case 'network':
        return new Error('Network error: ECONNREFUSED');
      case 'rate_limit':
        return new Error('Rate limit exceeded (429)');
      case 'unauthorized':
        return new Error('Unauthorized: Invalid credentials');
      case 'custom':
        return new Error(this.config.customError || 'Custom error');
      default:
        return new Error('Service temporarily unavailable (503)');
    }
  }
  
  // Test helpers
  getCallCount(): number {
    return this.callCount;
  }
  
  getCertificate(recipientAddress: string, amount: bigint): BLSCertificate | undefined {
    return this.certificates.get(`${recipientAddress}_${amount.toString()}`);
  }
  
  reset(): void {
    this.callCount = 0;
    this.certificates.clear();
  }
  
  /** Reconfigure for different test scenarios */
  setConfig(config: Partial<MockFourMicaConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK CIRCLE GATEWAY CLIENT
// ═══════════════════════════════════════════════════════════════════════════

export interface MockCircleGatewayConfig {
  /** Delay before responding (ms) */
  responseDelayMs?: number;
  /** Should fail on first N attempts */
  failFirstAttempts?: number;
  /** Error type to simulate */
  errorType?: '502' | '429' | 'timeout' | 'insufficient_balance' | 'custom';
  /** Custom error message */
  customError?: string;
  /** Simulate random failures (percentage) */
  randomFailureRate?: number;
}

export interface MockTransferResult {
  success: boolean;
  mintTxHash?: string;
  amountMinted?: bigint;
  error?: string;
  attestation?: string;
}

export class MockCircleGatewayClient {
  private config: MockCircleGatewayConfig;
  private callCount = 0;
  private successfulTransfers: Map<string, MockTransferResult> = new Map();
  
  constructor(config: MockCircleGatewayConfig = {}) {
    this.config = {
      responseDelayMs: 50,
      failFirstAttempts: 0,
      randomFailureRate: 0,
      ...config,
    };
  }
  
  /**
   * Transfer USDC across chains (mock)
   */
  async transfer(request: {
    amount: bigint;
    sourceNetwork: NetworkId;
    destinationNetwork: NetworkId;
    recipientAddress: string;
  }): Promise<MockTransferResult> {
    this.callCount++;
    
    // Simulate delay
    if (this.config.responseDelayMs) {
      await new Promise(r => setTimeout(r, this.config.responseDelayMs));
    }
    
    // Fail first N attempts
    if (this.callCount <= (this.config.failFirstAttempts || 0)) {
      return this.createErrorResult();
    }
    
    // Random failure
    if (this.config.randomFailureRate && 
        Math.random() < this.config.randomFailureRate) {
      return this.createErrorResult();
    }
    
    // Success
    const txHash = `0xtx_${Date.now()}_${this.callCount}`;
    const result: MockTransferResult = {
      success: true,
      mintTxHash: txHash,
      amountMinted: request.amount,
      attestation: `0xattestation_${txHash}`,
    };
    
    // Store for later verification
    const key = `${request.recipientAddress}_${request.amount.toString()}`;
    this.successfulTransfers.set(key, result);
    
    return result;
  }
  
  private createErrorResult(): MockTransferResult {
    switch (this.config.errorType) {
      case '502':
        return { success: false, error: 'Bad Gateway (502)' };
      case '429':
        return { success: false, error: 'Rate limited (429)' };
      case 'timeout':
        return { success: false, error: 'Request timeout' };
      case 'insufficient_balance':
        return { success: false, error: 'Insufficient balance' };
      case 'custom':
        return { success: false, error: this.config.customError || 'Custom error' };
      default:
        return { success: false, error: 'Service temporarily unavailable (503)' };
    }
  }
  
  // Test helpers
  getCallCount(): number {
    return this.callCount;
  }
  
  getSuccessfulTransfers(): Map<string, MockTransferResult> {
    return this.successfulTransfers;
  }
  
  reset(): void {
    this.callCount = 0;
    this.successfulTransfers.clear();
  }
  
  setConfig(config: Partial<MockCircleGatewayConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK CREDIT STUDIO CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

export interface CreditApprovedEvent {
  requestId: string;
  agentId: bigint;
  approvedAmount: bigint;
  interestRateBps: bigint;
  ttlSeconds: bigint;
  transactionHash: string;
  blockNumber: number;
}

export class MockCreditStudioContract {
  private decisions: Map<string, {
    requestId: string;
    agentId: bigint;
    approvedAmount: bigint;
    interestRateBps: bigint;
    ttlSeconds: bigint;
    destinationChain: string;
    approved: boolean;
    rejectionReason: string;
    timestamp: bigint;
  }> = new Map();
  
  private completedRequests: Set<string> = new Set();
  private events: CreditApprovedEvent[] = [];
  
  /**
   * Add a credit approval (for testing)
   */
  addApproval(
    requestId: string,
    agentId: bigint,
    amount: bigint,
    interestRateBps: bigint = 500n,
    ttlSeconds: bigint = 86400n, // 24 hours
    destinationChain: string = 'eip155:11155111',
  ): void {
    this.decisions.set(requestId, {
      requestId,
      agentId,
      approvedAmount: amount,
      interestRateBps,
      ttlSeconds,
      destinationChain,
      approved: true,
      rejectionReason: '',
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    });
    
    // Add to events
    this.events.push({
      requestId,
      agentId,
      approvedAmount: amount,
      interestRateBps,
      ttlSeconds,
      transactionHash: `0xtx_${requestId}`,
      blockNumber: 1000 + this.events.length,
    });
  }
  
  /**
   * Get decision (mock)
   */
  async getDecision(requestId: string) {
    return this.decisions.get(requestId);
  }
  
  /**
   * Mark completed (mock)
   */
  async markCompleted(requestId: string) {
    this.completedRequests.add(requestId);
    return { wait: async () => ({ hash: `0xmark_${requestId}` }) };
  }
  
  /**
   * Query filter for CreditApproved events (mock)
   */
  async queryFilter(_filter: unknown, fromBlock: number, toBlock: number) {
    return this.events
      .filter(e => e.blockNumber >= fromBlock && e.blockNumber <= toBlock)
      .map(e => ({
        args: [e.requestId, e.agentId, e.approvedAmount, e.interestRateBps, e.ttlSeconds],
        transactionHash: e.transactionHash,
        blockNumber: e.blockNumber,
      }));
  }
  
  filters = {
    CreditApproved: () => 'CreditApproved',
  };
  
  // Test helpers
  isCompleted(requestId: string): boolean {
    return this.completedRequests.has(requestId);
  }
  
  getEvents(): CreditApprovedEvent[] {
    return this.events;
  }
  
  reset(): void {
    this.decisions.clear();
    this.completedRequests.clear();
    this.events.length = 0;
  }
  
  /** Emit duplicate event for testing idempotency */
  emitDuplicateEvent(requestId: string): void {
    const existing = this.events.find(e => e.requestId === requestId);
    if (existing) {
      this.events.push({
        ...existing,
        transactionHash: `0xtx_dup_${requestId}`,
        blockNumber: existing.blockNumber + 1,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK IDENTITY REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export class MockIdentityRegistry {
  private agents: Map<bigint, string> = new Map();
  
  registerAgent(agentId: bigint, address: string): void {
    this.agents.set(agentId, address);
  }
  
  async ownerOf(agentId: bigint): Promise<string> {
    return this.agents.get(agentId) || '0x0000000000000000000000000000000000000000';
  }
  
  reset(): void {
    this.agents.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST EVENT EMITTER (Captures events for assertions)
// ═══════════════════════════════════════════════════════════════════════════

export class TestEventEmitter implements CreditEventEmitter {
  public settledEvents: CreditSettledEvent[] = [];
  public defaultedEvents: CreditDefaultedEvent[] = [];
  
  async emitSettled(event: CreditSettledEvent): Promise<void> {
    this.settledEvents.push(event);
  }
  
  async emitDefaulted(event: CreditDefaultedEvent): Promise<void> {
    this.defaultedEvents.push(event);
  }
  
  reset(): void {
    this.settledEvents = [];
    this.defaultedEvents = [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST CERTIFICATE BACKUP (Captures backups for assertions)
// ═══════════════════════════════════════════════════════════════════════════

export class TestCertificateBackup implements CertificateBackup {
  public backups: Map<string, { requestId: string; certificate: BLSCertificate; arweaveId: string }> = new Map();
  
  async backup(requestId: string, certificate: BLSCertificate): Promise<string> {
    const arweaveId = `arweave_test_${requestId}`;
    this.backups.set(requestId, { requestId, certificate, arweaveId });
    return arweaveId;
  }
  
  async retrieve(arweaveId: string): Promise<BLSCertificate | null> {
    for (const backup of this.backups.values()) {
      if (backup.arweaveId === arweaveId) {
        return backup.certificate;
      }
    }
    return null;
  }
  
  reset(): void {
    this.backups.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

export class MockProvider {
  private currentBlock = 1000;
  
  async getBlockNumber(): Promise<number> {
    return this.currentBlock;
  }
  
  advanceBlocks(n: number): void {
    this.currentBlock += n;
  }
  
  setBlock(n: number): void {
    this.currentBlock = n;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Create test credit intent
// ═══════════════════════════════════════════════════════════════════════════

export function createTestIntent(
  agentId: bigint,
  amount: bigint,
  options: Partial<CreditIntent> = {},
): CreditIntent {
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds || 86400; // 24 hours default
  
  return {
    intentHash: `0xhash_${agentId}_${amount}`,
    agentId,
    amount,
    sourceChain: 'eip155:11155111',
    destinationChain: options.destinationChain || 'eip155:11155111',
    ttlSeconds,
    purpose: options.purpose || 'Test credit request',
    purposeHash: `0xpurpose_${agentId}`,
    recipientAddress: options.recipientAddress || `0xrecipient_${agentId}`,
    createdAt: now,
    expiresAt: now + ttlSeconds,
    ...options,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Create test execution record
// ═══════════════════════════════════════════════════════════════════════════

export function createTestExecutionRecord(
  requestId: string,
  state: ExecutionState,
  options: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  const intent = createTestIntent(
    options.intent?.agentId || 1n,
    options.approvedAmount || 1000000000n,
    options.intent,
  );
  
  return {
    requestId,
    intent,
    state,
    approvedAmount: options.approvedAmount || intent.amount,
    interestRateBps: options.interestRateBps || 500,
    approvedAt: options.approvedAt || Date.now(),
    transferAttempts: options.transferAttempts || 0,
    createdAt: options.createdAt || Date.now(),
    updatedAt: options.updatedAt || Date.now(),
    ...options,
  };
}
