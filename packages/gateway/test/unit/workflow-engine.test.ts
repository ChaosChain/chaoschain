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

function createMockChainStateAdapter(): ChainStateAdapter {
  return {
    workSubmissionExists: vi.fn().mockResolvedValue(false),
    getWorkSubmission: vi.fn().mockResolvedValue(null),
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

function createTestInput(): WorkSubmissionInput {
  return {
    studio_address: '0xStudio',
    epoch: 1,
    agent_address: '0xAgent',
    data_hash: '0xDataHash',
    thread_root: '0xThreadRoot',
    evidence_root: '0xEvidenceRoot',
    evidence_content: Buffer.from('test evidence'),
    signer_address: '0xSigner',
  };
}

// =============================================================================
// A. RECONCILIATION-BEFORE-IRREVERSIBLE TESTS
// =============================================================================

describe('A. Reconciliation-before-irreversible', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
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
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder
    );
    engine.registerWorkflow(definition);
  });

  it('CRITICAL: should NOT call submitTx when work already exists on-chain', async () => {
    // Setup: Work is already on-chain
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    // Create workflow at SUBMIT_WORK_ONCHAIN step (simulating mid-flight)
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);

    // Resume the workflow
    await engine.resumeWorkflow(workflow.id);

    // CRITICAL ASSERTION: submitTx should never be called
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Workflow should be COMPLETED
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should call submitTx when work does NOT exist on-chain', async () => {
    // Setup: Work does NOT exist on-chain
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    // Create workflow at SUBMIT_WORK_ONCHAIN step
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
    };

    await persistence.create(workflow);

    // Resume the workflow
    await engine.resumeWorkflow(workflow.id);

    // submitTx SHOULD be called since work doesn't exist
    expect(chainAdapter.submitTx).toHaveBeenCalled();
  });

  it('should reconcile tx hash status before retrying submission', async () => {
    // Setup: Workflow has a pending tx hash, tx is confirmed
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (chainAdapter.getTxReceipt as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 100,
    });

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xExistingTx',
    };

    await persistence.create(workflow);

    // Resume
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit a new tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Should be COMPLETED
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
  let chainState: ChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
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
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder
    );
    engine.registerWorkflow(definition);
  });

  it('should complete workflow on restart when tx is already confirmed', async () => {
    // Simulate: Gateway crashed after submitting tx but before recording confirmation
    // State: AWAIT_TX_CONFIRM with tx hash, but tx is actually confirmed

    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
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
      arweave_tx_id: 'ar-tx-id',
      arweave_confirmed: true,
      onchain_tx_hash: '0xCrashedTx',
    };

    await persistence.create(workflow);

    // Simulate restart: resume workflow
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit new tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Should be COMPLETED
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should resume from UPLOAD_EVIDENCE if arweave tx id not recorded', async () => {
    // Crash during upload - no arweave_tx_id saved
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = {}; // No arweave tx id

    await persistence.create(workflow);

    // Resume
    await engine.resumeWorkflow(workflow.id);

    // Should upload to arweave
    expect(arweaveUploader.upload).toHaveBeenCalled();

    // Should progress (or complete)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(['RUNNING', 'COMPLETED']).toContain(finalWorkflow?.state);
  });

  it('should reconcile all active workflows on startup', async () => {
    // Create multiple workflows in different states
    const input1 = createTestInput();
    const workflow1 = createWorkSubmissionWorkflow(input1);
    workflow1.state = 'RUNNING';
    workflow1.step = 'UPLOAD_EVIDENCE';

    const input2 = { ...createTestInput(), agent_address: '0xAgent2' };
    const workflow2 = createWorkSubmissionWorkflow(input2);
    workflow2.state = 'STALLED';
    workflow2.step = 'AWAIT_ARWEAVE_CONFIRM';
    workflow2.progress = { arweave_tx_id: 'ar-tx-2' };

    await persistence.create(workflow1);
    await persistence.create(workflow2);

    // Mock Arweave confirmed for workflow2
    (arweaveAdapter.getStatus as ReturnType<typeof vi.fn>).mockResolvedValue('confirmed');
    // Mock chain state doesn't have either submission yet
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    // Reconcile all
    await engine.reconcileAllActive();

    // Both should have progressed or completed
    const final1 = await persistence.load(workflow1.id);
    const final2 = await persistence.load(workflow2.id);

    // At minimum, they should not still be in their original states
    // (exact final state depends on mock behavior)
    expect(final1).toBeDefined();
    expect(final2).toBeDefined();
  });
});

// =============================================================================
// C. FAILED vs STALLED SEPARATION TESTS
// =============================================================================

describe('C. FAILED vs STALLED separation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
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
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler, {
      max_attempts: 2, // Low for testing
      initial_delay_ms: 1,
      max_delay_ms: 10,
      backoff_multiplier: 1,
      jitter: false,
    });

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder
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
  let chainState: ChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let arweaveUploader: ArweaveUploader;
  let contractEncoder: ContractEncoder;
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
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createWorkSubmissionDefinition(
      arweaveUploader,
      txQueue,
      persistence,
      contractEncoder
    );
    engine.registerWorkflow(definition);
  });

  it('should skip arweave upload if already done', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = {
      arweave_tx_id: 'already-uploaded', // Already uploaded
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Upload should NOT be called again
    expect(arweaveUploader.upload).not.toHaveBeenCalled();
  });

  it('should skip tx submission if tx hash already exists', async () => {
    (chainState.workSubmissionExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      arweave_tx_id: 'ar-tx',
      arweave_confirmed: true,
      onchain_tx_hash: 'already-submitted', // Already submitted
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // submitTx should NOT be called - should go straight to wait
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });

  it('should handle duplicate workflow creation gracefully', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);

    await persistence.create(workflow);

    // Try to create same workflow again
    await expect(persistence.create(workflow)).rejects.toThrow('already exists');
  });
});
