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
  NoOpReconciler,
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

// Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
describe.skip('A. ScoreSubmission Reconciliation-before-irreversible', () => {
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

    const definition = createScoreSubmissionDefinition(persistence);
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

// Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
describe.skip('B. ScoreSubmission Crash recovery', () => {
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

    const definition = createScoreSubmissionDefinition(persistence);
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

// Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
describe.skip('C. ScoreSubmission FAILED vs STALLED', () => {
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

    const definition = createScoreSubmissionDefinition(persistence);
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

// Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
describe.skip('D. ScoreSubmission Commit-Reveal pattern', () => {
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

    const definition = createScoreSubmissionDefinition(persistence);
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

// Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
describe.skip('ScoreSubmission Idempotency', () => {
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

    const definition = createScoreSubmissionDefinition(persistence);
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
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    const reconciler = new NoOpReconciler();
    engine = new WorkflowEngine(persistence, reconciler);

    const scoreSubmissionDef = createScoreSubmissionDefinition(persistence);
    engine.registerWorkflow(scoreSubmissionDef);
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

  it('should complete off-chain for direct mode', async () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.score_confirmed).toBe(true);
    expect(saved!.progress.settlement).toBe('off-chain');
  });

  it('should idempotently skip if score_confirmed already set', async () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_SCORE_DIRECT';
    workflow.progress = { score_confirmed: true };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  // Skipped: REGISTER_VALIDATOR / AWAIT_SCORE_CONFIRM no longer in the off-chain step map
  it.skip('should proceed to REGISTER_VALIDATOR after direct score confirmed', async () => {
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
    expect(finalWorkflow?.progress.score_confirmed).toBe(true);
  });

  it('should complete direct mode workflow end-to-end off-chain', async () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.score_confirmed).toBe(true);
    expect(finalWorkflow?.progress.settlement).toBe('off-chain');
    expect(finalWorkflow?.progress.resolved_worker_address).toBe('0xWorker');
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

  it('in-flight workflow with score_tx_hash but no score_confirmed gets completed off-chain', async () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_SCORE_DIRECT';
    workflow.progress = {
      score_tx_hash: '0xexistingscoretx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(finalWorkflow?.progress.score_confirmed).toBe(true);
  });

  // ---------------------------------------------------------------------
  // Cross-workflow idempotency (fixes the 2026-04-11 duplicate-scoring
  // incident). Two verifier instances racing on the same pending work
  // item must not both persist a COMPLETED ScoreSubmission for the same
  // data_hash — the first winner is canonical, the second no-ops with
  // duplicate_skipped=true on its progress.
  // ---------------------------------------------------------------------

  it('second SUBMIT_SCORE_DIRECT for same data_hash is skipped as duplicate', async () => {
    const inputA = createTestInput('direct');
    const workflowA = createScoreSubmissionWorkflow(inputA);

    // Use distinct validator addresses to mimic two verifier instances
    // sharing the same signer key (the real zombie-replica incident).
    const inputB: ScoreSubmissionInput = {
      ...inputA,
      validator_address: '0xOtherValidator',
    };
    const workflowB = createScoreSubmissionWorkflow(inputB);

    await persistence.create(workflowA);
    await engine.startWorkflow(workflowA.id);

    const savedA = await persistence.load(workflowA.id);
    expect(savedA?.state).toBe('COMPLETED');
    expect(savedA?.progress.score_confirmed).toBe(true);
    expect(savedA?.progress.duplicate_skipped).toBeUndefined();

    // Second workflow lands after A has reached COMPLETED (the common
    // serialised case — the race-in-the-same-ms case is covered by the
    // partial unique index migration).
    await persistence.create(workflowB);
    await engine.startWorkflow(workflowB.id);

    const savedB = await persistence.load(workflowB.id);
    expect(savedB?.state).toBe('COMPLETED');
    expect(savedB?.progress.score_confirmed).toBe(true);
    expect(savedB?.progress.duplicate_skipped).toBe(true);
    expect(savedB?.progress.settlement).toBe('off-chain');
  });

  it('duplicate check only fires for workflows already COMPLETED', async () => {
    // A CREATED-but-not-COMPLETED sibling must NOT block a new workflow
    // from advancing. The partial unique index filter `state =
    // 'COMPLETED'` + the application-level check
    // `hasCompletedScoreForDataHash` both agree: only COMPLETED rows
    // count as duplicates.
    const inputA = createTestInput('direct');
    const workflowA = createScoreSubmissionWorkflow(inputA);
    // Place workflowA in CREATED/RUNNING state without completing it.
    await persistence.create(workflowA);
    // Note: we intentionally do NOT start workflowA, so no COMPLETED row
    // exists for its data_hash yet.

    const inputB: ScoreSubmissionInput = {
      ...inputA,
      validator_address: '0xSecondValidator',
    };
    const workflowB = createScoreSubmissionWorkflow(inputB);
    await persistence.create(workflowB);
    await engine.startWorkflow(workflowB.id);

    const savedB = await persistence.load(workflowB.id);
    expect(savedB?.state).toBe('COMPLETED');
    expect(savedB?.progress.score_confirmed).toBe(true);
    // workflowB was the first to reach COMPLETED, so it is canonical.
    expect(savedB?.progress.duplicate_skipped).toBeUndefined();
  });
});

// =============================================================================
// F. MODE ISOLATION TESTS
// =============================================================================

describe('F. ScoreSubmission Mode Isolation', () => {
  let persistence: InMemoryWorkflowPersistence;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    const reconciler = new NoOpReconciler();
    engine = new WorkflowEngine(persistence, reconciler);

    const scoreSubmissionDef = createScoreSubmissionDefinition(persistence);
    engine.registerWorkflow(scoreSubmissionDef);
  });

  it('direct and commit_reveal workflows should not interfere', async () => {
    const directInput = createTestInput('direct');
    const commitRevealInput = createTestInput('commit_reveal');
    
    const directWorkflow = createScoreSubmissionWorkflow(directInput);
    const commitRevealWorkflow = createScoreSubmissionWorkflow(commitRevealInput);

    expect(directWorkflow.step).toBe('SUBMIT_SCORE_DIRECT');
    expect(commitRevealWorkflow.step).toBe('COMMIT_SCORE');

    expect(directWorkflow.input.mode).toBe('direct');
    expect(commitRevealWorkflow.input.mode).toBe('commit_reveal');
  });

  it('direct mode completes off-chain', async () => {
    const input = createTestInput('direct');
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.settlement).toBe('off-chain');
  });
});

// =============================================================================
// F. SIGNER FALLBACK TESTS
// =============================================================================

describe('F. Signer fallback when signer_address is not loaded', () => {
  let persistence: InMemoryWorkflowPersistence;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    const reconciler = new NoOpReconciler();
    engine = new WorkflowEngine(persistence, reconciler);

    const scoreSubmissionDef = createScoreSubmissionDefinition(persistence);
    engine.registerWorkflow(scoreSubmissionDef);
  });

  it('SUBMIT_SCORE_DIRECT completes off-chain without calling submitTx regardless of signer', async () => {
    const input = createTestInput('direct');
    input.signer_address = '0xExternalVerifier';
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.score_confirmed).toBe(true);
    expect(saved!.progress.settlement).toBe('off-chain');
  });

  it('SUBMIT_SCORE_DIRECT completes off-chain for loaded signer too', async () => {
    const input = createTestInput('direct');
    input.signer_address = '0xGatewaySigner';
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.score_confirmed).toBe(true);
  });

  // Skipped: chain-dependent tests (commit-reveal / validator registration removed from off-chain definition)
  it.skip('REGISTER_VALIDATOR falls back to gateway signer when admin/signer address is not loaded', () => {});
});

// =============================================================================
// G. WORKER ADDRESS RESOLUTION TESTS
// =============================================================================

describe('G. Worker address resolution from WorkSubmission signer', () => {
  const WORK_SUBMITTER = '0xOriginalWorkSubmitter';

  let persistence: InMemoryWorkflowPersistence;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    const reconciler = new NoOpReconciler();
    engine = new WorkflowEngine(persistence, reconciler);

    const scoreSubmissionDef = createScoreSubmissionDefinition(persistence);
    engine.registerWorkflow(scoreSubmissionDef);
  });

  async function seedWorkSubmission(dataHash: string, signer: string) {
    await persistence.create({
      id: 'wf-work-' + dataHash.slice(0, 8),
      type: 'WorkSubmission',
      created_at: Date.now() - 10000,
      updated_at: Date.now() - 10000,
      state: 'COMPLETED',
      step: 'DONE',
      step_attempts: 0,
      input: { data_hash: dataHash, studio_address: '0xStudio', epoch: 1, signer_address: signer },
      progress: {},
      signer,
    });
  }

  it('uses WorkSubmission.signer as resolved_worker_address when it differs from input.worker_address', async () => {
    const DATA_HASH = '0xDataHash';
    await seedWorkSubmission(DATA_HASH, WORK_SUBMITTER);

    const input = createTestInput('direct');
    input.data_hash = DATA_HASH;
    input.worker_address = '0xWrongAgentAddress';
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.resolved_worker_address).toBe(WORK_SUBMITTER);
  });

  it('uses WorkSubmission.signer even when input.worker_address is missing', async () => {
    const DATA_HASH = '0xDataHash';
    await seedWorkSubmission(DATA_HASH, WORK_SUBMITTER);

    const input = createTestInput('direct');
    input.data_hash = DATA_HASH;
    input.worker_address = undefined;
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.resolved_worker_address).toBe(WORK_SUBMITTER);
  });

  it('falls back to input.worker_address when no WorkSubmission exists', async () => {
    const input = createTestInput('direct');
    input.data_hash = '0xNoMatchingWork';
    input.worker_address = '0xFallbackWorker';
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('COMPLETED');
    expect(saved!.progress.resolved_worker_address).toBe('0xFallbackWorker');
  });

  it('fails with clear error when both WorkSubmission and input.worker_address are missing', async () => {
    const input = createTestInput('direct');
    input.data_hash = '0xNoMatchingWork';
    input.worker_address = undefined;
    const workflow = createScoreSubmissionWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const saved = await persistence.load(workflow.id);
    expect(saved!.state).toBe('FAILED');
    expect(saved!.error?.code).toBe('MISSING_WORKER_ADDRESS');
  });
});
