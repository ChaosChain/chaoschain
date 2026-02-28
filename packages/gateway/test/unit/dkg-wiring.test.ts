/**
 * DKG Wiring Tests
 *
 * Proves that the COMPUTE_DKG step is correctly wired into the
 * WorkSubmission workflow, and that SubmitWorkOnchainStep consumes
 * DKG roots from progress (never from input).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ComputeDKGStep,
  SubmitWorkOnchainStep,
} from '../../src/workflows/work-submission.js';
import type {
  WorkSubmissionRecord,
  WorkSubmissionInput,
  WorkSubmissionProgress,
  DKGEvidencePackage,
} from '../../src/workflows/types.js';
import type { WorkflowPersistence } from '../../src/workflows/persistence.js';
import type { TxQueue } from '../../src/workflows/tx-queue.js';
import type { ContractEncoder } from '../../src/workflows/work-submission.js';

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

function makeWorkflow(
  input: Partial<WorkSubmissionInput> = {},
  progress: WorkSubmissionProgress = {},
): WorkSubmissionRecord {
  return {
    id: 'wf-test-1',
    type: 'WorkSubmission',
    created_at: Date.now(),
    updated_at: Date.now(),
    state: 'RUNNING',
    step: 'COMPUTE_DKG',
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

function mockPersistence(): WorkflowPersistence {
  return {
    create: vi.fn(),
    load: vi.fn(),
    save: vi.fn(),
    appendProgress: vi.fn(),
    findActiveWorkflows: vi.fn().mockResolvedValue([]),
    findByTypeAndState: vi.fn().mockResolvedValue([]),
    updateState: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkflowPersistence;
}

// =============================================================================
// Test A — Roots persisted
// =============================================================================

describe('COMPUTE_DKG step', () => {
  let persistence: WorkflowPersistence;

  beforeEach(() => {
    persistence = mockPersistence();
  });

  it('A: computes and persists non-zero roots and weights', async () => {
    const evidence = [
      makeDkgEvidence('tx1', '0xAlice', 1000),
      makeDkgEvidence('tx2', '0xBob', 2000, ['tx1']),
      makeDkgEvidence('tx3', '0xAlice', 3000, ['tx2']),
    ];
    const workflow = makeWorkflow({ dkg_evidence: evidence });

    const step = new ComputeDKGStep(persistence);
    const result = await step.execute(workflow);

    expect(result.type).toBe('SUCCESS');
    expect(result).toHaveProperty('nextStep', 'UPLOAD_EVIDENCE');

    expect(persistence.appendProgress).toHaveBeenCalledTimes(1);

    const persisted = (persistence.appendProgress as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(persisted.dkg_thread_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(persisted.dkg_thread_root).not.toBe('0x' + '0'.repeat(64));
    expect(persisted.dkg_evidence_root).toMatch(/^0x[0-9a-f]{64}$/);
    expect(persisted.dkg_evidence_root).not.toBe('0x' + '0'.repeat(64));
    expect(Object.keys(persisted.dkg_weights).length).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Test B — Idempotent
  // ===========================================================================

  it('B: skips if dkg_thread_root already in progress (idempotent)', async () => {
    const workflow = makeWorkflow({}, {
      dkg_thread_root: '0x' + 'aa'.repeat(32),
      dkg_evidence_root: '0x' + 'bb'.repeat(32),
      dkg_weights: { '0xAlice': 1.0 },
    });

    const step = new ComputeDKGStep(persistence);
    const result = await step.execute(workflow);

    expect(result.type).toBe('SUCCESS');
    expect(result).toHaveProperty('nextStep', 'UPLOAD_EVIDENCE');
    expect(persistence.appendProgress).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Test C — SubmitWork uses DKG roots from progress
// =============================================================================

describe('SubmitWorkOnchainStep uses DKG roots', () => {
  it('C: calls encodeSubmitWork with roots from progress, not input', async () => {
    const persistence = mockPersistence();
    const encoder: ContractEncoder = {
      encodeSubmitWork: vi.fn().mockReturnValue('0xencodeddata'),
      encodeSubmitWorkMultiAgent: vi.fn(),
    };
    const txQueue = {
      submitOnly: vi.fn().mockResolvedValue('0xtxhash'),
      releaseSignerLock: vi.fn(),
    } as unknown as TxQueue;

    const dkgThreadRoot = '0x' + 'cc'.repeat(32);
    const dkgEvidenceRoot = '0x' + 'dd'.repeat(32);

    const workflow = makeWorkflow({}, {
      dkg_thread_root: dkgThreadRoot,
      dkg_evidence_root: dkgEvidenceRoot,
      dkg_weights: { '0xAlice': 1.0 },
      arweave_tx_id: 'ar-mock-tx',
      arweave_confirmed: true,
    });

    const step = new SubmitWorkOnchainStep(txQueue, persistence, encoder);
    const result = await step.execute(workflow);

    expect(result.type).toBe('SUCCESS');
    expect(encoder.encodeSubmitWork).toHaveBeenCalledWith(
      '0xDataHash',
      dkgThreadRoot,
      dkgEvidenceRoot,
      'ar://ar-mock-tx',
    );
  });

  // ===========================================================================
  // Test D — Missing DKG roots fails with PERMANENT
  // ===========================================================================

  it('D: fails permanently when DKG roots are missing from progress', async () => {
    const persistence = mockPersistence();
    const encoder: ContractEncoder = {
      encodeSubmitWork: vi.fn(),
      encodeSubmitWorkMultiAgent: vi.fn(),
    };
    const txQueue = {
      submitOnly: vi.fn(),
      releaseSignerLock: vi.fn(),
    } as unknown as TxQueue;

    const workflow = makeWorkflow({}, {
      arweave_tx_id: 'ar-mock-tx',
      arweave_confirmed: true,
    });

    const step = new SubmitWorkOnchainStep(txQueue, persistence, encoder);
    const result = await step.execute(workflow);

    expect(result.type).toBe('FAILED');
    if (result.type === 'FAILED') {
      expect(result.error.category).toBe('PERMANENT');
      expect(result.error.code).toBe('MISSING_DKG_ROOTS');
    }

    expect(encoder.encodeSubmitWork).not.toHaveBeenCalled();
    expect(txQueue.submitOnly).not.toHaveBeenCalled();
  });
});
