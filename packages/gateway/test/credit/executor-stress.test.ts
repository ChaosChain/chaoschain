/**
 * Credit Executor Stress Tests
 * 
 * These are SCENARIO tests, not unit tests.
 * They test the executor under realistic failure conditions.
 * 
 * Test Categories:
 * A. Restart & Replay Tests (Critical for idempotency)
 * B. Circle Failure Simulation (Retry/backoff verification)
 * C. Duplicate Event Injection (Idempotency)
 * D. TTL Expiry Path (Default flow)
 * E. Persistence Swap Test (InMemory vs PostgreSQL)
 * F. Intent ↔ Execution Binding (Audit trail)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MockFourMicaClient,
  MockCircleGatewayClient,
  MockCreditStudioContract,
  MockIdentityRegistry,
  MockProvider,
  TestEventEmitter,
  TestCertificateBackup,
  createTestIntent,
  createTestExecutionRecord,
} from './mocks.js';
import {
  InMemoryPersistence,
  ExecutionPersistence,
} from '../../src/services/credit/persistence.js';
import {
  ExecutionState,
  ExecutionRecord,
  CreditIntent,
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  isValidTransition,
} from '../../src/services/credit/execution-state.js';

// ═══════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simulated Credit Executor for testing
 * (Isolates the core logic from contract interactions)
 */
class TestableExecutor {
  public persistence: InMemoryPersistence;
  public fourMica: MockFourMicaClient;
  public circleGateway: MockCircleGatewayClient;
  public eventEmitter: TestEventEmitter;
  public certificateBackup: TestCertificateBackup;
  public creditStudio: MockCreditStudioContract;
  public identityRegistry: MockIdentityRegistry;
  public provider: MockProvider;
  
  private isRunning = false;
  private retryConfig = DEFAULT_RETRY_CONFIG;
  
  // In-flight processing lock to prevent races
  private processingLock: Set<string> = new Set();
  
  constructor() {
    this.persistence = new InMemoryPersistence();
    this.fourMica = new MockFourMicaClient();
    this.circleGateway = new MockCircleGatewayClient();
    this.eventEmitter = new TestEventEmitter();
    this.certificateBackup = new TestCertificateBackup();
    this.creditStudio = new MockCreditStudioContract();
    this.identityRegistry = new MockIdentityRegistry();
    this.provider = new MockProvider();
  }
  
  /**
   * Process a credit approval (simulates handleCreditApproved)
   */
  async processApproval(
    requestId: string,
    agentId: bigint,
    amount: bigint,
    ttlSeconds: number = 86400,
    destinationChain: string = 'eip155:11155111',
  ): Promise<void> {
    // IDEMPOTENCY CHECK 1: Already persisted?
    if (await this.persistence.exists(requestId)) {
      console.log(`[Idempotent] Request ${requestId} already exists`);
      return;
    }
    
    // IDEMPOTENCY CHECK 2: Already being processed? (in-memory lock)
    if (this.processingLock.has(requestId)) {
      console.log(`[Idempotent] Request ${requestId} already being processed`);
      return;
    }
    
    // Acquire lock
    this.processingLock.add(requestId);
    
    try {
      // Double-check after acquiring lock (another concurrent call might have saved)
      if (await this.persistence.exists(requestId)) {
        console.log(`[Idempotent] Request ${requestId} already exists (after lock)`);
        return;
      }
      
      // Create intent (THIS STORES FULL INTENT CONTEXT!)
      const intent = createTestIntent(agentId, amount, {
        ttlSeconds,
        destinationChain: destinationChain as any,
        recipientAddress: await this.identityRegistry.ownerOf(agentId),
      });
      
      // Create initial record
      const record: ExecutionRecord = {
        requestId,
        intent, // Full intent is bound to execution
        state: ExecutionState.APPROVED,
        approvedAmount: amount,
        interestRateBps: 500,
        approvedAt: Date.now(),
        transferAttempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      await this.persistence.save(record);
      
      // Execute the credit flow
      await this.executeCreditFlow(record);
    } finally {
      // Release lock
      this.processingLock.delete(requestId);
    }
  }
  
  /**
   * Execute the credit flow
   */
  private async executeCreditFlow(record: ExecutionRecord): Promise<void> {
    try {
      // Step 1: Get BLS certificate
      const certificate = await this.fourMica.requestCreditGuarantee(
        record.intent.recipientAddress,
        record.approvedAmount,
        record.intent.sourceChain,
      );
      
      // Persist certificate IMMEDIATELY
      const arweaveId = await this.certificateBackup.backup(record.requestId, certificate);
      
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.CERT_ISSUED,
        {
          certificate,
          certificateIssuedAt: Date.now(),
          certificateArweaveId: arweaveId,
        },
      );
      
      // Step 2: Execute transfer
      const updatedRecord = await this.persistence.get(record.requestId);
      if (!updatedRecord) throw new Error('Record disappeared');
      
      await this.executeTransfer(updatedRecord);
      
    } catch (error) {
      console.error(`Credit flow failed:`, error);
      // Will be handled by retry/expiration logic
    }
  }
  
  /**
   * Execute transfer with retry support
   */
  async executeTransfer(record: ExecutionRecord): Promise<void> {
    // Get current state
    let current = await this.persistence.get(record.requestId);
    if (!current) return;
    
    // Transition to TRANSFER_PENDING if coming from CERT_ISSUED or TRANSFER_FAILED
    if (current.state === ExecutionState.CERT_ISSUED || 
        current.state === ExecutionState.TRANSFER_FAILED) {
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.TRANSFER_PENDING,
        {
          transferAttempts: current.transferAttempts + 1,
          lastTransferAttempt: Date.now(),
        },
      );
      // Re-fetch
      current = await this.persistence.get(record.requestId);
      if (!current) return;
    }
    
    // Must be in TRANSFER_PENDING to proceed
    if (current.state !== ExecutionState.TRANSFER_PENDING) {
      return;
    }
    
    try {
      const result = await this.circleGateway.transfer({
        amount: current.approvedAmount,
        sourceNetwork: current.intent.sourceChain,
        destinationNetwork: current.intent.destinationChain,
        recipientAddress: current.intent.recipientAddress,
      });
      
      if (!result.success) {
        throw new Error(result.error || 'Transfer failed');
      }
      
      // Success!
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.COMPLETED,
        {
          transferTxHash: result.destinationTxHash,
          transferCompletedAt: Date.now(),
        },
      );
      
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // Transition to TRANSFER_FAILED (retry loop will check if retryable)
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.TRANSFER_FAILED,
        { lastTransferError: err.message },
      );
    }
  }
  
  /**
   * Run pending retries
   */
  async runRetries(): Promise<number> {
    // Get records that need processing
    const failed = await this.persistence.getPendingRetries();
    const pending = await this.persistence.getByState(ExecutionState.TRANSFER_PENDING);
    const certIssued = await this.persistence.getByState(ExecutionState.CERT_ISSUED);
    
    // Use a Set to deduplicate by requestId
    const seenIds = new Set<string>();
    const toProcess: ExecutionRecord[] = [];
    
    for (const record of [...certIssued, ...pending, ...failed]) {
      if (!seenIds.has(record.requestId)) {
        seenIds.add(record.requestId);
        toProcess.push(record);
      }
    }
    
    let retried = 0;
    
    for (const record of toProcess) {
      if (record.transferAttempts >= this.retryConfig.maxAttempts) {
        continue;
      }
      
      // Get latest state to avoid double processing
      const current = await this.persistence.get(record.requestId);
      if (!current || current.state === ExecutionState.COMPLETED) {
        continue;
      }
      
      // Check if the last error was retryable (if any)
      if (current.lastTransferError) {
        const lastErr = new Error(current.lastTransferError);
        if (!isRetryableError(lastErr)) {
          // Non-retryable error - don't retry
          continue;
        }
      }
      
      await this.executeTransfer(current);
      retried++;
    }
    
    return retried;
  }
  
  /**
   * Check for expired credits and emit defaults
   */
  async checkExpirations(): Promise<number> {
    const expired = await this.persistence.getExpired();
    let defaulted = 0;
    
    for (const record of expired) {
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.DEFAULTED,
        { defaultedAt: Date.now() },
      );
      
      await this.eventEmitter.emitDefaulted({
        requestId: record.requestId,
        agentId: record.intent.agentId,
        amount: record.approvedAmount,
        certificateClaims: record.certificate?.claims || '',
        certificateSignature: record.certificate?.signature || '',
        defaultedAt: Date.now(),
        remediationRequired: true,
      });
      
      defaulted++;
    }
    
    return defaulted;
  }
  
  /**
   * Recover in-progress executions (simulate restart)
   */
  async recoverInProgress(): Promise<void> {
    // Records in CERT_ISSUED state need to complete transfer
    const certIssued = await this.persistence.getByState(ExecutionState.CERT_ISSUED);
    for (const record of certIssued) {
      await this.persistence.transitionState(
        record.requestId,
        ExecutionState.TRANSFER_PENDING,
      );
    }
    
    // Records in TRANSFER_PENDING will be picked up by retry loop
  }
  
  /**
   * Mark credit as settled
   */
  async markSettled(requestId: string, txHash: string): Promise<void> {
    const record = await this.persistence.get(requestId);
    if (!record) throw new Error('Record not found');
    
    if (record.state !== ExecutionState.COMPLETED) {
      throw new Error(`Cannot settle from state: ${record.state}`);
    }
    
    await this.persistence.transitionState(
      requestId,
      ExecutionState.SETTLED,
      {
        settlementTxHash: txHash,
        settledAt: Date.now(),
      },
    );
    
    await this.eventEmitter.emitSettled({
      requestId,
      agentId: record.intent.agentId,
      amount: record.approvedAmount,
      interestPaid: record.approvedAmount * BigInt(record.interestRateBps) / 10000n,
      settlementTxHash: txHash,
      timestamp: Date.now(),
    });
  }
  
  reset(): void {
    this.persistence.clear();
    this.fourMica.reset();
    this.circleGateway.reset();
    this.eventEmitter.reset();
    this.certificateBackup.reset();
    this.creditStudio.reset();
    this.identityRegistry.reset();
    this.processingLock.clear();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A. RESTART & REPLAY TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('A. Restart & Replay Tests (Critical)', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1Address');
    executor.identityRegistry.registerAgent(2n, '0xAgent2Address');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  it('should resume from CERT_ISSUED state after restart', async () => {
    // Setup: Create a record stuck in CERT_ISSUED
    const record = createTestExecutionRecord('req_1', ExecutionState.CERT_ISSUED, {
      intent: createTestIntent(1n, 1000000000n),
      certificate: { claims: '0xclaims', signature: '0xsig' },
      certificateIssuedAt: Date.now(),
    });
    await executor.persistence.save(record);
    
    // Verify initial state
    expect(await executor.persistence.exists('req_1')).toBe(true);
    const initial = await executor.persistence.get('req_1');
    expect(initial?.state).toBe(ExecutionState.CERT_ISSUED);
    
    // Simulate restart recovery
    await executor.recoverInProgress();
    
    // Should transition to TRANSFER_PENDING
    const recovered = await executor.persistence.get('req_1');
    expect(recovered?.state).toBe(ExecutionState.TRANSFER_PENDING);
    
    // Run retry to complete transfer
    await executor.runRetries();
    
    // Should be COMPLETED
    const final = await executor.persistence.get('req_1');
    expect(final?.state).toBe(ExecutionState.COMPLETED);
    
    // No duplicate certificates should be issued
    expect(executor.fourMica.getCallCount()).toBe(0);
    // But transfer should be called
    expect(executor.circleGateway.getCallCount()).toBe(1);
  });
  
  it('should resume from TRANSFER_PENDING state after restart', async () => {
    const record = createTestExecutionRecord('req_2', ExecutionState.TRANSFER_PENDING, {
      intent: createTestIntent(2n, 2000000000n),
      certificate: { claims: '0xclaims2', signature: '0xsig2' },
      certificateIssuedAt: Date.now() - 5000,
      transferAttempts: 1,
      lastTransferAttempt: Date.now() - 5000,
    });
    await executor.persistence.save(record);
    
    // Run retry
    await executor.runRetries();
    
    const final = await executor.persistence.get('req_2');
    expect(final?.state).toBe(ExecutionState.COMPLETED);
    // Attempts stay at 1 because we're resuming an already-pending transfer
    // (not starting a new attempt)
    expect(final?.transferAttempts).toBe(1);
    
    // No duplicate guarantees
    expect(executor.fourMica.getCallCount()).toBe(0);
    // Single transfer completion
    expect(executor.circleGateway.getCallCount()).toBe(1);
  });
  
  it('should not create duplicate transfers on double-recovery', async () => {
    const record = createTestExecutionRecord('req_3', ExecutionState.CERT_ISSUED, {
      intent: createTestIntent(1n, 3000000000n),
      certificate: { claims: '0xc', signature: '0xs' },
    });
    await executor.persistence.save(record);
    
    // First recovery
    await executor.recoverInProgress();
    await executor.runRetries();
    
    const after1 = await executor.persistence.get('req_3');
    expect(after1?.state).toBe(ExecutionState.COMPLETED);
    
    // Simulate second recovery (e.g., another restart)
    await executor.recoverInProgress();
    await executor.runRetries();
    
    // Should still be COMPLETED, no extra calls
    const after2 = await executor.persistence.get('req_3');
    expect(after2?.state).toBe(ExecutionState.COMPLETED);
    expect(executor.circleGateway.getCallCount()).toBe(1); // Only one transfer
  });
  
  it('should preserve certificate across restarts', async () => {
    const originalCert = { claims: '0xoriginal_claims', signature: '0xoriginal_sig' };
    const record = createTestExecutionRecord('req_4', ExecutionState.CERT_ISSUED, {
      certificate: originalCert,
      certificateArweaveId: 'arweave_test_req_4',
    });
    await executor.persistence.save(record);
    
    // Simulate restart and recovery
    await executor.recoverInProgress();
    await executor.runRetries();
    
    const final = await executor.persistence.get('req_4');
    
    // Certificate should be preserved
    expect(final?.certificate).toEqual(originalCert);
    expect(final?.certificateArweaveId).toBe('arweave_test_req_4');
  });
  
  it('should handle restart during TRANSFER_FAILED state', async () => {
    const record = createTestExecutionRecord('req_5', ExecutionState.TRANSFER_FAILED, {
      intent: createTestIntent(1n, 5000000000n),
      certificate: { claims: '0xc5', signature: '0xs5' },
      transferAttempts: 2,
      lastTransferError: 'Previous failure',
    });
    await executor.persistence.save(record);
    
    // Should be picked up by retry
    await executor.runRetries();
    
    const final = await executor.persistence.get('req_5');
    expect(final?.state).toBe(ExecutionState.COMPLETED);
    expect(final?.transferAttempts).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. CIRCLE FAILURE SIMULATION
// ═══════════════════════════════════════════════════════════════════════════

describe('B. Circle Failure Simulation', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  describe('502 Bad Gateway errors', () => {
    it('should retry on 502 errors', async () => {
      // Configure to fail first 2 attempts with 502
      executor.circleGateway.setConfig({
        failFirstAttempts: 2,
        errorType: '502',
      });
      
      // Process approval
      await executor.processApproval('req_502', 1n, 1000000000n);
      
      // First attempt fails
      let record = await executor.persistence.get('req_502');
      expect(record?.state).toBe(ExecutionState.TRANSFER_FAILED);
      expect(record?.lastTransferError).toContain('502');
      
      // Run retries until success
      await executor.runRetries(); // 2nd attempt fails
      await executor.runRetries(); // 3rd attempt succeeds
      
      record = await executor.persistence.get('req_502');
      expect(record?.state).toBe(ExecutionState.COMPLETED);
      expect(record?.transferAttempts).toBe(3);
    });
    
    it('should respect backoff delay between 502 retries', async () => {
      const delays: number[] = [];
      for (let i = 1; i <= 5; i++) {
        delays.push(calculateRetryDelay(i, DEFAULT_RETRY_CONFIG));
      }
      
      // Delays should increase exponentially (with jitter)
      expect(delays[1]).toBeGreaterThan(delays[0]);
      expect(delays[2]).toBeGreaterThan(delays[1]);
      expect(delays[3]).toBeGreaterThan(delays[2]);
      
      // Should be capped at max delay
      expect(delays[4]).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxDelayMs * 1.2);
    });
  });
  
  describe('429 Rate Limit errors', () => {
    it('should retry on 429 rate limit', async () => {
      executor.circleGateway.setConfig({
        failFirstAttempts: 1,
        errorType: '429',
      });
      
      await executor.processApproval('req_429', 1n, 1000000000n);
      
      let record = await executor.persistence.get('req_429');
      expect(record?.state).toBe(ExecutionState.TRANSFER_FAILED);
      
      await executor.runRetries();
      
      record = await executor.persistence.get('req_429');
      expect(record?.state).toBe(ExecutionState.COMPLETED);
    });
    
    it('should identify 429 as retryable error', () => {
      const error = new Error('Rate limited (429)');
      expect(isRetryableError(error)).toBe(true);
    });
  });
  
  describe('Network timeout errors', () => {
    it('should retry on timeout', async () => {
      executor.circleGateway.setConfig({
        failFirstAttempts: 2,
        errorType: 'timeout',
      });
      
      await executor.processApproval('req_timeout', 1n, 1000000000n);
      
      await executor.runRetries();
      await executor.runRetries();
      
      const record = await executor.persistence.get('req_timeout');
      expect(record?.state).toBe(ExecutionState.COMPLETED);
    });
    
    it('should identify timeout as retryable error', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });
  });
  
  describe('Non-retryable errors', () => {
    it('should NOT retry on insufficient balance', async () => {
      executor.circleGateway.setConfig({
        failFirstAttempts: 5,
        errorType: 'insufficient_balance',
      });
      
      await executor.processApproval('req_balance', 1n, 1000000000n);
      
      const record = await executor.persistence.get('req_balance');
      // Should fail but won't be in retry queue (non-retryable)
      expect(record?.state).toBe(ExecutionState.TRANSFER_FAILED);
      
      // isRetryableError should return false
      const error = new Error('Insufficient balance');
      expect(isRetryableError(error)).toBe(false);
    });
  });
  
  describe('Remediation behavior', () => {
    it('should NOT trigger remediation before TTL expiry', async () => {
      executor.circleGateway.setConfig({
        failFirstAttempts: 10, // Keep failing
        errorType: '502',
      });
      
      // Create with future expiry
      const record = createTestExecutionRecord('req_no_remediate', ExecutionState.TRANSFER_FAILED, {
        intent: createTestIntent(1n, 1000000000n, {
          ttlSeconds: 86400, // 24 hours
          expiresAt: Math.floor(Date.now() / 1000) + 86400,
        }),
        certificate: { claims: '0xc', signature: '0xs' },
        transferAttempts: 1,
      });
      await executor.persistence.save(record);
      
      // Check expirations - should find nothing
      const defaulted = await executor.checkExpirations();
      expect(defaulted).toBe(0);
      expect(executor.eventEmitter.defaultedEvents).toHaveLength(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. DUPLICATE EVENT INJECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('C. Duplicate Event Injection', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  it('should ignore duplicate CreditApproved events (same requestId)', async () => {
    // First process
    await executor.processApproval('req_dup_1', 1n, 1000000000n);
    
    const after1 = await executor.persistence.get('req_dup_1');
    expect(after1?.state).toBe(ExecutionState.COMPLETED);
    
    const callsAfter1 = executor.fourMica.getCallCount();
    const transfersAfter1 = executor.circleGateway.getCallCount();
    
    // Process same request again (duplicate event)
    await executor.processApproval('req_dup_1', 1n, 1000000000n);
    
    // Should NOT increase call counts
    expect(executor.fourMica.getCallCount()).toBe(callsAfter1);
    expect(executor.circleGateway.getCallCount()).toBe(transfersAfter1);
    
    // State should remain COMPLETED
    const after2 = await executor.persistence.get('req_dup_1');
    expect(after2?.state).toBe(ExecutionState.COMPLETED);
  });
  
  it('should handle multiple rapid duplicate events', async () => {
    // Simulate 5 duplicate events arriving rapidly
    const promises = Array(5).fill(null).map(() =>
      executor.processApproval('req_dup_rapid', 1n, 2000000000n)
    );
    
    await Promise.all(promises);
    
    // Only one execution should occur
    expect(executor.fourMica.getCallCount()).toBe(1);
    expect(executor.circleGateway.getCallCount()).toBe(1);
  });
  
  it('should handle out-of-order events gracefully', async () => {
    // Process approval first
    await executor.processApproval('req_order', 1n, 3000000000n);
    
    const completed = await executor.persistence.get('req_order');
    expect(completed?.state).toBe(ExecutionState.COMPLETED);
    
    // Try to re-process (simulating out-of-order)
    await executor.processApproval('req_order', 1n, 3000000000n);
    
    // Should remain completed, no duplicates
    expect(executor.fourMica.getCallCount()).toBe(1);
  });
  
  it('should block invalid state transitions', async () => {
    // Create a COMPLETED record
    const record = createTestExecutionRecord('req_invalid_transition', ExecutionState.COMPLETED, {
      certificate: { claims: '0xc', signature: '0xs' },
      transferTxHash: '0xtx',
    });
    await executor.persistence.save(record);
    
    // Try invalid transition: COMPLETED → CERT_ISSUED
    expect(isValidTransition(ExecutionState.COMPLETED, ExecutionState.CERT_ISSUED)).toBe(false);
    
    // Persistence should reject
    await expect(
      executor.persistence.transitionState('req_invalid_transition', ExecutionState.CERT_ISSUED)
    ).rejects.toThrow('Invalid state transition');
  });
  
  it('should allow valid state transitions only', () => {
    // Test all valid transitions
    expect(isValidTransition(ExecutionState.PENDING, ExecutionState.APPROVED)).toBe(true);
    expect(isValidTransition(ExecutionState.APPROVED, ExecutionState.CERT_ISSUED)).toBe(true);
    expect(isValidTransition(ExecutionState.CERT_ISSUED, ExecutionState.TRANSFER_PENDING)).toBe(true);
    expect(isValidTransition(ExecutionState.TRANSFER_PENDING, ExecutionState.COMPLETED)).toBe(true);
    expect(isValidTransition(ExecutionState.TRANSFER_PENDING, ExecutionState.TRANSFER_FAILED)).toBe(true);
    expect(isValidTransition(ExecutionState.TRANSFER_FAILED, ExecutionState.TRANSFER_PENDING)).toBe(true);
    expect(isValidTransition(ExecutionState.COMPLETED, ExecutionState.SETTLED)).toBe(true);
    expect(isValidTransition(ExecutionState.COMPLETED, ExecutionState.DEFAULTED)).toBe(true);
    
    // Test invalid transitions
    expect(isValidTransition(ExecutionState.SETTLED, ExecutionState.COMPLETED)).toBe(false);
    expect(isValidTransition(ExecutionState.DEFAULTED, ExecutionState.SETTLED)).toBe(false);
    expect(isValidTransition(ExecutionState.REJECTED, ExecutionState.APPROVED)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. TTL EXPIRY PATH
// ═══════════════════════════════════════════════════════════════════════════

describe('D. TTL Expiry Path', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  it('should emit CreditDefaulted when TTL expires', async () => {
    // Create an expired record
    const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const record = createTestExecutionRecord('req_expired', ExecutionState.COMPLETED, {
      intent: createTestIntent(1n, 1000000000n, {
        expiresAt: pastExpiry,
      }),
      certificate: { claims: '0xclaims_exp', signature: '0xsig_exp' },
      transferTxHash: '0xtx_exp',
    });
    await executor.persistence.save(record);
    
    // Check expirations
    const defaulted = await executor.checkExpirations();
    
    expect(defaulted).toBe(1);
    expect(executor.eventEmitter.defaultedEvents).toHaveLength(1);
    
    const event = executor.eventEmitter.defaultedEvents[0];
    expect(event.requestId).toBe('req_expired');
    expect(event.remediationRequired).toBe(true);
    expect(event.certificateClaims).toBe('0xclaims_exp');
    
    // Record should be in DEFAULTED state
    const final = await executor.persistence.get('req_expired');
    expect(final?.state).toBe(ExecutionState.DEFAULTED);
  });
  
  it('should include BLS certificate in default event for remediation', async () => {
    const certificate = { claims: '0xfull_claims_data', signature: '0xfull_signature' };
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    
    const record = createTestExecutionRecord('req_with_cert', ExecutionState.TRANSFER_FAILED, {
      intent: createTestIntent(1n, 5000000000n, { expiresAt: pastExpiry }),
      certificate,
      certificateArweaveId: 'arweave_xyz',
    });
    await executor.persistence.save(record);
    
    await executor.checkExpirations();
    
    const event = executor.eventEmitter.defaultedEvents[0];
    expect(event.certificateClaims).toBe(certificate.claims);
    expect(event.certificateSignature).toBe(certificate.signature);
  });
  
  it('should NOT retry after TTL expiry', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    const record = createTestExecutionRecord('req_no_retry_exp', ExecutionState.TRANSFER_FAILED, {
      intent: createTestIntent(1n, 1000000000n, { expiresAt: pastExpiry }),
      certificate: { claims: '0xc', signature: '0xs' },
      transferAttempts: 1,
    });
    await executor.persistence.save(record);
    
    // Run retries - should NOT pick up expired records
    const retried = await executor.runRetries();
    expect(retried).toBe(0);
    
    // Should be caught by expiration check instead
    await executor.checkExpirations();
    
    const final = await executor.persistence.get('req_no_retry_exp');
    expect(final?.state).toBe(ExecutionState.DEFAULTED);
  });
  
  it('should not default already settled credits', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    const record = createTestExecutionRecord('req_settled', ExecutionState.SETTLED, {
      intent: createTestIntent(1n, 1000000000n, { expiresAt: pastExpiry }),
      settledAt: Date.now() - 50000,
      settlementTxHash: '0xsettlement',
    });
    await executor.persistence.save(record);
    
    const defaulted = await executor.checkExpirations();
    expect(defaulted).toBe(0);
    
    const final = await executor.persistence.get('req_settled');
    expect(final?.state).toBe(ExecutionState.SETTLED);
  });
  
  it('should handle multiple expirations in batch', async () => {
    const pastExpiry = Math.floor(Date.now() / 1000) - 100;
    
    // Create 3 expired records
    for (let i = 1; i <= 3; i++) {
      const record = createTestExecutionRecord(`req_batch_exp_${i}`, ExecutionState.COMPLETED, {
        intent: createTestIntent(BigInt(i), BigInt(i * 1000000000), { expiresAt: pastExpiry }),
        certificate: { claims: `0xc${i}`, signature: `0xs${i}` },
      });
      await executor.persistence.save(record);
    }
    
    const defaulted = await executor.checkExpirations();
    expect(defaulted).toBe(3);
    expect(executor.eventEmitter.defaultedEvents).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. PERSISTENCE SWAP TEST
// ═══════════════════════════════════════════════════════════════════════════

describe('E. Persistence Swap Test', () => {
  
  // Test helper that runs the same scenario against any persistence impl
  async function runPersistenceScenario(persistence: ExecutionPersistence) {
    const intent = createTestIntent(1n, 1000000000n);
    const record: ExecutionRecord = {
      requestId: 'req_persist_test',
      intent,
      state: ExecutionState.APPROVED,
      approvedAmount: 1000000000n,
      interestRateBps: 500,
      approvedAt: Date.now(),
      transferAttempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    // Save
    await persistence.save(record);
    expect(await persistence.exists('req_persist_test')).toBe(true);
    
    // Get
    const retrieved = await persistence.get('req_persist_test');
    expect(retrieved?.requestId).toBe('req_persist_test');
    expect(retrieved?.state).toBe(ExecutionState.APPROVED);
    expect(retrieved?.intent.intentHash).toBe(intent.intentHash);
    
    // Transition state
    await persistence.transitionState('req_persist_test', ExecutionState.CERT_ISSUED, {
      certificate: { claims: '0xc', signature: '0xs' },
      certificateIssuedAt: Date.now(),
    });
    
    const afterTransition = await persistence.get('req_persist_test');
    expect(afterTransition?.state).toBe(ExecutionState.CERT_ISSUED);
    expect(afterTransition?.certificate).toBeDefined();
    
    // Get by state
    const certIssued = await persistence.getByState(ExecutionState.CERT_ISSUED);
    expect(certIssued).toHaveLength(1);
    
    // Complete and check expiry behavior
    await persistence.transitionState('req_persist_test', ExecutionState.TRANSFER_PENDING);
    await persistence.transitionState('req_persist_test', ExecutionState.COMPLETED, {
      transferTxHash: '0xtx',
    });
    
    const pendingRetries = await persistence.getPendingRetries();
    expect(pendingRetries.filter(r => r.requestId === 'req_persist_test')).toHaveLength(0);
  }
  
  it('should work correctly with InMemoryPersistence', async () => {
    const persistence = new InMemoryPersistence();
    await runPersistenceScenario(persistence);
    
    // InMemory specific: can get all
    expect(persistence.getAll().length).toBeGreaterThanOrEqual(1);
    
    // Can clear
    persistence.clear();
    expect(persistence.getAll()).toHaveLength(0);
  });
  
  // Placeholder for PostgreSQL test
  it.skip('should work correctly with PostgresPersistence', async () => {
    // TODO: Implement when PostgresPersistence is fully implemented
    // This would require a test database connection
    // const persistence = new PostgresPersistence(process.env.TEST_DATABASE_URL);
    // await runPersistenceScenario(persistence);
  });
  
  it('should handle concurrent operations correctly', async () => {
    const persistence = new InMemoryPersistence();
    
    // Create multiple records concurrently
    const promises = [];
    for (let i = 0; i < 10; i++) {
      const record = createTestExecutionRecord(`req_concurrent_${i}`, ExecutionState.APPROVED);
      promises.push(persistence.save(record));
    }
    
    await Promise.all(promises);
    
    // All should exist
    for (let i = 0; i < 10; i++) {
      expect(await persistence.exists(`req_concurrent_${i}`)).toBe(true);
    }
    
    // Transition concurrently
    const transitionPromises = [];
    for (let i = 0; i < 10; i++) {
      transitionPromises.push(
        persistence.transitionState(`req_concurrent_${i}`, ExecutionState.CERT_ISSUED)
      );
    }
    
    await Promise.all(transitionPromises);
    
    const certIssued = await persistence.getByState(ExecutionState.CERT_ISSUED);
    expect(certIssued).toHaveLength(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. INTENT ↔ EXECUTION BINDING
// ═══════════════════════════════════════════════════════════════════════════

describe('F. Intent ↔ Execution Binding', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1');
    executor.identityRegistry.registerAgent(2n, '0xAgent2');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  it('should store full intent with execution record', async () => {
    await executor.processApproval('req_intent_1', 1n, 5000000000n, 86400, 'eip155:84532');
    
    const record = await executor.persistence.get('req_intent_1');
    
    // Intent should be fully present
    expect(record?.intent).toBeDefined();
    expect(record?.intent.intentHash).toBeDefined();
    expect(record?.intent.agentId).toBe(1n);
    expect(record?.intent.amount).toBe(5000000000n);
    expect(record?.intent.ttlSeconds).toBe(86400);
    expect(record?.intent.destinationChain).toBe('eip155:84532');
    expect(record?.intent.purpose).toBeDefined();
    expect(record?.intent.purposeHash).toBeDefined();
    expect(record?.intent.recipientAddress).toBe('0xAgent1');
    expect(record?.intent.createdAt).toBeDefined();
    expect(record?.intent.expiresAt).toBeDefined();
  });
  
  it('should preserve intent through all state transitions', async () => {
    const originalIntent = createTestIntent(2n, 7500000000n, {
      purpose: 'Purchase API access',
      destinationChain: 'eip155:42161',
    });
    
    const record = createTestExecutionRecord('req_intent_persist', ExecutionState.APPROVED, {
      intent: originalIntent,
    });
    await executor.persistence.save(record);
    
    // Transition through all states
    await executor.persistence.transitionState('req_intent_persist', ExecutionState.CERT_ISSUED, {
      certificate: { claims: '0xc', signature: '0xs' },
    });
    
    let current = await executor.persistence.get('req_intent_persist');
    expect(current?.intent.purpose).toBe('Purchase API access');
    expect(current?.intent.destinationChain).toBe('eip155:42161');
    
    await executor.persistence.transitionState('req_intent_persist', ExecutionState.TRANSFER_PENDING);
    await executor.persistence.transitionState('req_intent_persist', ExecutionState.COMPLETED, {
      transferTxHash: '0xtx',
    });
    
    current = await executor.persistence.get('req_intent_persist');
    expect(current?.intent).toEqual(originalIntent);
  });
  
  it('should include intent hash for on-chain reference', async () => {
    await executor.processApproval('req_hash', 1n, 1000000000n);
    
    const record = await executor.persistence.get('req_hash');
    
    // Intent hash should be deterministic and present
    expect(record?.intent.intentHash).toBeDefined();
    expect(typeof record?.intent.intentHash).toBe('string');
    expect(record?.intent.intentHash.startsWith('0x')).toBe(true);
  });
  
  it('should make intent available for audit/disputes', async () => {
    const purpose = 'Execute high-frequency trading strategy';
    const intent = createTestIntent(1n, 10000000000n, { purpose });
    
    const record = createTestExecutionRecord('req_audit', ExecutionState.COMPLETED, {
      intent,
      certificate: { claims: '0xc', signature: '0xs' },
    });
    await executor.persistence.save(record);
    
    // Simulate audit lookup
    const auditRecord = await executor.persistence.get('req_audit');
    
    // All audit-relevant fields should be present
    expect(auditRecord?.intent.agentId).toBeDefined();
    expect(auditRecord?.intent.amount).toBeDefined();
    expect(auditRecord?.intent.purpose).toBe(purpose);
    expect(auditRecord?.intent.purposeHash).toBeDefined();
    expect(auditRecord?.intent.createdAt).toBeDefined();
    expect(auditRecord?.intent.expiresAt).toBeDefined();
    expect(auditRecord?.certificate).toBeDefined();
    expect(auditRecord?.approvedAmount).toBeDefined();
    expect(auditRecord?.interestRateBps).toBeDefined();
  });
  
  it('should support intent lookup by agent ID', async () => {
    // Create multiple records for same agent
    for (let i = 1; i <= 3; i++) {
      const record = createTestExecutionRecord(`req_agent_${i}`, ExecutionState.COMPLETED, {
        intent: createTestIntent(1n, BigInt(i * 1000000000)),
      });
      await executor.persistence.save(record);
    }
    
    // Create record for different agent
    const otherRecord = createTestExecutionRecord('req_other_agent', ExecutionState.COMPLETED, {
      intent: createTestIntent(2n, 5000000000n),
    });
    await executor.persistence.save(otherRecord);
    
    // Get all records and filter by agent
    const allRecords = executor.persistence.getAll();
    const agent1Records = allRecords.filter(r => r.intent.agentId === 1n);
    const agent2Records = allRecords.filter(r => r.intent.agentId === 2n);
    
    expect(agent1Records).toHaveLength(3);
    expect(agent2Records).toHaveLength(1);
  });
  
  it('should include certificate backup reference (Arweave)', async () => {
    const intent = createTestIntent(1n, 1000000000n);
    const certificate = { claims: '0ximportant_claims', signature: '0ximportant_sig' };
    
    // Backup certificate
    const arweaveId = await executor.certificateBackup.backup('req_arweave', certificate);
    
    const record = createTestExecutionRecord('req_arweave', ExecutionState.CERT_ISSUED, {
      intent,
      certificate,
      certificateArweaveId: arweaveId,
    });
    await executor.persistence.save(record);
    
    // Verify backup reference is stored
    const saved = await executor.persistence.get('req_arweave');
    expect(saved?.certificateArweaveId).toBe(arweaveId);
    
    // Can retrieve certificate from backup
    const retrieved = await executor.certificateBackup.retrieve(arweaveId);
    expect(retrieved).toEqual(certificate);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION: Full Flow Test
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: Complete Credit Flow', () => {
  let executor: TestableExecutor;
  
  beforeEach(() => {
    executor = new TestableExecutor();
    executor.identityRegistry.registerAgent(1n, '0xAgent1Address');
  });
  
  afterEach(() => {
    executor.reset();
  });
  
  it('should complete happy path: Approval → Certificate → Transfer → Settlement', async () => {
    // Step 1: Process approval
    await executor.processApproval('req_full', 1n, 5000000000n, 86400, 'eip155:84532');
    
    let record = await executor.persistence.get('req_full');
    expect(record?.state).toBe(ExecutionState.COMPLETED);
    
    // Verify certificate was issued and backed up
    expect(record?.certificate).toBeDefined();
    expect(record?.certificateArweaveId).toBeDefined();
    expect(executor.certificateBackup.backups.has('req_full')).toBe(true);
    
    // Verify transfer completed
    expect(record?.transferTxHash).toBeDefined();
    
    // Step 2: Mark as settled
    await executor.markSettled('req_full', '0xsettlement_tx');
    
    record = await executor.persistence.get('req_full');
    expect(record?.state).toBe(ExecutionState.SETTLED);
    expect(record?.settlementTxHash).toBe('0xsettlement_tx');
    
    // Verify settlement event
    expect(executor.eventEmitter.settledEvents).toHaveLength(1);
    expect(executor.eventEmitter.settledEvents[0].requestId).toBe('req_full');
  });
  
  it('should handle failure path: Approval → Certificate → Failures → Default', async () => {
    // Configure to always fail
    executor.circleGateway.setConfig({
      failFirstAttempts: 100,
      errorType: '502',
    });
    
    // Short TTL that will expire
    const shortTTL = 1; // 1 second
    
    // Process approval
    await executor.processApproval('req_fail', 1n, 1000000000n, shortTTL);
    
    let record = await executor.persistence.get('req_fail');
    expect(record?.state).toBe(ExecutionState.TRANSFER_FAILED);
    expect(record?.certificate).toBeDefined(); // Certificate should still be issued
    
    // Wait for TTL expiry
    await new Promise(r => setTimeout(r, 1100));
    
    // Check expirations
    await executor.checkExpirations();
    
    record = await executor.persistence.get('req_fail');
    expect(record?.state).toBe(ExecutionState.DEFAULTED);
    
    // Verify default event with certificate for remediation
    expect(executor.eventEmitter.defaultedEvents).toHaveLength(1);
    const defaultEvent = executor.eventEmitter.defaultedEvents[0];
    expect(defaultEvent.certificateClaims).toBe(record?.certificate?.claims);
    expect(defaultEvent.remediationRequired).toBe(true);
  });
});
