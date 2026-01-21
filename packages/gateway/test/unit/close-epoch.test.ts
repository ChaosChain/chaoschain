/**
 * CloseEpoch Workflow Unit Tests
 * 
 * Tests:
 * A. Reconciliation-before-irreversible (prevents duplicate closeEpoch)
 * B. Crash/restart recovery
 * C. Duplicate protection
 * D. FAILED vs STALLED classification
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
  CloseEpochRecord,
  CloseEpochInput,
  TxReceipt,
  createCloseEpochWorkflow,
  createCloseEpochDefinition,
  EpochChainStateAdapter,
  EpochContractEncoder,
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

function createMockEpochChainStateAdapter(): EpochChainStateAdapter {
  return {
    epochExists: vi.fn().mockResolvedValue(true),
    isEpochClosed: vi.fn().mockResolvedValue(false),
    isCloseWindowOpen: vi.fn().mockResolvedValue(true),
  };
}

function createMockArweaveAdapter(): ArweaveAdapter {
  return {
    getStatus: vi.fn().mockResolvedValue('confirmed'),
  };
}

function createMockEpochEncoder(): EpochContractEncoder {
  return {
    encodeCloseEpoch: vi.fn().mockReturnValue('0xcloseepochdata'),
  };
}

function createTestInput(): CloseEpochInput {
  return {
    studio_address: '0xStudio',
    epoch: 1,
    signer_address: '0xSigner',
  };
}

// =============================================================================
// A. RECONCILIATION-BEFORE-IRREVERSIBLE TESTS
// =============================================================================

describe('A. CloseEpoch Reconciliation-before-irreversible', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let epochChainState: EpochChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let epochEncoder: EpochContractEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    epochChainState = createMockEpochChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    epochEncoder = createMockEpochEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(
      chainState, 
      arweaveAdapter, 
      txQueue, 
      undefined, // scoreChainState
      epochChainState
    );
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      epochChainState
    );
    engine.registerWorkflow(definition);
  });

  it('CRITICAL: should NOT call submitTx when epoch already closed', async () => {
    // Setup: Epoch is already closed on-chain
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = {
      preconditions_checked: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // CRITICAL: submitTx should NOT be called
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();

    // Workflow should be COMPLETED
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });

  it('should submit closeEpoch when epoch is NOT closed', async () => {
    // Setup: Epoch is not closed
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = {
      preconditions_checked: true,
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // submitTx SHOULD be called
    expect(chainAdapter.submitTx).toHaveBeenCalled();
  });

  it('should skip submission if close_tx_hash already exists', async () => {
    // Setup: Workflow has close tx hash already
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = {
      preconditions_checked: true,
      close_tx_hash: '0xexistingtx', // Already submitted
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should NOT submit new tx
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });
});

// =============================================================================
// B. CRASH/RESTART RECOVERY TESTS
// =============================================================================

describe('B. CloseEpoch Crash/restart recovery', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let epochChainState: EpochChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let epochEncoder: EpochContractEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    epochChainState = createMockEpochChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    epochEncoder = createMockEpochEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(
      chainState, 
      arweaveAdapter, 
      txQueue, 
      undefined,
      epochChainState
    );
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      epochChainState
    );
    engine.registerWorkflow(definition);
  });

  it('should complete workflow on restart when epoch is closed', async () => {
    // Simulate: Gateway crashed after submitting closeEpoch but before recording confirmation
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      preconditions_checked: true,
      close_tx_hash: '0xclosetx',
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should complete via reconciliation
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });

  it('should resume from CHECK_PRECONDITIONS if not yet checked', async () => {
    // Workflow crashed before preconditions were checked
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'CHECK_PRECONDITIONS';
    workflow.progress = {}; // Not checked yet

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should have checked preconditions and progressed
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.progress.preconditions_checked).toBe(true);
  });

  it('should reconcile all active CloseEpoch workflows on startup', async () => {
    // Create workflow in AWAIT_TX_CONFIRM
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      preconditions_checked: true,
      close_tx_hash: '0xclosetx',
    };

    await persistence.create(workflow);
    await engine.reconcileAllActive();

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });
});

// =============================================================================
// C. DUPLICATE PROTECTION TESTS
// =============================================================================

describe('C. CloseEpoch Duplicate protection', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let epochChainState: EpochChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let epochEncoder: EpochContractEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    epochChainState = createMockEpochChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    epochEncoder = createMockEpochEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(
      chainState, 
      arweaveAdapter, 
      txQueue, 
      undefined,
      epochChainState
    );
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      epochChainState
    );
    engine.registerWorkflow(definition);
  });

  it('should not proceed if preconditions_checked is true', async () => {
    // Already checked, should skip to next step
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'CHECK_PRECONDITIONS';
    workflow.progress = {
      preconditions_checked: true, // Already checked
    };

    await persistence.create(workflow);

    // Clear mocks to check they're not called again
    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockClear();
    (epochChainState.isCloseWindowOpen as ReturnType<typeof vi.fn>).mockClear();

    await engine.resumeWorkflow(workflow.id);

    // Precondition checks should be skipped
    expect(epochChainState.epochExists).not.toHaveBeenCalled();
    expect(epochChainState.isCloseWindowOpen).not.toHaveBeenCalled();
  });

  it('should not submit if close_tx_hash exists', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = {
      preconditions_checked: true,
      close_tx_hash: '0xexisting', // Already submitted
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });

  it('should not resubmit if close_confirmed is true', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'AWAIT_TX_CONFIRM';
    workflow.progress = {
      preconditions_checked: true,
      close_tx_hash: '0xclosetx',
      close_confirmed: true, // Already confirmed
    };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should complete immediately
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('COMPLETED');
  });
});

// =============================================================================
// D. FAILED vs STALLED CLASSIFICATION TESTS
// =============================================================================

describe('D. CloseEpoch FAILED vs STALLED', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let epochChainState: EpochChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let epochEncoder: EpochContractEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    epochChainState = createMockEpochChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    epochEncoder = createMockEpochEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(
      chainState, 
      arweaveAdapter, 
      txQueue, 
      undefined,
      epochChainState
    );
    engine = new WorkflowEngine(persistence, reconciler, {
      max_attempts: 2,
      initial_delay_ms: 1,
      max_delay_ms: 10,
      backoff_multiplier: 1,
      jitter: false,
    });

    const definition = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      epochChainState
    );
    engine.registerWorkflow(definition);
  });

  it('should FAIL on epoch not found (precondition)', async () => {
    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('EPOCH_NOT_FOUND');
  });

  it('should FAIL on epoch already closed (precondition)', async () => {
    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(true);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('EPOCH_ALREADY_CLOSED');
  });

  it('should FAIL on close window not open (precondition)', async () => {
    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (epochChainState.isCloseWindowOpen as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('CLOSE_WINDOW_NOT_OPEN');
  });

  it('should FAIL on contract revert (no work submissions)', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no work submissions')
    );

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = { preconditions_checked: true };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('NO_WORK_SUBMISSIONS');
  });

  it('should FAIL on contract revert (no validators)', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('no validators')
    );

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = { preconditions_checked: true };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('NO_SCORE_SUBMISSIONS');
  });

  it('should FAIL on unauthorized error', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('unauthorized')
    );

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = { preconditions_checked: true };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('UNAUTHORIZED');
  });

  it('should STALL on network timeout after max retries', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    (chainAdapter.submitTx as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network timeout')
    );

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = { preconditions_checked: true };

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
    expect(finalWorkflow?.error?.recoverable).toBe(true);
  });

  it('should STALL on RPC error during precondition check after max retries', async () => {
    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('RPC connection failed')
    );

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('STALLED');
    expect(finalWorkflow?.error?.recoverable).toBe(true);
  });

  it('FAILED workflows should never retry', async () => {
    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'FAILED';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.error = {
      step: 'SUBMIT_CLOSE_EPOCH',
      message: 'no work submissions',
      code: 'NO_WORK_SUBMISSIONS',
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
// PRECONDITION-SPECIFIC TESTS
// =============================================================================

describe('CloseEpoch Preconditions', () => {
  let persistence: InMemoryWorkflowPersistence;
  let chainAdapter: ChainAdapter;
  let chainState: ChainStateAdapter;
  let epochChainState: EpochChainStateAdapter;
  let arweaveAdapter: ArweaveAdapter;
  let epochEncoder: EpochContractEncoder;
  let txQueue: TxQueue;
  let reconciler: WorkflowReconciler;
  let engine: WorkflowEngine;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
    chainAdapter = createMockChainAdapter();
    chainState = createMockChainStateAdapter();
    epochChainState = createMockEpochChainStateAdapter();
    arweaveAdapter = createMockArweaveAdapter();
    epochEncoder = createMockEpochEncoder();
    txQueue = new TxQueue(chainAdapter);
    reconciler = new WorkflowReconciler(
      chainState, 
      arweaveAdapter, 
      txQueue, 
      undefined,
      epochChainState
    );
    engine = new WorkflowEngine(persistence, reconciler);

    const definition = createCloseEpochDefinition(
      txQueue,
      persistence,
      epochEncoder,
      epochChainState
    );
    engine.registerWorkflow(definition);
  });

  it('should check preconditions in order: exists, closed, window', async () => {
    const preconditionOrder: string[] = [];

    (epochChainState.epochExists as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      preconditionOrder.push('epochExists');
      return true;
    });
    // Use a counter to track only the first call (precondition check)
    let isClosedCallCount = 0;
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      isClosedCallCount++;
      if (isClosedCallCount === 1) {
        preconditionOrder.push('isEpochClosed');
      }
      return false;
    });
    (epochChainState.isCloseWindowOpen as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      preconditionOrder.push('isCloseWindowOpen');
      return true;
    });

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);

    await persistence.create(workflow);
    await engine.startWorkflow(workflow.id);

    // The first three calls (from precondition check) should be in order
    expect(preconditionOrder).toEqual(['epochExists', 'isEpochClosed', 'isCloseWindowOpen']);
  });

  it('should not call submitTx if preconditions not checked', async () => {
    (epochChainState.isEpochClosed as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const input = createTestInput();
    const workflow = createCloseEpochWorkflow(input);
    workflow.state = 'RUNNING';
    workflow.step = 'SUBMIT_CLOSE_EPOCH';
    workflow.progress = {}; // preconditions NOT checked

    await persistence.create(workflow);
    await engine.resumeWorkflow(workflow.id);

    // Should FAIL because preconditions not checked
    const finalWorkflow = await persistence.load(workflow.id);
    expect(finalWorkflow?.state).toBe('FAILED');
    expect(finalWorkflow?.error?.code).toBe('PRECONDITIONS_NOT_CHECKED');
    expect(chainAdapter.submitTx).not.toHaveBeenCalled();
  });
});
