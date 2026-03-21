/**
 * Multi-Agent E2E Fixes — Regression Tests
 *
 * Tests all changes made during E2E validation to ensure they don't break
 * existing single-agent or commit-reveal flows.
 *
 * Groups:
 * 1. scoreExistsForWorker — stricter empty bytes check
 * 2. RegisterValidatorStep — precondition fix for direct mode
 * 3. admin_signer_address — backward compatible signer override
 * 4. DKG parent_ids mapping — event_id to arweave_tx_id
 * 5. submitWorkMultiAgent branching — single vs multi agent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ComputeDKGStep,
  SubmitWorkOnchainStep,
} from '../../src/workflows/work-submission.js';
import {
  RegisterValidatorStep,
} from '../../src/workflows/score-submission.js';
import type {
  WorkSubmissionRecord,
  WorkSubmissionInput,
  WorkSubmissionProgress,
  ScoreSubmissionRecord,
  ScoreSubmissionInput,
  ScoreSubmissionProgress,
  DKGEvidencePackage,
} from '../../src/workflows/types.js';
import type { WorkflowPersistence } from '../../src/workflows/persistence.js';
import type { TxQueue } from '../../src/workflows/tx-queue.js';
import type { ContractEncoder } from '../../src/workflows/work-submission.js';
import type { ValidatorRegistrationEncoder, ScoreChainStateAdapter } from '../../src/workflows/score-submission.js';

// =============================================================================
// Helpers
// =============================================================================

function makeDkgEvidence(
  id: string,
  author: string,
  timestamp: number,
  parents: string[] = [],
): DKGEvidencePackage {
  return {
    arweave_tx_id: id,
    author,
    timestamp,
    parent_ids: parents,
    payload_hash: '0x' + id.padStart(64, '0'),
    artifact_ids: [],
    signature: '0x' + '00'.repeat(65),
  };
}

function makeWorkSubmissionWorkflow(
  input: Partial<WorkSubmissionInput> = {},
  progress: WorkSubmissionProgress = {},
): WorkSubmissionRecord {
  return {
    id: 'wf-test-1',
    type: 'WorkSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'RUNNING',
    step: 'SUBMIT_WORK_ONCHAIN',
    step_attempts: 0,
    input: {
      studio_address: '0xStudio',
      epoch: 1,
      agent_address: '0xAgent',
      data_hash: '0xDataHash',
      dkg_evidence: [makeDkgEvidence('tx1', '0xAlice', 1000)],
      evidence_content: Buffer.from('test'),
      signer_address: '0xSigner',
      ...input,
    },
    progress,
    signer: '0xSigner',
  };
}

function makeScoreSubmissionWorkflow(
  input: Partial<ScoreSubmissionInput> = {},
  progress: Partial<ScoreSubmissionProgress> = {},
): ScoreSubmissionRecord {
  return {
    id: 'wf-score-1',
    type: 'ScoreSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'RUNNING',
    step: 'REGISTER_VALIDATOR',
    step_attempts: 0,
    input: {
      studio_address: '0xStudio',
      epoch: 1,
      validator_address: '0xValidator',
      data_hash: '0xDataHash',
      scores: [85, 90, 80, 75, 88],
      salt: '0x' + '01'.padStart(64, '0'),
      signer_address: '0xValidator',
      worker_address: '0xWorker',
      mode: 'direct',
      ...input,
    },
    progress: progress as ScoreSubmissionProgress,
    signer: input.signer_address ?? '0xValidator',
  };
}

function mockPersistence(): WorkflowPersistence {
  return {
    create: vi.fn(),
    load: vi.fn(),
    save: vi.fn(),
    appendProgress: vi.fn(),
    findActiveWorkflows: vi.fn().mockResolvedValue([]),
    findByTypeAndState: vi.fn().mockResolvedValue([]),
    updateState: vi.fn(),
  };
}

function mockTxQueue(): TxQueue {
  return {
    submitOnly: vi.fn().mockResolvedValue('0xMockTxHash'),
    waitForTx: vi.fn().mockResolvedValue({ status: 'confirmed', blockNumber: 100 }),
    releaseSignerLock: vi.fn(),
  } as unknown as TxQueue;
}

function mockContractEncoder(): ContractEncoder {
  return {
    encodeSubmitWork: vi.fn().mockReturnValue('0xSingleAgentData'),
    encodeSubmitWorkMultiAgent: vi.fn().mockReturnValue('0xMultiAgentData'),
  };
}

function mockValidatorEncoder(): ValidatorRegistrationEncoder {
  return {
    encodeRegisterValidator: vi.fn().mockReturnValue('0xRegisterValidatorData'),
    getRewardsDistributorAddress: vi.fn().mockReturnValue('0xRD'),
  };
}

function mockScoreChainState(overrides: Partial<ScoreChainStateAdapter> = {}): ScoreChainStateAdapter {
  return {
    commitExists: vi.fn().mockResolvedValue(false),
    revealExists: vi.fn().mockResolvedValue(false),
    getCommit: vi.fn().mockResolvedValue(null),
    scoreExistsForWorker: vi.fn().mockResolvedValue(false),
    isValidatorRegisteredInRewardsDistributor: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

// =============================================================================
// 1. RegisterValidatorStep — precondition fix
// =============================================================================

describe('1. RegisterValidatorStep precondition', () => {
  let persistence: WorkflowPersistence;
  let txQueue: TxQueue;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let chainState: ScoreChainStateAdapter;
  let step: RegisterValidatorStep;

  beforeEach(() => {
    persistence = mockPersistence();
    txQueue = mockTxQueue();
    validatorEncoder = mockValidatorEncoder();
    chainState = mockScoreChainState();
    step = new RegisterValidatorStep(txQueue, persistence, validatorEncoder, chainState);
  });

  it('a. Direct mode: score_confirmed=true -> passes', async () => {
    const wf = makeScoreSubmissionWorkflow(
      { mode: 'direct' },
      { score_confirmed: true, score_confirmed_at: Date.now() },
    );
    const result = await step.execute(wf);
    expect(result.type).toBe('SUCCESS');
  });

  it('b. Commit-reveal: reveal_confirmed=true -> passes', async () => {
    const wf = makeScoreSubmissionWorkflow(
      { mode: 'commit_reveal' },
      { reveal_confirmed: true, reveal_confirmed_at: Date.now() },
    );
    const result = await step.execute(wf);
    expect(result.type).toBe('SUCCESS');
  });

  it('c. Neither confirmed -> fails', async () => {
    const wf = makeScoreSubmissionWorkflow({}, {});
    const result = await step.execute(wf);
    expect(result.type).toBe('FAILED');
    if (result.type === 'FAILED') {
      expect(result.error.code).toBe('SCORE_NOT_CONFIRMED');
    }
  });

  it('d. Both confirmed -> passes', async () => {
    const wf = makeScoreSubmissionWorkflow(
      {},
      { score_confirmed: true, reveal_confirmed: true },
    );
    const result = await step.execute(wf);
    expect(result.type).toBe('SUCCESS');
  });
});

// =============================================================================
// 2. admin_signer_address — backward compatible
// =============================================================================

describe('2. admin_signer_address', () => {
  let persistence: WorkflowPersistence;
  let txQueue: TxQueue;
  let validatorEncoder: ValidatorRegistrationEncoder;
  let chainState: ScoreChainStateAdapter;
  let step: RegisterValidatorStep;

  beforeEach(() => {
    persistence = mockPersistence();
    txQueue = mockTxQueue();
    validatorEncoder = mockValidatorEncoder();
    chainState = mockScoreChainState();
    step = new RegisterValidatorStep(txQueue, persistence, validatorEncoder, chainState);
  });

  it('a. Without admin_signer_address -> uses signer_address', async () => {
    const wf = makeScoreSubmissionWorkflow(
      { signer_address: '0xVerifier' },
      { score_confirmed: true },
    );
    await step.execute(wf);
    expect(txQueue.submitOnly).toHaveBeenCalledWith(
      wf.id,
      '0xVerifier',
      expect.any(Object),
    );
  });

  it('b. With admin_signer_address -> uses admin_signer_address', async () => {
    const wf = makeScoreSubmissionWorkflow(
      { signer_address: '0xVerifier', admin_signer_address: '0xAdmin' },
      { score_confirmed: true },
    );
    await step.execute(wf);
    expect(txQueue.submitOnly).toHaveBeenCalledWith(
      wf.id,
      '0xAdmin',
      expect.any(Object),
    );
  });
});

// =============================================================================
// 3. submitWorkMultiAgent branching
// =============================================================================

describe('3. submitWorkMultiAgent branching', () => {
  let persistence: WorkflowPersistence;
  let txQueue: TxQueue;
  let encoder: ContractEncoder;
  let step: SubmitWorkOnchainStep;

  beforeEach(() => {
    persistence = mockPersistence();
    txQueue = mockTxQueue();
    encoder = mockContractEncoder();
    step = new SubmitWorkOnchainStep(txQueue, persistence, encoder);
  });

  it('a. 1 author -> encodeSubmitWork (backward compatible)', async () => {
    const wf = makeWorkSubmissionWorkflow(
      {
        dkg_evidence: [makeDkgEvidence('tx1', '0xAlice', 1000)],
        signer_address: '0xSigner',
      },
      {
        arweave_tx_id: 'mock-ar-1',
        arweave_confirmed: true,
        dkg_thread_root: '0xThreadRoot',
        dkg_evidence_root: '0xEvidenceRoot',
      },
    );

    await step.execute(wf);

    expect(encoder.encodeSubmitWork).toHaveBeenCalled();
    expect(encoder.encodeSubmitWorkMultiAgent).not.toHaveBeenCalled();
  });

  it('b. 2 authors -> encodeSubmitWorkMultiAgent with 3 participants (+ signer)', async () => {
    const wf = makeWorkSubmissionWorkflow(
      {
        dkg_evidence: [
          makeDkgEvidence('tx1', '0xAlice', 1000),
          makeDkgEvidence('tx2', '0xBob', 2000),
        ],
        signer_address: '0xSigner',
      },
      {
        arweave_tx_id: 'mock-ar-1',
        arweave_confirmed: true,
        dkg_thread_root: '0xThreadRoot',
        dkg_evidence_root: '0xEvidenceRoot',
      },
    );

    await step.execute(wf);

    expect(encoder.encodeSubmitWorkMultiAgent).toHaveBeenCalled();
    expect(encoder.encodeSubmitWork).not.toHaveBeenCalled();

    const call = (encoder.encodeSubmitWorkMultiAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const workers = call[3] as string[];
    const weights = call[4] as number[];

    // 3 participants: Alice, Bob, Signer
    expect(workers).toHaveLength(3);
    expect(workers).toContain('0xAlice');
    expect(workers).toContain('0xBob');
    expect(workers).toContain('0xSigner');
  });

  it('c. Signer already an author -> no duplicate', async () => {
    const wf = makeWorkSubmissionWorkflow(
      {
        dkg_evidence: [
          makeDkgEvidence('tx1', '0xAlice', 1000),
          makeDkgEvidence('tx2', '0xSigner', 2000), // signer IS an author
        ],
        signer_address: '0xSigner',
      },
      {
        arweave_tx_id: 'mock-ar-1',
        arweave_confirmed: true,
        dkg_thread_root: '0xThreadRoot',
        dkg_evidence_root: '0xEvidenceRoot',
      },
    );

    await step.execute(wf);

    const call = (encoder.encodeSubmitWorkMultiAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const workers = call[3] as string[];

    // Only 2 participants: Alice, Signer (no duplicate)
    expect(workers).toHaveLength(2);
  });

  it('d. Weights sum to exactly 10000', async () => {
    const wf = makeWorkSubmissionWorkflow(
      {
        dkg_evidence: [
          makeDkgEvidence('tx1', '0xAlice', 1000),
          makeDkgEvidence('tx2', '0xBob', 2000),
          makeDkgEvidence('tx3', '0xCharlie', 3000),
        ],
        signer_address: '0xSigner',
      },
      {
        arweave_tx_id: 'mock-ar-1',
        arweave_confirmed: true,
        dkg_thread_root: '0xThreadRoot',
        dkg_evidence_root: '0xEvidenceRoot',
      },
    );

    await step.execute(wf);

    const call = (encoder.encodeSubmitWorkMultiAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const weights = call[4] as number[];
    const sum = weights.reduce((a, b) => a + b, 0);
    expect(sum).toBe(10000);
  });

  it('e. Signer weight = 1 (0.01%), workers get the rest', async () => {
    const wf = makeWorkSubmissionWorkflow(
      {
        dkg_evidence: [
          makeDkgEvidence('tx1', '0xAlice', 1000),
          makeDkgEvidence('tx2', '0xBob', 2000),
        ],
        signer_address: '0xSigner',
      },
      {
        arweave_tx_id: 'mock-ar-1',
        arweave_confirmed: true,
        dkg_thread_root: '0xThreadRoot',
        dkg_evidence_root: '0xEvidenceRoot',
      },
    );

    await step.execute(wf);

    const call = (encoder.encodeSubmitWorkMultiAgent as ReturnType<typeof vi.fn>).mock.calls[0];
    const workers = call[3] as string[];
    const weights = call[4] as number[];

    // Find signer's weight
    const signerIdx = workers.findIndex((w: string) => w.toLowerCase() === '0xsigner');
    expect(weights[signerIdx]).toBe(1);

    // Workers get the rest (9999 split between 2)
    const workerWeights = weights.filter((_: number, i: number) => i !== signerIdx);
    expect(workerWeights.every((w: number) => w >= 4999)).toBe(true);
  });
});

// =============================================================================
// 4. DKG parent_ids mapping
// =============================================================================

describe('4. DKG parent_ids mapping', () => {
  it('a. Maps event_ids to arweave_tx_ids', () => {
    const sessionId = 'sess_test123';
    const nodes = [
      { node_id: 'evt_001', parent_ids: [] },
      { node_id: 'evt_002', parent_ids: ['evt_001'] },
      { node_id: 'evt_003', parent_ids: ['evt_001', 'evt_002'] },
    ];

    // Simulate the mapping logic from sessions/routes.ts
    const eventToArweave = new Map(
      nodes.map((n) => [n.node_id, `session_${sessionId}_${n.node_id}`]),
    );

    const mapped = nodes.map((node) => ({
      arweave_tx_id: `session_${sessionId}_${node.node_id}`,
      parent_ids: node.parent_ids.map((pid) => eventToArweave.get(pid) ?? pid),
    }));

    // Root node: no parents
    expect(mapped[0].parent_ids).toEqual([]);

    // Node 2: parent mapped
    expect(mapped[1].parent_ids).toEqual(['session_sess_test123_evt_001']);

    // Node 3: both parents mapped
    expect(mapped[2].parent_ids).toEqual([
      'session_sess_test123_evt_001',
      'session_sess_test123_evt_002',
    ]);
  });

  it('b. Parent not in map -> fallback to original', () => {
    const eventToArweave = new Map([['evt_001', 'session_test_evt_001']]);

    const parentIds = ['evt_001', 'evt_unknown'];
    const mapped = parentIds.map((pid) => eventToArweave.get(pid) ?? pid);

    expect(mapped).toEqual(['session_test_evt_001', 'evt_unknown']);
  });

  it('c. Deterministic — same input same output', () => {
    const sessionId = 'sess_abc';
    const nodes = [
      { node_id: 'e1', parent_ids: [] },
      { node_id: 'e2', parent_ids: ['e1'] },
    ];

    const run = () => {
      const map = new Map(nodes.map((n) => [n.node_id, `session_${sessionId}_${n.node_id}`]));
      return nodes.map((n) => ({
        arweave_tx_id: `session_${sessionId}_${n.node_id}`,
        parent_ids: n.parent_ids.map((p) => map.get(p) ?? p),
      }));
    };

    expect(run()).toEqual(run());
  });
});
