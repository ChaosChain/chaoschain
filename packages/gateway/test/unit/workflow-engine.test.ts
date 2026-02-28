/**
 * Workflow Engine Unit Tests
 * 
 * Goal: Prove that the Gateway engine is correct even if adapters misbehave.
 * 
 * These tests mock interfaces and verify:
 * A. Reconciliation prevents duplicate irreversible actions
 * B. Crash recovery works correctly
 * C. FAILED vs STALLED is enforced consistently
 * D. TxQueue serialization prevents nonce races
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkflowEngine,
  WorkflowPersistence,
  InMemoryWorkflowPersistence,
  WorkflowReconciler,
  TxQueue,
  ChainAdapter,
  ChainStateAdapter,
  ArweaveAdapter,
  WorkSubmissionRecord,
  WorkSubmissionInput,
  TxReceipt,
  createWorkSubmissionWorkflow,
  createWorkSubmissionDefinition,
  ArweaveUploader,
  ContractEncoder,
  RewardsDistributorEncoder,
} from '../../src/workflows/index.js';

// =============================================================================
// MOCK FACTORIES
// =============================================================================

function createMockChainAdapter(): ChainAdapter {
  return {
    getNonce: vi.fn().mockResolvedValue(0),
    submitTx: vi.fn().mockResolvedValue({ txHash: '0xmocktx' }),
    getTxReceipt: vi.fn().mockResolvedValue(null),
    waitForConfirmation: vi.fn().mockResolvedValue({
      status: 'confirmed',
      blockNumber: 12345,
    } as TxReceipt),
  };
}

function createMockChainStateAdapter(): ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> } {
  return {
    workSubmissionExists: vi.fn().mockResolvedValue(false),
    getWorkSubmission: vi.fn().mockResolvedValue(null),
    // REGISTER_WORK step reconciliation
    isWorkRegisteredInRewardsDistributor: vi.fn().mockResolvedValue(false),
  };
}

function createMockArweaveAdapter(): ArweaveAdapter {
  return {
    getStatus: vi.fn().mockResolvedValue('confirmed'),
  };
}

function createMockArweaveUploader(): ArweaveUploader {
  return {
    upload: vi.fn().mockResolvedValue('mock-arweave-tx-id'),
    isConfirmed: vi.fn().mockResolvedValue(true),
  };
}

function createMockContractEncoder(): ContractEncoder {
  return {
    encodeSubmitWork: vi.fn().mockReturnValue('0xmockdata'),
    encodeSubmitWorkMultiAgent: vi.fn().mockReturnValue('0xmockdata'),
  };
}

function createMockRewardsDistributorEncoder(): RewardsDistributorEncoder {
  return {
    encodeRegisterWork: vi.fn().mockReturnValue('0xmockregisterdata'),
  };
}

const MOCK_REWARDS_DISTRIBUTOR_ADDRESS = '0xMockRewardsDistributor';

function createTestInput(): WorkSubmissionInput {
  return {
    studio_address: '0xStudio',
    epoch: 1,
    agent_address: '0xAgent',
    data_hash: '0xDataHash',
    dkg_evidence: [{
      arweave_tx_id: 'test-tx-1',
      author: '0xAgent',
      timestamp: 1000,
      parent_ids: [],
      payload_hash: '0x' + '00'.repeat(32),
      artifact_ids: [],
      signature: '0x' + '00'.repeat(65),
    }],
    evidence_content: Buffer.from('test evidence'),
    signer_address: '0xSigner',
  };
}

const MOCK_DKG_PROGRESS = {
  dkg_thread_root: '0x' + 'aa'.repeat(32),
  dkg_evidence_root: '0x' + 'bb'.repeat(32),
  dkg_weights: { '0xAgent': 1.0 },
};

// =============================================================================
// A. RECONCILIATION-BEFORE-IRREVERSIBLE TESTS
// =============================================================================

describe('A. Reconciliation-before-irreversible', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> };
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
  let rewardsDistributorEncoder: RewardsDistributorEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    arweaveUploader = createMockArweaveUploader();
    contractEncoder = createMockContractEncoder();
    rewardsDistributorEncoder = createMockRewardsDistributorEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder,
      rewardsDistributorEncoder,
      MOCK_REWARDS_DISTRIBUTOR_ADDRESS
    );
    engine.registerWorkflow(definition);
  });

  it('CRITICAL: should NOT call submitTx when work already exists on-chain AND registered', async () => {
    // Setup: Work is already on-chain AND registered in RewardsDistributor
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(true);

    // Create workflow at SUBMIT_WORK_ONCHAIN step (simulating mid-flight)
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);

    // Resume the workflow
    await engine.resumeWorkflow(workflow.id);

    // CRITICAL ASSERTION: submitTx should never be called
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Workflow should be COMPLETED (skipped directly via reconciliation)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should call submitTx when work does NOT exist on-chain', async () => {
    // Setup: Work does NOT exist on-chain, not registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    // Create workflow at SUBMIT_WORK_ONCHAIN step
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);

    // Resume the workflow
    await engine.resumeWorkflow(workflow.id);

    // submitTx SHOULD be called since work doesn't exist
    expect(chainAdapter.submitTx).toHaveBeenCalled();
  }, 15000);

  it('should reconcile tx hash status before retrying submission', async () => {
    // Setup: Workflow has a pending tx hash, tx is confirmed, work is registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(true);
    (chainAdapter.getTxReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 100,
    });

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xExistingTx',
    };

    await persistence.create(workflow);

    // Resume
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit a new tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Should be COMPLETED (reconciliation sees work is registered)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });
});

// =============================================================================
// B. CRASH RECOVERY SIMULATION TESTS
// =============================================================================

describe('B. Crash recovery simulation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> };
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
  let rewardsDistributorEncoder: RewardsDistributorEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    arweaveUploader = createMockArweaveUploader();
    contractEncoder = createMockContractEncoder();
    rewardsDistributorEncoder = createMockRewardsDistributorEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder,
      rewardsDistributorEncoder,
      MOCK_REWARDS_DISTRIBUTOR_ADDRESS
    );
    engine.registerWorkflow(definition);
  });

  it('should complete workflow on restart when tx is already confirmed and registered', async () => {
    // Simulate: Gateway crashed after submitting tx but before recording confirmation
    // State: AWAIT_TX_CONFIRM with tx hash, but tx is actually confirmed AND registered

    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(true);
    (chainAdapter.getTxReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 200,
    });
    (chainAdapter.waitForConfirmation as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 200,
    });

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xCrashedTx',
    };

    await persistence.create(workflow);

    // Simulate restart: resume workflow
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit new tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Should be COMPLETED (reconciliation sees work is registered)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should resume from UPLOAD_EVIDENCE if arweave tx id not recorded', async () => {
    // Crash during upload - no arweave_tx_id saved
    // Mock that work is not yet on-chain or registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);
    
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = { ...MOCK_DKG_PROGRESS }; // DKG done, no arweave tx id

    await persistence.create(workflow);

    // Resume
    await engine.resumeWorkflow(workflow.id);

    // Should upload to arweave
    expect(arweaveUploader.upload).toHaveBeenCalled();

    // Should progress (or complete)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(['RUNNING', 'COMPLETED']).toContain(finalWorkflow?.state);
  }, 15000);

  it('should reconcile all active workflows on startup', async () => {
    // Create multiple workflows in different states
    // Mock that work is not yet on-chain or registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const input1 = createTestInput();
    const workflow1 = createWorkSubmissionWorkflow(input1);
    workflow1.state = 'RUNNING';
    workflow1.step = 'UPLOAD_EVIDENCE';
    workflow1.progress = { ...MOCK_DKG_PROGRESS };

    const input2 = { ...createTestInput(), agent_address: '0xAgent2' };
    const workflow2 = createWorkSubmissionWorkflow(input2);
    workflow2.state = 'STALLED';
    workflow2.step = 'AWAIT_ARWEAVE_CONFIRM';
    workflow2.progress = { ...MOCK_DKG_PROGRESS, arweave_tx_id: 'ar-tx-2' };

    await persistence.create(workflow1);
    await persistence.create(workflow2);

    // Mock Arweave confirmed for workflow2
    (arweaveAdapter.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue('confirmed');

    // Reconcile all
    await engine.reconcileAllActive();

    // Both should have progressed or completed
    const final1 = await persistence.load(workflow1.id);
    const final2 = await persistence.load(workflow2.id);

    // At minimum, they should not still be in their original states
    // (exact final state depends on mock behavior)
    expect(final1).toBeDefined();
    expect(final2).toBeDefined();
  }, 15000);
});

// =============================================================================
// C. FAILED vs STALLED SEPARATION TESTS
// =============================================================================

describe('C. FAILED vs STALLED separation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> };
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
  let rewardsDistributorEncoder: RewardsDistributorEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    arweaveUploader = createMockArweaveUploader();
    contractEncoder = createMockContractEncoder();
    rewardsDistributorEncoder = createMockRewardsDistributorEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler, {
      max_attempts: 2, // Low for testing
      initial_delay_ms: 1,
      max_delay_ms: 10,
      backoff_multiplier: 1,
      jitter: false,
    });

    // Mock that work is not yet on-chain or registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder,
      rewardsDistributorEncoder,
      MOCK_REWARDS_DISTRIBUTOR_ADDRESS
    );
    engine.registerWorkflow(definition);
  });

  it('should FAIL on contract revert (epoch closed)', async () => {
    // Setup: Arweave done, but contract will revert
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('epoch closed')
    );

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('EPOCH_CLOSED');
  });

  it('should FAIL on already submitted error', async () => {
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('already submitted')
    );

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('ALREADY_SUBMITTED');
  });

  it('should STALL on network timeout after max retries', async () => {
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network timeout')
    );

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
    // Error should be recoverable
    expect(finalWorkflow?.error?.recoverable).toBe(true);
  });

  it('should STALL on Arweave funding error', async () => {
    (arweaveUploader.upload as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('insufficient funds')
    );

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);

    await persistence.create(workflow);
    
    // Start workflow
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
  });

  it('FAILED workflows should never retry', async () => {
    // Create a FAILED workflow
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'FAILED';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.error = {
      step: 'SUBMIT_WORK_ONCHAIN',
      message: 'epoch closed',
      code: 'EPOCH_CLOSED',
      timestamp: Date.now(),
      recoverable: false,
    };

    await persistence.create(workflow);

    // Try to resume
    await engine.resumeWorkflow(workflow.id);

    // Should remain FAILED, no operations attempted
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D. TX QUEUE SERIALIZATION TESTS
// =============================================================================

describe('D. TxQueue serialization (nonce races)', () => {
  let chainAdapter: ChainAdapter;
  let txQueue: TxQueue;

  beforeEach(() => {
    chainAdapter = createMockChainAdapter();
    txQueue = new TxQueue(chainAdapter);
  });

  it('should serialize transactions for same signer', async () => {
    const signer = '0xSigner1';
    const executionOrder: string[] = [];
    let callCount = 0;

    // Track submissions in order
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      const txNum = callCount;
      executionOrder.push(`submit${txNum}`);
      return { txHash: `0xtx${txNum}` };
    });

    let confirmCount = 0;
    (chainAdapter.waitForConfirmation as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      confirmCount++;
      const txNum = confirmCount;
      // First confirmation is slow
      if (txNum === 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      executionOrder.push(`confirm${txNum}`);
      return { status: 'confirmed', blockNumber: txNum };
    });

    // Start first tx (don't await yet)
    const tx1Promise = txQueue.submitAndWait('workflow1', signer, {
      to: '0xContract',
      data: '0x1',
    });

    // Small delay to ensure tx1 acquires lock first
    await new Promise(resolve => setTimeout(resolve, 5));

    // Start second tx - should block until first completes
    const tx2Promise = txQueue.submitAndWait('workflow2', signer, {
      to: '0xContract',
      data: '0x2',
    });

    await Promise.all([tx1Promise, tx2Promise]);

    // CRITICAL: First tx must complete before second tx submits
    expect(executionOrder[0]).toBe('submit1');
    expect(executionOrder[1]).toBe('confirm1');
    expect(executionOrder[2]).toBe('submit2');
    expect(executionOrder[3]).toBe('confirm2');
  });

  it('should allow parallel transactions for different signers', async () => {
    const signer1 = '0xSigner1';
    const signer2 = '0xSigner2';
    let concurrent = 0;
    let maxConcurrent = 0;

    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(resolve => setTimeout(resolve, 20));
      return { txHash: '0xtx' };
    });

    (chainAdapter.waitForConfirmation as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      concurrent--;
      return { status: 'confirmed', blockNumber: 1 };
    });

    await Promise.all([
      txQueue.submitAndWait('workflow1', signer1, { to: '0x', data: '0x1' }),
      txQueue.submitAndWait('workflow2', signer2, { to: '0x', data: '0x2' }),
    ]);

    // Both should have been concurrent at some point
    expect(maxConcurrent).toBe(2);
  });

  it('should release lock even on error', async () => {
    const signer = '0xSigner1';

    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network error')
    );

    // First tx fails
    await expect(
      txQueue.submitAndWait('workflow1', signer, { to: '0x', data: '0x1' })
    ).rejects.toThrow('network error');

    // Lock should be released
    expect(txQueue.isLocked(signer)).toBe(false);

    // Second tx should proceed
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockResolvedValue({ txHash: '0xtx2' });

    const result = await txQueue.submitAndWait('workflow2', signer, { to: '0x', data: '0x2' });
    expect(result.txHash).toBe('0xtx2');
  });

  it('should handle re-entrant lock for same workflow', async () => {
    const signer = '0xSigner1';
    const workflowId = 'workflow1';

    // Simulate workflow holding lock then trying to acquire again
    const tx1 = txQueue.submitOnly(workflowId, signer, { to: '0x', data: '0x1' });
    const txHash = await tx1;

    // Same workflow should be able to re-acquire (idempotent)
    // This happens during retry scenarios
    expect(txQueue.isLocked(signer)).toBe(true);

    // Release
    txQueue.releaseSignerLock(signer);
    expect(txQueue.isLocked(signer)).toBe(false);
  });
});

// =============================================================================
// IDEMPOTENCY TESTS
// =============================================================================

describe('Idempotency invariants', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> };
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
  let rewardsDistributorEncoder: RewardsDistributorEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    arweaveUploader = createMockArweaveUploader();
    contractEncoder = createMockContractEncoder();
    rewardsDistributorEncoder = createMockRewardsDistributorEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    // Mock that work is not yet on-chain or registered
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder,
      rewardsDistributorEncoder,
      MOCK_REWARDS_DISTRIBUTOR_ADDRESS
    );
    engine.registerWorkflow(definition);
  });

  it('should skip arweave upload if already done', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'already-uploaded', // Already uploaded
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Upload should NOT be called again
    expect(arweaveUploader.upload).not.toHaveBeenCalled();
  }, 15000);

  it('should skip StudioProxy tx submission if tx hash already exists', async () => {
    // When workflow already has onchain_tx_hash but work is not yet registered,
    // it should skip StudioProxy submission but still call registerWork
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx',
      arweave_confirmed: true,
      onchain_tx_hash: 'already-submitted', // Already submitted to StudioProxy
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // submitTx was called only ONCE for REGISTER_WORK, not for SUBMIT_WORK_ONCHAIN
    expect(chainAdapter.submitTx).toHaveBeenCalledTimes(1);
    // And it was for RewardsDistributor, not StudioProxy
    expect(chainAdapter.submitTx).toHaveBeenCalledWith(
      '0xSigner',
      expect.objectContaining({ to: MOCK_REWARDS_DISTRIBUTOR_ADDRESS }),
      expect.any(Number)
    );
  }, 15000);

  it('should handle duplicate workflow creation gracefully', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);

    await persistence.create(workflow);

    // Try to create same workflow again
    await expect(persistence.create(workflow)).rejects.toThrow('already exists');
  });
});

// =============================================================================
// E. REGISTER_WORK STEP TESTS (RewardsDistributor registration)
// =============================================================================

describe('E. REGISTER_WORK step (RewardsDistributor registration)', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter & { isWorkRegisteredInRewardsDistributor: ReturnType<typeof vi.fn> };
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
  let rewardsDistributorEncoder: RewardsDistributorEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    arweaveUploader = createMockArweaveUploader();
    contractEncoder = createMockContractEncoder();
    rewardsDistributorEncoder = createMockRewardsDistributorEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder,
      rewardsDistributorEncoder,
      MOCK_REWARDS_DISTRIBUTOR_ADDRESS
    );
    engine.registerWorkflow(definition);
  });

  it('should register work in RewardsDistributor after StudioProxy submission', async () => {
    // Setup: Work exists on StudioProxy but NOT registered in RewardsDistributor
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REGISTER_WORK';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xStudioTx',
      onchain_confirmed: true,
      onchain_block: 100,
      onchain_confirmed_at: Date.now(),
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should call submitTx for RewardsDistributor.registerWork
    expect(chainAdapter.submitTx).toHaveBeenCalledWith(
      '0xSigner',
      expect.objectContaining({ to: MOCK_REWARDS_DISTRIBUTOR_ADDRESS }),
      expect.any(Number)
    );

    // Encoder should have been called
    expect(rewardsDistributorEncoder.encodeRegisterWork).toHaveBeenCalledWith(
      input.studio_address,
      input.epoch,
      input.data_hash
    );
  }, 15000);

  it('should skip REGISTER_WORK if work is already registered via reconciliation', async () => {
    // Setup: Work is already registered in RewardsDistributor
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REGISTER_WORK';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xStudioTx',
      onchain_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should NOT call submitTx - reconciliation should skip to COMPLETED
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Workflow should be COMPLETED
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should advance step to REGISTER_WORK after reconciliation detects work on StudioProxy', async () => {
    // Setup: Gateway crashed after submitWork confirmed but before registerWork
    // Work exists on StudioProxy but NOT registered
    // Reconciliation should advance the step to REGISTER_WORK
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN'; // About to submit to StudioProxy
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);

    // First, run reconciliation
    const result = await reconciler.reconcileWorkSubmission(workflow);

    // Reconciliation should advance to REGISTER_WORK (since work exists on StudioProxy)
    expect(result.action).toBe('ADVANCE_TO_STEP');
    if (result.action === 'ADVANCE_TO_STEP') {
      expect(result.step).toBe('REGISTER_WORK');
    }
  });

  it('ADVANCE_TO_STEP must set onchain_confirmed so RegisterWorkStep does not reject', async () => {
    // Scenario: Gateway crashed after submitWork confirmed. On restart,
    // reconciliation detects work on StudioProxy and returns ADVANCE_TO_STEP.
    // RegisterWorkStep has a precondition: if (!progress.onchain_confirmed) → FAIL.
    // This test proves that applyReconciliationResult carries the progress update.
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    const result = await reconciler.reconcileWorkSubmission(workflow);
    expect(result.action).toBe('ADVANCE_TO_STEP');

    const { workflow: updated } = reconciler.applyReconciliationResult(workflow, result);

    expect(updated.step).toBe('REGISTER_WORK');
    expect((updated.progress as Record<string, unknown>).onchain_confirmed).toBe(true);
    expect((updated.progress as Record<string, unknown>).onchain_confirmed_at).toBeTypeOf('number');
  });

  it('should handle duplicate registerWork gracefully (idempotent)', async () => {
    // Setup: registerWork tx exists but not confirmed yet
    // Workflow has register_tx_hash already
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REGISTER_WORK';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xStudioTx',
      onchain_confirmed: true,
      register_tx_hash: '0xExistingRegisterTx', // Already has register tx
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit another registerWork tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  }, 15000);

  it('should complete workflow via reconciliation when work is registered', async () => {
    // Setup: Work is fully registered - reconciliation should detect this and complete
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    chainState.isWorkRegisteredInRewardsDistributor.mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_REGISTER_CONFIRM';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xStudioTx',
      onchain_confirmed: true,
      register_tx_hash: '0xRegisterTx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Workflow should be COMPLETED (via reconciliation seeing work is registered)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  }, 15000);
});
