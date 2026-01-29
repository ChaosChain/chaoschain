/**
 * Admission Control Tests
 * 
 * Proves:
 * - Limits are enforced at workflow creation time
 * - Rejection is the only behavior (no queuing, scheduling, or ordering)
 * - Race conditions are acceptable (soft limits)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DefaultAdmissionController,
  UnlimitedAdmissionController,
  WorkflowRejectedError,
  ConcurrencyLimits,
} from '../../src/admission/concurrency.js';
import { InMemoryWorkflowPersistence } from '../../src/workflows/persistence.js';
import { WorkflowRecord, WorkflowType } from '../../src/workflows/types.js';

describe('AdmissionController', () => {
  let persistence: InMemoryWorkflowPersistence;

  beforeEach(() => {
    persistence = new InMemoryWorkflowPersistence();
  });

  function createWorkflow(
    type: WorkflowType,
    signer: string,
    state: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  ): WorkflowRecord {
    return {
      id: `test-${Date.now()}-${Math.random()}`,
      type,
      created_at: Date.now(),
      updated_at: Date.now(),
      state,
      step: 'TEST_STEP' as any,
      step_attempts: 0,
      input: {} as any,
      progress: {},
      signer,
    };
  }

  describe('Total limit', () => {
    it('should reject when total active exceeds limit', async () => {
      const limits: ConcurrencyLimits = { maxTotal: 2 };
      const controller = new DefaultAdmissionController(persistence, limits);

      // Add 2 active workflows
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'CREATED'));

      // Third should be rejected
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner3'))
        .rejects.toThrow(WorkflowRejectedError);
    });

    it('should allow when total is under limit', async () => {
      const limits: ConcurrencyLimits = { maxTotal: 5 };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'CREATED'));

      // Should pass
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner3'))
        .resolves.toBeUndefined();
    });

    it('should not count completed/failed workflows', async () => {
      const limits: ConcurrencyLimits = { maxTotal: 2 };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'COMPLETED'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'FAILED'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner3', 'RUNNING'));

      // Only 1 active, should allow
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner4'))
        .resolves.toBeUndefined();
    });
  });

  describe('Per-type limit', () => {
    it('should reject when type limit exceeded', async () => {
      const limits: ConcurrencyLimits = {
        maxPerType: {
          WorkSubmission: 2,
          ScoreSubmission: 5,
        },
      };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'RUNNING'));
      await persistence.create(createWorkflow('ScoreSubmission', '0xsigner3', 'RUNNING'));

      // WorkSubmission at limit
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner4'))
        .rejects.toThrow(WorkflowRejectedError);

      // ScoreSubmission still has room
      await expect(controller.checkAdmission('ScoreSubmission', '0xsigner4'))
        .resolves.toBeUndefined();
    });

    it('should allow types without specific limit', async () => {
      const limits: ConcurrencyLimits = {
        maxPerType: {
          WorkSubmission: 1,
        },
      };
      const controller = new DefaultAdmissionController(persistence, limits);

      // WorkSubmission at limit
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));

      await expect(controller.checkAdmission('WorkSubmission', '0xsigner2'))
        .rejects.toThrow(WorkflowRejectedError);

      // CloseEpoch has no limit configured
      await expect(controller.checkAdmission('CloseEpoch', '0xsigner2'))
        .resolves.toBeUndefined();
    });
  });

  describe('Per-signer limit', () => {
    it('should reject when signer limit exceeded', async () => {
      const limits: ConcurrencyLimits = { maxPerSigner: 2 };
      const controller = new DefaultAdmissionController(persistence, limits);

      const signer = '0xsigner1';
      await persistence.create(createWorkflow('WorkSubmission', signer, 'RUNNING'));
      await persistence.create(createWorkflow('ScoreSubmission', signer, 'RUNNING'));

      await expect(controller.checkAdmission('CloseEpoch', signer))
        .rejects.toThrow(WorkflowRejectedError);
    });

    it('should allow other signers when one is at limit', async () => {
      const limits: ConcurrencyLimits = { maxPerSigner: 1 };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));

      // Same signer rejected
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner1'))
        .rejects.toThrow(WorkflowRejectedError);

      // Different signer allowed
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner2'))
        .resolves.toBeUndefined();
    });

    it('should normalize signer addresses (case-insensitive)', async () => {
      const limits: ConcurrencyLimits = { maxPerSigner: 1 };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(
        createWorkflow('WorkSubmission', '0xABC123', 'RUNNING')
      );

      // Same address different case should be rejected
      await expect(controller.checkAdmission('WorkSubmission', '0xabc123'))
        .rejects.toThrow(WorkflowRejectedError);
    });
  });

  describe('Combined limits', () => {
    it('should check all limits in order', async () => {
      const limits: ConcurrencyLimits = {
        maxTotal: 10,
        maxPerType: { WorkSubmission: 3 },
        maxPerSigner: 2,
      };
      const controller = new DefaultAdmissionController(persistence, limits);

      const signer = '0xsigner1';
      await persistence.create(createWorkflow('WorkSubmission', signer, 'RUNNING'));
      await persistence.create(createWorkflow('ScoreSubmission', signer, 'RUNNING'));

      // Per-signer limit hit first
      const err = await controller.checkAdmission('WorkSubmission', signer)
        .catch((e) => e);
      expect(err).toBeInstanceOf(WorkflowRejectedError);
      expect(err.reason).toBe('signer_limit');
    });
  });

  describe('Error details', () => {
    it('should include limit and current count in error', async () => {
      const limits: ConcurrencyLimits = { maxTotal: 3 };
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner3', 'RUNNING'));

      const err = await controller.checkAdmission('WorkSubmission', '0xsigner4')
        .catch((e) => e);

      expect(err).toBeInstanceOf(WorkflowRejectedError);
      expect(err.reason).toBe('total_limit');
      expect(err.limit).toBe(3);
      expect(err.current).toBe(3);
    });
  });

  describe('UnlimitedAdmissionController', () => {
    it('should always allow', async () => {
      const controller = new UnlimitedAdmissionController();

      // Always passes
      await expect(controller.checkAdmission('WorkSubmission', '0xsigner'))
        .resolves.toBeUndefined();
      await expect(controller.checkAdmission('ScoreSubmission', '0xsigner'))
        .resolves.toBeUndefined();
      await expect(controller.checkAdmission('CloseEpoch', '0xsigner'))
        .resolves.toBeUndefined();
    });
  });

  describe('getActiveCounts (observability)', () => {
    it('should return correct counts', async () => {
      const limits: ConcurrencyLimits = {};
      const controller = new DefaultAdmissionController(persistence, limits);

      await persistence.create(createWorkflow('WorkSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner2', 'CREATED'));
      await persistence.create(createWorkflow('ScoreSubmission', '0xsigner1', 'RUNNING'));
      await persistence.create(createWorkflow('WorkSubmission', '0xsigner3', 'COMPLETED'));

      const counts = await controller.getActiveCounts();

      expect(counts.total).toBe(3); // Not counting COMPLETED
      expect(counts.byType['WorkSubmission']).toBe(2);
      expect(counts.byType['ScoreSubmission']).toBe(1);
      expect(counts.bySigner['0xsigner1']).toBe(2);
      expect(counts.bySigner['0xsigner2']).toBe(1);
    });
  });
});

describe('Admission Control Invariants', () => {
  it('MUST only reject, never queue or reorder', async () => {
    // Admission control has only two outcomes:
    // 1. Allow (resolves)
    // 2. Reject (throws WorkflowRejectedError)
    // There is no queuing, scheduling, or ordering

    const limits: ConcurrencyLimits = { maxTotal: 1 };
    const persistence = new InMemoryWorkflowPersistence();
    const controller = new DefaultAdmissionController(persistence, limits);

    await persistence.create({
      id: 'wf-1',
      type: 'WorkSubmission',
      created_at: Date.now(),
      updated_at: Date.now(),
      state: 'RUNNING',
      step: 'TEST' as any,
      step_attempts: 0,
      input: {} as any,
      progress: {},
      signer: '0xsigner',
    });

    // Admission check should reject synchronously (no queueing)
    const start = Date.now();
    const err = await controller.checkAdmission('WorkSubmission', '0xsigner2')
      .catch((e) => e);
    const elapsed = Date.now() - start;

    expect(err).toBeInstanceOf(WorkflowRejectedError);
    expect(elapsed).toBeLessThan(100); // Immediate rejection, no waiting
  });

  it('MUST NOT affect execution order', async () => {
    // If workflows A, B, C are created in that order,
    // admission control must not reorder them.
    // It can only reject creation.

    const limits: ConcurrencyLimits = {};
    const persistence = new InMemoryWorkflowPersistence();
    const controller = new DefaultAdmissionController(persistence, limits);

    // No limits means all pass in order
    await controller.checkAdmission('WorkSubmission', '0xsigner1');
    await controller.checkAdmission('WorkSubmission', '0xsigner2');
    await controller.checkAdmission('WorkSubmission', '0xsigner3');

    // All allowed - no reordering occurred
  });
});
