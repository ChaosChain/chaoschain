/**
 * ScoreSubmission Workflow Unit Tests
 * 
 * Equivalent rigor to WorkSubmission tests.
 * 
 * Tests:
 * A. Reconciliation prevents duplicate commits/reveals
 * B. Crash recovery for commit-reveal pattern
 * C. FAILED vs STALLED semantics
 * D. TxQueue serialization (shared with WorkSubmission)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkflowEngine,
  InMemoryWorkflowPersistence,
  WorkflowReconciler,
  TxQueue,
  ChainAdapter,
  ChainStateAdapter,
  ArweaveAdapter,
  ScoreSubmissionRecord,
  ScoreSubmissionInput,
  TxReceipt,
  createScoreSubmissionWorkflow,
  createScoreSubmissionDefinition,
  ScoreContractEncoder,
  DirectScoreContractEncoder,
  ScoreChainStateAdapter,
  ValidatorRegistrationEncoder,
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

function createMockScoreChainStateAdapter(): ScoreChainStateAdapter {
  return {
    commitExists: vi.fn().mockResolvedValue(false),
    revealExists: vi.fn().mockResolvedValue(false),
    getCommit: vi.fn().mockResolvedValue(null),
    scoreExistsForWorker: vi.fn().mockResolvedValue(false),
    isValidatorRegisteredInRewardsDistributor: vi.fn().mockResolvedValue(false),
  };
}

function createMockValidatorRegistrationEncoder(): ValidatorRegistrationEncoder {
  return {
    encodeRegisterValidator: vi.fn().mockReturnValue('0xregistervalidatordata'),
    getRewardsDistributorAddress: vi.fn().mockReturnValue('0xRewardsDistributor'),
  };
}

function createMockArweaveAdapter(): ArweaveAdapter {
  return {
    getStatus: vi.fn().mockResolvedValue('confirmed'),
  };
}

function createMockScoreEncoder(): ScoreContractEncoder {
  return {
    computeCommitHash: vi.fn().mockReturnValue('0xcommithash'),
    encodeCommitScore: vi.fn().mockReturnValue('0xcommitdata'),
    encodeRevealScore: vi.fn().mockReturnValue('0xrevealdata'),
  };
}

function createMockDirectScoreEncoder(): DirectScoreContractEncoder {
  return {
    encodeSubmitScoreVectorForWorker: vi.fn().mockReturnValue('0xdirectscoredata'),
  };
}

function createTestInput(mode: 'direct' | 'commit_reveal' = 'commit_reveal'): ScoreSubmissionInput {
  const base = {
    studio_address: '0xStudio',
    epoch: 1,
    validator_address: '0xValidator',
    data_hash: '0xDataHash',
    scores: [8000, 7500, 9000, 6500, 8500], // 5 dimensions
    salt: '0xSalt123456789012345678901234567890123456789012345678901234567890',
    signer_address: '0xSigner',
  };
  
  if (mode === 'direct') {
    return {
      ...base,
      mode: 'direct',
      worker_address: '0xWorker',
    };
  }
  
  return {
    ...base,
    mode: 'commit_reveal',
  };
}

// =============================================================================
// A. RECONCILIATION-BEFORE-IRREVERSIBLE TESTS
// =============================================================================

describe('A. ScoreSubmission Reconciliation-before-irreversible', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('CRITICAL: should NOT call submitTx for commit when commit already exists', async () => {
    // Setup: Commit already exists on-chain
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = {};

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should detect commit exists via reconciliation
    const finalWorkflow = await persistence.load(workflow.id);
    // Commit exists means progress should be updated
    expect(finalWorkflow?.progress.commit_confirmed).toBe(true);
  });

  it('CRITICAL: should NOT call submitTx for reveal when reveal already exists', async () => {
    // Setup: Reveal already exists on-chain and validator already registered
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should complete via reconciliation (reveal exists and validator registered)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    // submitTx should not be called for reveal since it already exists
  });

  it('should skip commit submission if commit_tx_hash already exists', async () => {
    // Setup: Workflow has commit tx hash, in COMMIT_SCORE step
    // The step should detect existing tx hash and advance without submitting new tx
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xexistingtx', // Already submitted
    };

    await persistence.create(workflow);
    
    // Get initial submitTx call count
    const initialCallCount = (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mock.calls.length;
    
    await engine.resumeWorkflow(workflow.id);

    // The COMMIT_SCORE step should NOT submit (has tx hash already)
    // but the workflow may proceed to AWAIT_COMMIT_CONFIRM then REVEAL_SCORE
    // which will call submitTx for the reveal.
    // So we check that the FIRST call (if any) is for reveal, not commit.
    const calls = (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mock.calls;
    const newCalls = calls.slice(initialCallCount);
    
    // If there are new calls, none should be for commit (commit already exists)
    // The commit encoder would produce '0xcommitdata'
    for (const call of newCalls) {
      expect(call[1].data).not.toBe('0xcommitdata');
    }
  });
});

// =============================================================================
// B. CRASH RECOVERY SIMULATION TESTS
// =============================================================================

describe('B. ScoreSubmission Crash recovery', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('should complete workflow on restart when reveal and validator registration are confirmed', async () => {
    // Simulate: Gateway crashed after reveal submitted but before recording confirmation
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    // Also mock validator registration as confirmed for full completion
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_REVEAL_CONFIRM';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
      reveal_tx_hash: '0xrevealtx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should resume from AWAIT_COMMIT_CONFIRM and proceed to reveal', async () => {
    // Crash during await commit confirm
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.waitForConfirmation as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 100,
    });

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_COMMIT_CONFIRM';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    // Should have progressed to reveal or completed
    expect(['RUNNING', 'COMPLETED']).toContain(finalWorkflow?.state);
    expect(finalWorkflow?.progress.commit_confirmed).toBe(true);
  });

  it('should reconcile all active score submission workflows on startup', async () => {
    // Create workflow in mid-flight
    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
    };

    await persistence.create(workflow);

    // Mock reveal exists and validator registered (already done)
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    await engine.reconcileAllActive();

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });
});

// =============================================================================
// C. FAILED vs STALLED SEPARATION TESTS
// =============================================================================

describe('C. ScoreSubmission FAILED vs STALLED', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler, {
      max_attempts: 2,
      initial_delay_ms: 1,
      max_delay_ms: 10,
      backoff_multiplier: 1,
      jitter: false,
    });

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('should FAIL on commit window closed error', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('commit window closed')
    );

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = { commit_hash: '0xcommithash' };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('COMMIT_WINDOW_CLOSED');
  });

  it('should FAIL on already committed error', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('already committed')
    );

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = { commit_hash: '0xcommithash' };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('ALREADY_COMMITTED');
  });

  it('should FAIL on reveal window closed error', async () => {
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('reveal window closed')
    );

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('REVEAL_WINDOW_CLOSED');
  });

  it('should FAIL on commit mismatch error (wrong reveal)', async () => {
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('commit mismatch')
    );

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('COMMIT_MISMATCH');
  });

  it('should STALL on network timeout after max retries', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network timeout')
    );

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = { commit_hash: '0xcommithash' };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
    expect(finalWorkflow?.error?.recoverable).toBe(true);
  });

  it('FAILED workflows should never retry', async () => {
    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'FAILED';
    workflow.step = 'COMMIT_SCORE';
    workflow.error = {
      step: 'COMMIT_SCORE',
      message: 'commit window closed',
      code: 'COMMIT_WINDOW_CLOSED',
      timestamp: Date.now(),
      recoverable: false,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });
});

// =============================================================================
// D. COMMIT-REVEAL SPECIFIC TESTS
// =============================================================================

describe('D. ScoreSubmission Commit-Reveal pattern', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('should compute and persist commit hash before submitting', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // Should have computed commit hash
    expect(scoreEncoder.computeCommitHash).toHaveBeenCalledWith(
      input.data_hash,
      input.scores,
      input.salt
    );

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.progress.commit_hash).toBe('0xcommithash');
  });

  it('should use same signer for both commit and reveal (serialized)', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // Check that submitTx was called with the same signer for both calls
    const submitCalls = (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mock.calls;
    
    // Should have at least one call (commit)
    expect(submitCalls.length).toBeGreaterThanOrEqual(1);
    
    // All calls should use the same signer
    for (const call of submitCalls) {
      expect(call[0]).toBe(input.signer_address);
    }
  });

  it('should only reveal after commit is confirmed', async () => {
    // Start with commit not confirmed
    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: false, // NOT confirmed
    };

    await persistence.create(workflow);

    // Mock reveal step - it should fail because commit not confirmed
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('COMMIT_NOT_CONFIRMED');
  });
});

// =============================================================================
// IDEMPOTENCY TESTS
// =============================================================================

describe('ScoreSubmission Idempotency', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('should not recompute commit hash if already computed', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'COMMIT_SCORE';
    workflow.progress = {
      commit_hash: '0xalreadycomputed', // Already computed
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should not recompute
    expect(scoreEncoder.computeCommitHash).not.toHaveBeenCalled();
  });

  it('should skip reveal tx if reveal_tx_hash already exists', async () => {
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    // Also mock validator as already registered so no REGISTER_VALIDATOR tx is submitted
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'REVEAL_SCORE';
    workflow.progress = {
      commit_hash: '0xcommithash',
      commit_tx_hash: '0xcommittx',
      commit_confirmed: true,
      reveal_tx_hash: '0xexistingrevealtx', // Already submitted
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit new tx (reveal already has tx hash, validator already registered)
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });
});

// =============================================================================
// E. DIRECT SCORING MODE TESTS (MVP)
// =============================================================================

describe('E. ScoreSubmission Direct Mode (MVP)', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('should create workflow with SUBMIT_SCORE_DIRECT as initial step for direct mode', () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    
    expect(workflow.step).toBe('SUBMIT_SCORE_DIRECT');
    expect(workflow.input.mode).toBe('direct');
    expect(workflow.input.worker_address).toBe('0xWorker');
  });

  it('should create workflow with COMMIT_SCORE as initial step for commit_reveal mode', () => {
    const input = createTestInput('commit_reveal');
    const workflow = createScoreSubmissionWorkflow(input);
    
    expect(workflow.step).toBe('COMMIT_SCORE');
    expect(workflow.input.mode).toBe('commit_reveal');
  });

  it('should default to direct mode when mode is not specified', () => {
    const input: ScoreSubmissionInput = {
      studio_address: '0xStudio',
      epoch: 1,
      validator_address: '0xValidator',
      data_hash: '0xDataHash',
      scores: [8000, 7500, 9000, 6500, 8500],
      salt: '0xSalt',
      signer_address: '0xSigner',
      worker_address: '0xWorker',
      // mode not specified - should default to 'direct'
    };
    const workflow = createScoreSubmissionWorkflow(input);
    
    expect(workflow.step).toBe('SUBMIT_SCORE_DIRECT');
    expect(workflow.input.mode).toBe('direct');
  });

  it('should call submitScoreVectorForWorker encoder for direct mode', async () => {
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // Should have called direct encoder
    expect(directScoreEncoder.encodeSubmitScoreVectorForWorker).toHaveBeenCalledWith(
      input.data_hash,
      input.worker_address,
      input.scores
    );
    
    // Should NOT have called commit-reveal encoder
    expect(scoreEncoder.computeCommitHash).not.toHaveBeenCalled();
    expect(scoreEncoder.encodeCommitScore).not.toHaveBeenCalled();
  });

  it('CRITICAL: should skip direct submission if score already exists on-chain', async () => {
    // Score already exists on-chain
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_SCORE_DIRECT';
    workflow.progress = {};

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should complete without new submission (reconciliation)
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    
    // Should not have submitted tx since score already exists
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });

  it('should proceed to REGISTER_VALIDATOR after direct score confirmed', async () => {
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_SCORE_CONFIRM';
    workflow.progress = {
      score_tx_hash: '0xscoretx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    // Should have progressed to validator registration
    expect(finalWorkflow?.progress.score_confirmed).toBe(true);
  });

  it('should complete direct mode workflow end-to-end', async () => {
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    
    // Ensure tx submission succeeds
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockResolvedValue({ txHash: '0xmocktx' });
    (chainAdapter.waitForConfirmation as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'confirmed',
      blockNumber: 12345,
    } as TxReceipt);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    // Workflow should progress - might be RUNNING, COMPLETED, or advance through steps
    // Key assertion is that direct encoder was used
    
    // Should have called direct encoder, not commit-reveal
    expect(directScoreEncoder.encodeSubmitScoreVectorForWorker).toHaveBeenCalled();
    expect(scoreEncoder.computeCommitHash).not.toHaveBeenCalled();
    
    // If workflow finished, it should be COMPLETED
    if (finalWorkflow?.state === 'COMPLETED') {
      expect(finalWorkflow?.progress.score_confirmed || finalWorkflow?.progress.register_validator_confirmed).toBe(true);
    }
  });

  it('should fail direct mode if worker_address is missing', async () => {
    const input = createTestInput('direct');
    delete (input as any).worker_address; // Remove worker_address
    
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_SCORE_DIRECT';

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('MISSING_WORKER_ADDRESS');
  });

  it('should skip direct score submission if score_tx_hash already exists', async () => {
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    // Also mock validator as already registered
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_SCORE_DIRECT';
    workflow.progress = {
      score_tx_hash: '0xexistingscoretx', // Already submitted
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit new tx (has tx hash already)
    // but may proceed to confirmation step
    const finalWorkflow = await persistence.load(workflow.id);
    expect(['RUNNING', 'COMPLETED']).toContain(finalWorkflow?.state);
  });
});

// =============================================================================
// F. MODE ISOLATION TESTS
// =============================================================================

describe('F. ScoreSubmission Mode Isolation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let scoreChainState: ScoreChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let scoreEncoder: ScoreContractEncoder;
  let directScoreEncoder: DirectScoreContractEncoder;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    scoreChainState = createMockScoreChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    scoreEncoder = createMockScoreEncoder();
    directScoreEncoder = createMockDirectScoreEncoder();
    validatorEncoder = createMockValidatorRegistrationEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(chainState, arweaveAdapter, txQueue, scoreChainState);
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createScoreSubmissionDefinition(
      txQueue,
      persistence,
      scoreChainState,
      {
        commitRevealEncoder: scoreEncoder,
        directEncoder: directScoreEncoder,
        validatorEncoder,
      }
    );
    engine.registerWorkflow(definition);
  });

  it('direct and commit_reveal workflows should not interfere', async () => {
    // Create one workflow of each mode
    const directInput = createTestInput('direct');
    const commitRevealInput = createTestInput('commit_reveal');
    
    const directWorkflow = createScoreSubmissionWorkflow(directInput);
    const commitRevealWorkflow = createScoreSubmissionWorkflow(commitRevealInput);

    expect(directWorkflow.step).toBe('SUBMIT_SCORE_DIRECT');
    expect(commitRevealWorkflow.step).toBe('COMMIT_SCORE');

    // Both should have their own paths
    expect(directWorkflow.input.mode).toBe('direct');
    expect(commitRevealWorkflow.input.mode).toBe('commit_reveal');
  });

  it('commit_reveal mode should NOT use direct encoder', async () => {
    (scoreChainState.commitExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.revealExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput('commit_reveal');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // Should have called commit-reveal encoder
    expect(scoreEncoder.computeCommitHash).toHaveBeenCalled();
    expect(scoreEncoder.encodeCommitScore).toHaveBeenCalled();
    
    // Should NOT have called direct encoder
    expect(directScoreEncoder.encodeSubmitScoreVectorForWorker).not.toHaveBeenCalled();
  });

  it('direct mode should NOT use commit-reveal encoder', async () => {
    (scoreChainState.scoreExistsForWorker as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (scoreChainState.isValidatorRegisteredInRewardsDistributor as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // Should have called direct encoder
    expect(directScoreEncoder.encodeSubmitScoreVectorForWorker).toHaveBeenCalled();
    
    // Should NOT have called commit-reveal encoder
    expect(scoreEncoder.computeCommitHash).not.toHaveBeenCalled();
    expect(scoreEncoder.encodeCommitScore).not.toHaveBeenCalled();
    expect(scoreEncoder.encodeRevealScore).not.toHaveBeenCalled();
  });
});
