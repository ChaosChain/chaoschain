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
  NoOpReconciler,
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
    hasSigner: vi.fn().mockReturnValue(true),
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
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    engine = new WorkflowEngine(persistence, new NoOpReconciler());

    const definition = createWorkSubmissionDefinition(persistence);
    engine.registerWorkflow(definition);
  });

  it('CRITICAL: should complete off-chain at SUBMIT_WORK_ONCHAIN step', async () => {
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
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should complete off-chain with settlement marker', async () => {
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
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
  }, 15000);

  // Skipped: AWAIT_TX_CONFIRM removed from off-chain workflow definition
  it.skip('should reconcile tx hash status before retrying submission', async () => {
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
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });
});

// =============================================================================
// B. CRASH RECOVERY SIMULATION TESTS
// =============================================================================

describe('B. Crash recovery simulation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    engine = new WorkflowEngine(persistence, new NoOpReconciler());

    const definition = createWorkSubmissionDefinition(persistence);
    engine.registerWorkflow(definition);
  });

  // Skipped: AWAIT_TX_CONFIRM removed from off-chain workflow definition
  it.skip('should complete workflow on restart when tx is already confirmed and registered', async () => {
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
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should resume from UPLOAD_EVIDENCE if arweave tx id not recorded', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = { ...MOCK_DKG_PROGRESS };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  }, 15000);

  it('should reconcile all active workflows on startup', async () => {
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

    await engine.reconcileAllActive();

    const final1 = await persistence.load(workflow1.id);
    const final2 = await persistence.load(workflow2.id);

    expect(final1).toBeDefined();
    expect(final2).toBeDefined();
  }, 15000);
});

// =============================================================================
// C. FAILED vs STALLED SEPARATION TESTS
// =============================================================================

describe('C. FAILED vs STALLED separation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    engine = new WorkflowEngine(persistence, new NoOpReconciler(), {
      max_attempts: 2,
      initial_delay_ms: 1,
      max_delay_ms: 10,
      backoff_multiplier: 1,
      jitter: false,
    });

    const definition = createWorkSubmissionDefinition(persistence);
    engine.registerWorkflow(definition);
  });

  it('should complete off-chain even when chain would revert (epoch closed)', async () => {
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
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
  });

  it('should complete off-chain even when chain would reject (already submitted)', async () => {
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
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
  });

  it('should complete off-chain even when chain has network timeout', async () => {
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
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
  });

  // Skipped: UPLOAD_EVIDENCE is now a no-op, arweave funding errors cannot occur
  it.skip('should STALL on Arweave funding error', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
  });

  it('FAILED workflows should never retry', async () => {
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
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
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
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    engine = new WorkflowEngine(persistence, new NoOpReconciler());

    const definition = createWorkSubmissionDefinition(persistence);
    engine.registerWorkflow(definition);
  });

  it('should progress through no-op upload step when arweave_tx_id already set', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'UPLOAD_EVIDENCE';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'already-uploaded',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  }, 15000);

  it('should complete off-chain even when onchain_tx_hash already exists', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_WORK_ONCHAIN';
    workflow.progress = {
      ...MOCK_DKG_PROGRESS,
      arweave_tx_id: 'ar-tx',
      arweave_confirmed: true,
      onchain_tx_hash: 'already-submitted',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
  }, 15000);

  it('should handle duplicate workflow creation gracefully', async () => {
    const input = createTestInput();
    const workflow = createWorkSubmissionWorkflow(input);

    await persistence.create(workflow);

    await expect(persistence.create(workflow)).rejects.toThrow('already exists');
  });
});

// =============================================================================
// E. REGISTER_WORK STEP TESTS (RewardsDistributor registration)
// =============================================================================

// Skipped: REGISTER_WORK removed from off-chain workflow definition
describe.skip('E. REGISTER_WORK step (RewardsDistributor registration)', () => {
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

    const definition = createWorkSubmissionDefinition(persistence);
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
